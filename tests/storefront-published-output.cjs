"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Script}=require('node:vm');
const {JSDOM}=require('jsdom');
const out='public-build';
const catalog = JSON.parse(fs.readFileSync('lib/catalog.json', 'utf8'));
const feed = JSON.parse(fs.readFileSync(path.join(out, 'feeds', 'catalog.json'), 'utf8'));
const byId = new Map(feed.map(row => [row.variant_id, row]));
assert.equal(byId.size, feed.length, 'Partner feed variant identifiers must be unique');
assert.equal(feed.length, catalog.reduce((count, p) => count + p.variants.length, 0));
for (const product of catalog) {
  for (const variant of product.variants) {
    const variantId = product.id + ':' + variant.size;
    const row = byId.get(variantId);
    assert.ok(row, 'Missing public feed variant ' + variantId);
    const page = new URL(row.product_url);
    assert.equal(page.origin, 'https://getpurelabs.com');
    assert.equal(page.pathname, '/product/' + product.id);
    assert.deepEqual([...page.searchParams], [['size', variant.size]]);
    assert.ok(fs.existsSync(path.join(out, 'product', product.id + '.html')));
    assert.deepEqual(row, {
      variant_id: variantId, brand: 'PURE', product_name: product.name,
      strength_or_pack: variant.size, list_price_usd: variant.price,
      product_url: page.href,
      testing_page_url: 'https://getpurelabs.com/coas?product=' + encodeURIComponent(product.id) + '&size=' + encodeURIComponent(variant.size)
    }, 'Feed must contain only approved public data for ' + variantId);
  }
}
const retired=['offers.html','data/storefront-programs.json'];
for(const file of retired)assert.equal(fs.existsSync(path.join(out,file)),false,'Retired artifact: '+file);
for(const file of ['memberships.html','subscribe-and-save.html','research-builder.html','membership-terms.html','membership-experience.js','membership-checkout.js','research-builder-client.js'])assert.ok(fs.existsSync(path.join(out,file)),'Restored program artifact: '+file);
const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
assert.ok(config.rewrites.some(r=>r.source==='/memberships'));assert.ok(!config.redirects.some(r=>r.source==='/memberships'));
assert.equal(config.redirects.find(r=>r.source==='/research-builder')?.destination,'/subscribe-and-save');
assert.equal(config.redirects.find(r=>r.source==='/research-checkout')?.destination,'/memberships');
assert.ok(config.rewrites.some(r=>r.source==='/subscribe-and-save'));
assert.ok(config.redirects.some(r=>r.source==='/offers'&&r.destination==='/shop'));
const forbiddenCopy=/\bBOGO\b|buy\s+more.{0,15}get\s+more|shop\s+the\s+(?:BOGO\s+)?sale|Alta Gold|Alta Platinum|PURE GOLD|PURE PLATINUM/i;
let pages=0;
for(const file of fs.readdirSync(out,{recursive:true}).filter(f=>f.endsWith('.html'))){
 const html=fs.readFileSync(path.join(out,file),'utf8'),dom=new JSDOM(html),doc=dom.window.document;
 const bundles = [...doc.querySelectorAll('link[rel="stylesheet"][href^="/pure-styles-"]')];
 const fontPreloads = [...doc.querySelectorAll('link[rel="preload"][as="font"]')];
 assert.equal(fontPreloads.length,1,'One local font preload: '+file);
 if (bundles.length) {
  const font = '/assets/fonts/archivo-normal-width-weight-variable.woff2';
  const sheets = bundles.map(link => fs.readFileSync(path.join(out, link.getAttribute('href')), 'utf8'));
  assert.ok(sheets.some(css => css.includes("font-family: 'Archivo'") && css.includes(font)),'Bundled shared typography: '+file);
  assert.equal(fontPreloads[0].getAttribute('href'),font,'Preload public font: '+file);
 } else {
  assert.equal(doc.querySelectorAll('link[href^="/pure-brand.css"]').length,1,'Shared typography: '+file);
  assert.equal(fontPreloads[0].getAttribute('href'),'/assets/fonts/archivo-latin-variable.woff','Preload original font: '+file);
 }
 if(file==='admin-orders.html'){
  const ordersScript=[...doc.querySelectorAll('script:not([src])')].find(script=>script.textContent.includes('async function loadOrders()'));
  assert.ok(ordersScript,'Orders script must be present in published HTML.');
  assert.doesNotThrow(()=>new Script(ordersScript.textContent,{filename:file}),'Orders script must survive build-time HTML injection.');
  assert.equal(doc.querySelectorAll('body > script[src^="/admin-gift-cards.js"]').length,1,'Gift card management must load outside the inline Orders script.');
 }
 if(!path.basename(file).startsWith('admin-')){
  doc.querySelectorAll('script,style').forEach(n=>n.remove());
  assert.doesNotMatch(doc.body.textContent,forbiddenCopy,'Retired visible copy: '+file);
  for(const a of doc.querySelectorAll('a[href]'))assert.doesNotMatch(a.getAttribute('href'),/^\/offers(?:[/.?#]|$)/,'Retired link: '+file);
 }
 dom.window.close();pages++;
}
assert.ok(fs.statSync(path.join(out,'assets/fonts/archivo-latin-variable.woff')).size>10000);
assert.ok(fs.existsSync(path.join(out,'assets/fonts/OFL.txt')));
assert.match(fs.readFileSync(path.join(out,'pure-brand.css'),'utf8'),/font-family: 'Archivo'/);
const sitemap=fs.readFileSync(path.join(out,'sitemap.xml'),'utf8');assert.match(sitemap,/memberships/);assert.doesNotMatch(sitemap,/research-builder|research-checkout/);assert.doesNotMatch(sitemap,/\/offers/);
console.log('Verified '+pages+' published pages, local typography, and restored PURE program routes and retirement of old promotions.');
