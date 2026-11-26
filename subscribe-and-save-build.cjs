'use strict';
const fs = require('node:fs');
const path = require('node:path');

const out = 'public-build';
const title = 'Subscribe &amp; Save | PURE';
const description = 'Build sets of four products and save your selections for your next order.';
const canonical = 'https://getpurelabs.com/subscribe-and-save';
const content = `<div data-pss-planner>
  <section class="pss-hero">
    <div class="ap-container">
      <h1>SUBSCRIBE &amp; SAVE.</h1>
      <p>Build your next order in sets of four. Choose the products and strengths, then review your set before adding it to your cart.</p>
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
    <aside class="pss-preview" aria-label="Plan progress">
      <h2>Your plan</h2>
      <div class="pss-preview-totals"><span><strong data-pss-count>0 / 4</strong> selected</span><strong class="pss-preview-one-time" data-pss-subtotal></strong><strong class="pss-monthly-price"><span data-pss-preview-monthly></span><small>/mo</small></strong></div>
      <progress aria-label="Selections in plan" value="0" max="4" data-pss-progress></progress>
      <button type="button" class="ap-button" data-pss-view>View plan</button>
    </aside>
    <noscript><p>Enable JavaScript to build a plan or <a href="/shop">browse products</a>.</p></noscript>
  </div>
  <dialog class="pss-dialog" data-pss-dialog aria-labelledby="pss-plan-title">
    <header class="pss-dialog-head"><div><h2 id="pss-plan-title">Your plan</h2><small data-pss-drawer-count></small></div><button type="button" class="pss-close" data-pss-close aria-label="Close plan" autofocus>×</button></header>
    <div class="pss-dialog-body">
      <div data-pss-selection></div>
      <div class="pss-next" data-pss-next hidden><strong data-pss-completed></strong><button type="button" data-pss-another></button></div>
      <div class="pss-total"><span>One-time merchandise subtotal</span><strong data-pss-review-total></strong></div>
      <div class="pss-total pss-monthly-price"><span>Monthly invoice merchandise subtotal</span><strong data-pss-monthly-total></strong></div>
      <p class="pss-monthly-benefits">Monthly sets include one 3 mL reconstitution solution per set. Express shipping is included to the U.S. and Canada. Review your invoice total before enrolling.</p>
      <p class="pss-plan-note">Confirm each order in checkout. Eligible offers, shipping and tax are calculated there.</p>
      <p class="pss-status" role="status" data-pss-review-status></p>
    </div>
    <footer class="pss-dialog-foot"><button type="button" class="ap-button" data-pss-monthly hidden>Review monthly invoices</button><button type="button" class="ap-button" data-pss-cart disabled>Add plan to cart</button><button type="button" class="pss-return" data-pss-close>Continue choosing</button></footer>
  </dialog>
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
  .replace('</head>', '<link rel="stylesheet" href="/subscribe-and-save.css?v=2"></head>')
  .replace('</body>', '<script src="/subscribe-and-save.js?v=2"></script></body>');
fs.writeFileSync(path.join(out, 'subscribe-and-save.html'), html);
for (const asset of ['subscribe-and-save.css', 'subscribe-and-save.js']) fs.copyFileSync(asset, path.join(out, asset));
const sitemapPath = path.join(out, 'sitemap.xml');
const sitemap = fs.readFileSync(sitemapPath, 'utf8');
if (!sitemap.includes(`<loc>${canonical}</loc>`)) {
  fs.writeFileSync(sitemapPath, sitemap.replace('</urlset>', `<url><loc>${canonical}</loc></url></urlset>`));
}
