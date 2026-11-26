'use strict';
const fs = require('node:fs');
const path = require('node:path');

const out = 'public-build';
const title = 'Subscribe &amp; Save | PURE';
const description = 'Build and save a monthly research order to reorder when you need it.';
const canonical = 'https://getpurelabs.com/subscribe-and-save';
const content = `<section class="pss-hero">
  <div class="ap-container">
    <h1>SUBSCRIBE &amp; SAVE.</h1>
    <p>Choose four products and exact strengths. Save your selection on this device and reorder whenever you need it.</p>
  </div>
</section>
<div class="ap-container pss-layout" data-pss-planner>
  <section class="pss-catalog" aria-labelledby="pss-catalog-title">
    <h2 id="pss-catalog-title">Choose your products</h2>
    <label class="pss-search"><span class="ap-sr">Search by product or strength</span><input type="search" placeholder="Search by product or strength" maxlength="120" autocomplete="off" data-pss-search></label>
    <div class="pss-grid" data-pss-products></div>
  </section>
  <aside class="pss-summary" aria-labelledby="pss-plan-title">
    <div class="pss-summary-heading"><h2 id="pss-plan-title">Your monthly plan</h2><span data-pss-count>0 / 4</span></div>
    <ul class="pss-selection" data-pss-selection></ul>
    <div class="pss-total"><span>Current merchandise subtotal</span><strong data-pss-subtotal>$0.00</strong></div>
    <button type="button" class="ap-button" data-pss-cart disabled>Add plan to cart</button>
    <p class="pss-plan-note">Automatic renewals are unavailable. Confirm each order in checkout. Any eligible discounts, shipping and tax are calculated there.</p>
    <p class="pss-status" role="status" data-pss-status></p>
  </aside>
  <noscript><p>Enable JavaScript to create a saved plan or <a href="/shop">browse products</a>.</p></noscript>
</div>`;

const shell = fs.readFileSync(path.join(out, 'shop.html'), 'utf8');
const layout = /<main id="ap-main">[\s\S]*?<\/main>/;
if (!layout.test(shell)) throw Error('The storefront main area is missing.');
const html = shell
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
  .replace(/(<meta name="(?:description)" content=")[^"]*/, `$1${description}`)
  .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
  .replace(/(<meta property="og:description" content=")[^"]*/, `$1${description}`)
  .replace(/(<(?:meta property="og:url" content|link rel="canonical" href)=")[^"]*/g, `$1${canonical}`)
  .replace(layout, `<main id="ap-main">${content}</main>`)
  .replace('</head>', '<link rel="stylesheet" href="/subscribe-and-save.css?v=1"></head>')
  .replace('</body>', '<script src="/subscribe-and-save.js?v=1"></script></body>');
fs.writeFileSync(path.join(out, 'subscribe-and-save.html'), html);
for (const asset of ['subscribe-and-save.css', 'subscribe-and-save.js']) fs.copyFileSync(asset, path.join(out, asset));
const sitemapPath = path.join(out, 'sitemap.xml');
const sitemap = fs.readFileSync(sitemapPath, 'utf8');
if (!sitemap.includes(`<loc>${canonical}</loc>`)) {
  fs.writeFileSync(sitemapPath, sitemap.replace('</urlset>', `<url><loc>${canonical}</loc></url></urlset>`));
}
