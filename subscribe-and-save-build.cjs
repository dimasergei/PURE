'use strict';
const fs = require('node:fs');
const path = require('node:path');

const out = 'public-build';
const title = 'Subscribe &amp; Save | PURE';
const description = 'Choose four products and their strengths for your PURE Subscribe &amp; Save plan.';
const canonical = 'https://getpurelabs.com/subscribe-and-save';
const content = `<div data-pss-planner>
  <section class="pss-hero">
    <div class="ap-container">
      <h1>SUBSCRIBE &amp; SAVE.</h1>
      <p>Choose four products and their strengths to save 40% on each of three monthly deliveries.</p>
    </div>
  </section>
  <div class="ap-container pss-layout">
    <section class="pss-catalog" aria-labelledby="pss-catalog-title">
      <h2 id="pss-catalog-title">Choose your products</h2>
      <label class="pss-search"><span class="ap-sr">Search by product or strength</span><input type="search" placeholder="Search by product or strength" maxlength="120" autocomplete="off" data-pss-search></label>
      <div class="pss-filters" role="group" aria-label="Filter products" data-pss-filters></div>
      <p role="status" class="pss-status" data-pss-status></p>
      <div class="pss-grid" data-pss-products></div>
    </section>
    <aside id="pss-plan" class="pss-summary" aria-labelledby="pss-plan-title">
      <h2 id="pss-plan-title">Your plan</h2>
      <div class="pss-progress"><span data-pss-count></span> selected<progress aria-label="Selections in plan" value="0" max="4" data-pss-progress></progress></div>
      <div data-pss-selection></div>
      <div class="pss-total"><span>Retail value</span><strong data-pss-subtotal></strong></div>
      <div class="pss-total pss-monthly-price"><span>Monthly savings (40%)</span><strong data-pss-savings></strong></div>
      <div class="pss-total pss-monthly-price"><span>Per month</span><strong data-pss-monthly-total></strong></div>
      <button type="button" class="ap-button" data-pss-monthly disabled>Continue</button>
      <button type="button" class="ap-button" data-pss-cart hidden disabled>Add plan to cart</button>
      <p class="pss-plan-note">Pay one invoice per month. Free express shipping in the U.S. and Canada. Change future selections after your first delivery ships. Start another plan after delivery three. <a href="/commercial-terms.html#subscribe-and-save-plan">Plan terms</a></p>
      <p role="status" data-pss-review-status></p>
    </aside>
    <div class="pss-mobile-bar"><a href="#pss-plan">Your plan <span data-pss-mobile-count></span></a><button class="ap-button" data-pss-mobile-continue type="button" disabled>Continue</button></div>
    <noscript><p>Enable JavaScript to build a plan or <a href="/shop">browse products</a>.</p></noscript>
  </div>
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
  .replace('href="#ap-main"', 'href="#subscribe-and-save-main"')
  .replace(layout, `<main id="subscribe-and-save-main">${content}</main>`)
  .replace('</head>', '<link rel="stylesheet" href="/subscribe-and-save.css?v=4"></head>')
  .replace('</body>', '<script src="/subscribe-and-save.js?v=4"></script></body>');
fs.writeFileSync(path.join(out, 'subscribe-and-save.html'), html);
for (const asset of ['subscribe-and-save.css', 'subscribe-and-save.js']) fs.copyFileSync(asset, path.join(out, asset));
const sitemapPath = path.join(out, 'sitemap.xml');
const sitemap = fs.readFileSync(sitemapPath, 'utf8');
if (!sitemap.includes(`<loc>${canonical}</loc>`)) {
  fs.writeFileSync(sitemapPath, sitemap.replace('</urlset>', `<url><loc>${canonical}</loc></url></urlset>`));
}
