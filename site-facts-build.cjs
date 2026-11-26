'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {site} = require('./config/site.ts');

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderPolicyFacts(html, facts) {
  // Policy source is readable before the build. Only marked text-only nodes are
  // substituted, so the policy's links and all interactive controls survive.
  return html.replace(/<([a-z][\w-]*)\b([^<>]*?\bdata-site-(fact|money)="([\w.]+)"[^<>]*)>[^<>]*<\/\1>/gi,
    (original, tag, attributes, kind, key) => {
      const value = key.split('.').reduce((object, property) => object?.[property], facts);
      if (value == null) throw Error('Missing public site fact: ' + key);
      if (kind === 'money' && !Number.isSafeInteger(value)) throw Error('Invalid price in cents: ' + key);
      const label = kind === 'money' ? 'US$' + (value / 100).toFixed(2) : value;
      return '<' + tag + attributes + '>' + escapeText(label) + '</' + tag + '>';
    });
}

function buildSiteFacts(out) {
  // Keep the configuration available before existing route scripts execute,
  // without a render-blocking network request. The exported script is also
  // usable by other first-party storefront entry points.
  const json = JSON.stringify(site).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const browserScript = 'window.PureSite=' + json + ';';
  const bootstrap = '<script data-pure-site-facts>' + browserScript + '</script>';
  fs.writeFileSync(path.join(__dirname, 'lib/public-site-facts.json'), JSON.stringify(site) + '\n');
  fs.writeFileSync(path.join(out, 'site-config.js'), browserScript + '\n');

  for (const filename of fs.readdirSync(out, {recursive: true})) {
    if (!filename.endsWith('.html') || /(^|\/)(admin(?:[-/]|\.html)|pay\.html$|guest-interac-pay\.html$)/i.test(filename)) continue;
    const file = path.join(out, filename);
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace(/<script\b[^>]*\bdata-pure-site-facts\b[^>]*>[\s\S]*?<\/script>/gi, '');
    // Legacy policy/contact templates contain published email links. Resolve
    // the link destination and visible address from the same public record.
    const email = escapeText(site.support.email);
    html = html.replace(/href="mailto:support@getpurelabs\.com"/gi, () => 'href="mailto:' + email + '"');
    html = html.replace(/(>[^<>]*?)support@getpurelabs\.com(?=[^<>]*<)/gi, (_, before) => before + email);
    html = renderPolicyFacts(html, site);
    html = html.replace(/<script(?=\s|>)|<\/head>/i, match => bootstrap + match);
    fs.writeFileSync(file, html);
  }
}

if (require.main === module) buildSiteFacts(path.resolve(process.argv[2] || 'public-build'));
module.exports = buildSiteFacts;
