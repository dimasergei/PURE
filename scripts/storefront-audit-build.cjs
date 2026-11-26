'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {site} = require('../config/site.ts');
const {buildGuides} = require('./research-guides.cjs');
const {buildHome, applyShell, homeFaq} = require('./home-shell.cjs');
const buildFacts = require('../site-facts-build.cjs');
const {buildCommerce} = require('../commerce-ssg.cjs');
const {buildCatalogPages} = require('../catalog-public-build.cjs');
const {buildSEO, captureSearchShell} = require('../seo-build.cjs');
const {optimizeAssets} = require('../performance-assets-build.cjs');

function appendReferenceLinks(out) {
  const catalog = JSON.parse(fs.readFileSync(path.resolve('lib/catalog.json'), 'utf8'));
  // Offer priced links on supporting pages without repeating the product grid.
  const usd = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'});
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const examples = catalog.filter(p => p.variants?.length && p.category !== 'supplies').slice(0,2).map(p => {
    const min = Math.min(...p.variants.map(v => v.price));
    return '<li><a href="/product/' + encodeURIComponent(p.id) + '">' + escape(p.name) + '</a> · from ' + usd.format(min) + ' USD</li>';
  }).join('');
  const nav = '<noscript><aside class="pure-reading-links" aria-label="Catalog and research help"><h2>Catalog and research help</h2><ul>' + examples +
    '</ul><details><summary>Where can I find a laboratory report?</summary><p>Search the <a href="/coas">laboratory report archive</a> by product or lot and open the original document.</p></details><p><a href="/faq">Frequently asked questions</a> · <a href="/learn">Research guides</a></p></aside></noscript>';
  for (const name of fs.readdirSync(out,{recursive:true}).filter(name => name.endsWith('.html') && !path.basename(name).startsWith('admin-'))) {
    const file = path.join(out, name);
    let html = fs.readFileSync(file, 'utf8');
    if (!html.includes('class="ap-site') && !html.includes(' ap-site')) continue;
    if (!html.includes('href="/research-reading.css')) html = html.replace('</head>','<link rel="stylesheet" href="/research-reading.css?v=1"></head>');
    if (!html.includes('class="pure-reading-links"')) html = html.replace(/<footer\b/i,nav+'<footer');
    fs.writeFileSync(file,html);
  }
  fs.copyFileSync('research-reading.css',path.join(out,'research-reading.css'));
}

async function run(out = path.resolve('public-build')) {
  // Keep authenticated data out of every statically generated document.
  await buildHome(out, site);
  await buildGuides(out, site, homeFaq(site));
  await buildCommerce(out, site);
  await applyShell(out, site);
  await buildCatalogPages(out, site);
  await appendReferenceLinks(out);
  await buildSEO(out, site);
  await buildFacts(out);
  await optimizeAssets(out, site);
  await captureSearchShell(out);
}

if (require.main === module) run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
module.exports = {run};
