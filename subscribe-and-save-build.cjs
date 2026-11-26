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
      <p>Choose four products and your preferred strengths for three monthly deliveries. Receive a separate invoice each month.</p>
      <ul class="pss-benefits" aria-label="Subscribe &amp; Save benefits">
        <li class="pss-benefit-savings"><span>Monthly savings</span><strong>40% off</strong><small>Every product in your plan</small></li>
        <li><span>Reconstitution solution</span><strong>3 mL bundled</strong><small>One vial per set in every delivery</small></li>
        <li><span>U.S. &amp; Canada</span><strong>Free express shipping</strong><small>With every monthly delivery</small></li>
      </ul>
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
    <aside id="pss-plan" class="pss-summary" aria-labelledby="pss-plan-title" data-pss-summary>
      <div class="pss-summary-header">
        <h2 id="pss-plan-title">Your plan</h2>
        <span class="pss-count"><span data-pss-count></span> selected</span>
        <button class="pss-close" type="button" data-pss-close aria-label="Close plan summary">×</button>
      </div>
      <progress class="ap-sr" aria-label="Selections in plan" value="0" max="4" data-pss-progress></progress>
      <div data-pss-selection></div>
      <dl class="pss-totals">
        <div><dt>Retail value</dt><dd data-pss-subtotal></dd></div>
        <div class="pss-savings-line" data-pss-monthly-line hidden><dt>Monthly savings (40%)</dt><dd data-pss-savings></dd></div>
        <div class="pss-savings-line" data-pss-gift-line hidden><dt>Bundled reconstitution solution</dt><dd data-pss-gift-savings></dd></div>
        <div class="pss-savings-line" data-pss-monthly-line hidden><dt>Express shipping <small>U.S. &amp; Canada</small></dt><dd>Free</dd></div>
        <div class="pss-total-final" data-pss-monthly-line hidden><dt>Monthly total</dt><dd data-pss-monthly-total></dd></div>
      </dl>
      <ol class="pss-delivery-timeline" aria-label="Initial monthly deliveries" data-pss-timeline hidden>
        <li>Month 1</li>
        <li>Month 2</li>
        <li>Month 3</li>
      </ol>
      <button type="button" class="ap-button pss-continue" data-pss-monthly disabled>Choose four products</button>
      <button type="button" class="ap-button pss-continue" data-pss-cart hidden disabled>Add plan to cart</button>
      <p class="pss-plan-note">Change future selections after your first delivery ships. Your plan ends after delivery three and you can start another. Any applicable payment fees are shown before you pay. <a href="/commercial-terms.html#subscribe-and-save-plan">Plan terms</a> · <a href="/refund-policy.html">Refund policy</a></p>
      <p role="status" data-pss-review-status></p>
    </aside>
    <dialog id="pss-plan-drawer" class="pss-plan-drawer" aria-labelledby="pss-plan-title" data-pss-drawer></dialog>
    <div class="pss-mobile-bar"><a href="#pss-plan" aria-haspopup="dialog" aria-controls="pss-plan-drawer" data-pss-mobile-review>View plan <span data-pss-mobile-count></span></a><button class="ap-button" data-pss-mobile-continue type="button" disabled>Choose four products</button></div>
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
  .replace('</head>', '<link rel="stylesheet" href="/subscribe-and-save.css?v=7"></head>')
  .replace('</body>', '<script src="/subscribe-and-save.js?v=6"></script></body>');
fs.writeFileSync(path.join(out, 'subscribe-and-save.html'), html);
for (const asset of ['subscribe-and-save.css', 'subscribe-and-save.js']) fs.copyFileSync(asset, path.join(out, asset));
const sitemapPath = path.join(out, 'sitemap.xml');
const sitemap = fs.readFileSync(sitemapPath, 'utf8');
if (!sitemap.includes(`<loc>${canonical}</loc>`)) {
  fs.writeFileSync(sitemapPath, sitemap.replace('</urlset>', `<url><loc>${canonical}</loc></url></urlset>`));
}
