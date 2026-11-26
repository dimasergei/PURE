'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {site, promoVisible} = require('../config/site.ts');
const buildFacts = require('../site-facts-build.cjs');
const checkout = require('../config/checkout.json');
const delivery = require('../lib/delivery-options.js');

test('published thresholds, destinations and free services match checkout quoting rules', () => {
  assert.equal(site.shipping.freeThresholdCents, checkout.free_shipping_threshold_cents);
  assert.equal(site.shipping.giftThresholdCents, require('../lib/order-thresholds.js').bacMinimum);
  for (const country of ['US', 'CA', 'GB']) {
    for (const service of Object.keys(delivery.countryRates(country))) {
      const quote = delivery.price({shipping: service, extras: []}, true, delivery.defaults, country);
      assert.equal(site.shipping.freeServices[country]?.includes(service) || false, quote.shipping_cents === 0);
    }
  }
  assert.match(site.shipping.giftSummary, /signed in/);
  assert.match(site.shipping.giftSummary, /undiscounted/);
  assert.equal(site.shipping.protectionCents, delivery.defaults.find(x => x.id === 'protection').price_cents);
});

test('missing, invalid and expired promotion deadlines cannot advertise urgency', () => {
  const end = '2026-11-27T16:00:00.000Z';
  const now = Date.parse(end);
  for (const value of [null, undefined, 'unknown']) assert.equal(promoVisible({code:'TEST', endsAt:value}, now), false);
  assert.equal(promoVisible({code:'TEST', endsAt:end}, now - 1), true);
  assert.equal(promoVisible({code:'TEST', endsAt:end}, now), false);
  assert.equal(promoVisible({code:'TEST', endsAt:end}, now + 1), false);
});

test('static policy facts and client configuration are available on clean nested pages', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(),'pure-site-facts-'));
  t.after(() => fs.rmSync(out,{recursive:true,force:true}));
  fs.mkdirSync(path.join(out,'shipping-policy'));
  const original = '<!doctype html><html><head><meta charset="utf-8"><script src="/app.js" defer></script></head><body><p data-site-fact="shipping.giftSummary">stale</p><span data-site-money="shipping.rates.CA.standard">stale</span></body></html>';
  const page = path.join(out,'shipping-policy/index.html');
  fs.writeFileSync(page, original);
  fs.writeFileSync(path.join(out,'admin-orders.html'), original);
  buildFacts(out);
  const built = fs.readFileSync(page,'utf8');
  buildFacts(out);
  assert.equal(fs.readFileSync(page,'utf8'),built);
  assert.equal(fs.readFileSync(path.join(out,'admin-orders.html'),'utf8'),original);
  const dom = new JSDOM(built,{runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.querySelector('[data-site-fact]').textContent,site.shipping.giftSummary);
  assert.equal(doc.querySelector('[data-site-money]').textContent,'US$24.95');
  assert.equal(doc.scripts[0].hasAttribute('data-pure-site-facts'),true);
  dom.window.eval(doc.scripts[0].textContent);
  assert.equal(dom.window.PureSite.returns.windowDays,site.returns.windowDays);
});
