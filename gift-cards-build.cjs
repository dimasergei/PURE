'use strict';
const fs = require('node:fs');
const path = require('node:path');
const out = 'public-build';
const shell = fs.readFileSync(path.join(out, 'shop.html'), 'utf8');
const main = /<main id="ap-main"[^>]*>[\s\S]*?<\/main>/;
if (!main.test(shell)) throw new Error('Gift card page requires the storefront shell.');
const title = 'Gift Cards | PURE';
const description = 'Send a digital PURE gift card, choose its delivery date, or claim your gift as account credit.';
const canonical = 'https://getpurelabs.com/gift-cards';
const html = shell
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
  .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*/g, `$1${description}`)
  .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
  .replace(/(<(?:meta property="og:url" content|link rel="canonical" href)=")[^"]*/g, `$1${canonical}`)
  .replace('href="#ap-main"', 'href="#pure-gift-main"')
  .replace(main, () => fs.readFileSync('lib/templates/gift-cards.html', 'utf8'))
  .replace('</head>', '<link rel="stylesheet" href="/gift-cards.css?v=2"></head>')
  .replace('</body>', '<script src="/gift-cards.js?v=2"></script></body>');
fs.writeFileSync(path.join(out, 'gift-cards.html'), html);
const adminPath = path.join(out, 'admin-orders.html');
const admin = fs.readFileSync(adminPath, 'utf8');
const hub = '<div id="fulfillment-hub"></div>';
if (!admin.includes(hub)) throw new Error('Gift card management requires the orders dashboard.');
fs.writeFileSync(adminPath, admin.replace(hub, hub + '<details id="pure-admin-gifts" class="pag"><summary>Gift card orders</summary><div data-admin-gift-list></div></details>')
  .replace('</head>', '<link rel="stylesheet" href="/gift-cards.css?v=2"></head>')
  .replace('</body>', '<script src="/admin-gift-cards.js?v=2"></script></body>'));
for (const file of ['gift-cards.js', 'gift-cards.css', 'admin-gift-cards.js']) fs.copyFileSync(file, path.join(out, file));
const sitemapPath = path.join(out, 'sitemap.xml');
const sitemap = fs.readFileSync(sitemapPath, 'utf8');
if (!sitemap.includes(`<loc>${canonical}</loc>`)) {
  fs.writeFileSync(sitemapPath, sitemap.replace('</urlset>', `<url><loc>${canonical}</loc></url></urlset>`));
}
