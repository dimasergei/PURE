'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const guides = require('../data/editorial-guides.json');

const origin = 'https://getpurelabs.com';
const sitemap = '/sitemap-information.xml';
const routes = ['/learn', ...guides.filter(guide => guide.status === 'published').map(guide => '/learn/' + guide.slug)];
const local = process.argv.includes('--build');

async function readRoute(route) {
  try {
    if (local) {
      const file = route.slice(1) + (routes.includes(route) ? '.html' : '');
      return { route, status: 200, body: await fs.readFile(path.resolve('public-build', file), 'utf8') };
    }
    const start = performance.now();
    const response = await fetch(origin + route, { redirect: 'manual', signal: AbortSignal.timeout(12000) });
    const responseMs = Math.round(performance.now() - start);
    return { route, status: response.status, responseMs, body: await response.text() };
  } catch (error) {
    return { route, status: null, failure: error.code || error.cause?.code || error.name };
  }
}

async function main() {
  const results = await Promise.all([...routes, '/robots.txt', sitemap].map(readRoute));
  const issues = [];
  for (const { route, status, failure, body } of results) {
    const flag = issue => issues.push({ route, issue });
    if (status !== 200) {
      flag(failure || 'HTTP ' + status);
      continue;
    }
    if (route === '/robots.txt') {
      if (!body.split(/\r?\n/).some(line => line.trim() === 'Sitemap: ' + origin + sitemap)) {
        flag('Missing educational sitemap declaration');
      }
      continue;
    }
    let dom;
    try {
      const contentType = route === sitemap ? 'text/xml' : 'text/html';
      dom = new JSDOM(body, { contentType, url: origin + route });
      const doc = dom.window.document;
      if (route === sitemap) {
        const entries = [...doc.querySelectorAll('url > loc')].map(loc => loc.textContent.trim());
        if (entries.length !== routes.length || routes.some(page => !entries.includes(origin + page))) {
          flag('Sitemap does not match published education routes');
        }
        continue;
      }
      if (doc.querySelectorAll('h1').length !== 1 || !doc.querySelector('main h1')?.textContent.trim()) flag('Expected one heading in main');
      if (doc.querySelector('link[rel="canonical"]')?.href !== origin + route) flag('Canonical URL is missing or different');
      if (/\bnoindex\b/i.test(doc.querySelector('meta[name="robots"]')?.content || '')) flag('Unexpected noindex directive');
      if (route === '/learn') {
        const links = new Set([...doc.querySelectorAll('main a[href]')].map(link => link.href));
        for (const page of routes.slice(1)) if (!links.has(origin + page)) flag('Missing guide link: ' + page);
      }
    } catch {
      flag('Document could not be parsed');
    } finally {
      dom?.window.close();
    }
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    source: local ? 'local build' : 'production HTTP GET',
    publishedPages: routes.length,
    checks: results.map(({ body, ...result }) => result),
    issues
  }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
