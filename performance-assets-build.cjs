'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// Account, payment, order and admin documents keep their own assets and exact script order.
const publicPages = new Set([
  'index', 'shop', 'cart', 'coas', 'faq', 'about', 'contact', '404', 'bulk-orders',
  'subscribe-and-save', 'memberships', 'partner-program', 'gift-cards', 'spin-and-save',
  'commercial-terms', 'corrections-policy', 'medical-disclaimer', 'membership-terms',
  'partner-terms', 'privacy-policy', 'refund-policy', 'research-documentation',
  'research-use-policy', 'shipping-policy', 'shipping-protection', 'terms-and-conditions',
  'learn', 'articles', 'guides'
]);
const publicDirectories = /^(?:product|shop|learn|articles|guides|resources)\//;
const localCss = /^\/([a-zA-Z0-9_-]+\.css)(?:\?[^#]*)?$/;
const runtimeStylesheets = new Set(['/checkout-reference.css', '/account-experience.css']);
const rootImport = /@import\s+url\(\s*['"](\/[a-zA-Z0-9_-]+\.css(?:\?[^'"]*)?)['"]\s*\)\s*;/g;
const legacyFont = '/assets/fonts/archivo-latin-variable.woff';
const publicFont = '/assets/fonts/archivo-normal-width-weight-variable.woff2';
// The saved research builder and its legacy program entry are mounted on their own routes.
const standaloneContent = /^(?:index|shop(?:\/.*)?|product\/[^/]+|coas|faq|learn(?:\/.*)?|about|contact|404)$/;
const legacyProgramTag = /<script\s+src=(["'])\/(?:research-builder-client|research-checkout-client|program-pages)\.js(?:\?[^"']*)?\1\s*>\s*<\/script>/gi;

function imagePreload(html, document) {
  if (document.head.querySelector('link[rel~="preload"][as="image"]')) return '';
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!main) return '';
  const match = /<img\b[^>]*\bfetchpriority=["']high["'][^>]*>/i.exec(main);
  if (!match) return '';
  const preceding = main.slice(0, match.index);
  if (preceding.lastIndexOf('<picture') > preceding.lastIndexOf('</picture>')) return '';
  const template = document.createElement('template');
  template.innerHTML = match[0];
  const image = template.content.querySelector('img');
  const href = image?.getAttribute('src');
  if (!href || !/^\/(?!\/)/.test(href) || image.getAttribute('loading') === 'lazy') return '';
  const link = document.createElement('link');
  link.rel = 'preload';
  link.setAttribute('as', 'image');
  link.setAttribute('href', href);
  link.setAttribute('fetchpriority', 'high');
  for (const attr of ['srcset', 'sizes']) {
    if (image.hasAttribute(attr)) link.setAttribute('image' + attr, image.getAttribute(attr));
  }
  if (image.hasAttribute('crossorigin')) link.setAttribute('crossorigin', image.getAttribute('crossorigin'));
  return link.outerHTML;
}

function optimizeAssets(out) {
  const sheets = new Map();
  const bundles = new Set();
  const usePublicFont = fs.existsSync(path.join(out, publicFont));

  function stylesheet(filename, ancestry = []) {
    if (sheets.has(filename)) return sheets.get(filename);
    const file = path.join(out, filename);
    if (ancestry.includes(filename) || !fs.existsSync(file)) return null;
    let safe = true;
    let text = fs.readFileSync(file, 'utf8').replace(rootImport, (rule, href) => {
      const match = href.match(localCss);
      const imported = match ? stylesheet(match[1], [...ancestry, filename]) : null;
      if (imported === null) { safe = false; return rule; }
      return imported;
    });
    // Keep stylesheet links when file-scoped rules cannot move into a bundle.
    if (!safe || /@(?:import|namespace|charset)\b/i.test(text)) text = null;
    if (text && usePublicFont && filename === 'pure-brand.css') {
      const oldSource = `url('${legacyFont}') format('woff')`;
      // The site uses normal width at every weight. Retain the original as a fallback.
      text = text.replace(oldSource, `url('${publicFont}') format('woff2'), ${oldSource}`);
    }
    sheets.set(filename, text);
    return text;
  }

  for (const relative of fs.readdirSync(out, { recursive: true })) {
    if (!relative.endsWith('.html')) continue;
    const name = relative.slice(0, -5).split(path.sep).join('/');
    if (!publicPages.has(name) && !publicDirectories.test(name)) continue;
    const file = path.join(out, relative);
    let html = fs.readFileSync(file, 'utf8');
    const headEnd = html.indexOf('</head>');
    if (headEnd < 0) continue;
    const dom = new JSDOM(html.slice(0, headEnd + 7), { includeNodeLocations: true });
    const { document } = dom.window;
    const edits = [];
    let group = [];

    function flush() {
      if (!group.length) return;
      const css = group.map(entry => entry.css).join('\n');
      const digest = createHash('sha256').update(css).digest('hex').slice(0, 16);
      // Preserve the base directory for relative font and image URLs.
      const asset = 'pure-styles-' + digest + '.css';
      if (!bundles.has(asset)) {
        fs.writeFileSync(path.join(out, asset), css);
        bundles.add(asset);
      }
      group.forEach(({ location }, index) => edits.push({
        start: location.startOffset, end: location.endOffset,
        markup: index === 0 ? '<link rel="stylesheet" href="/' + asset + '">' : ''
      }));
      group = [];
    }

    for (const element of document.head.children) {
      const tag = element.localName;
      if (tag === 'script') {
        if (element.getAttribute('src') === '/marketing-analytics.js' && !element.defer) {
          const location = dom.nodeLocation(element).startTag;
          edits.push({ start: location.endOffset - 1, end: location.endOffset - 1, markup: ' defer' });
        } else if (!['application/json', 'application/ld+json'].includes(element.type) && !element.defer &&
                   !element.hasAttribute('data-pure-site-facts')) {
          flush();
        }
      }
      if (usePublicFont && tag === 'link' && element.rel === 'preload' &&
          element.getAttribute('href') === legacyFont && element.getAttribute('as') === 'font') {
        const location = dom.nodeLocation(element);
        element.setAttribute('href', publicFont);
        element.setAttribute('type', 'font/woff2');
        edits.push({start: location.startOffset, end: location.endOffset, markup: element.outerHTML});
      }
      if (tag === 'style' || tag === 'noscript' || tag === 'base') flush();
      if (tag !== 'link' || !element.relList.contains('stylesheet')) continue;
      const href = element.getAttribute('href') || '';
      // The express checkout loader detects these two specific link elements.
      if (runtimeStylesheets.has(href)) { flush(); continue; }
      const match = href.match(localCss);
      const special = Array.from(element.attributes).some(attr => !['rel', 'href', 'media'].includes(attr.name));
      const css = match && !special && element.rel === 'stylesheet' ? stylesheet(match[1]) : null;
      if (css === null || !match) { flush(); continue; }
      const media = element.media;
      group.push({ location: dom.nodeLocation(element), css: media ? '@media ' + media + ' {\n' + css + '\n}' : css });
    }
    flush();
    const preload = imagePreload(html, document);
    for (const { start, end, markup } of edits.sort((a, b) => b.start - a.start)) {
      html = html.slice(0, start) + markup + html.slice(end);
    }
    if (preload) html = html.replace('</head>', preload + '</head>');
    if (standaloneContent.test(name)) html = html.replace(legacyProgramTag, '');
    dom.window.close();
    fs.writeFileSync(file, html);
  }
}

module.exports = { optimizeAssets };
