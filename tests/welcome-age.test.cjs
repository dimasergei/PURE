'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { country } = require('../lib/display-locale');

const dialog = fs.readFileSync('site-build.cjs', 'utf8').match(/<dialog id="ap-age-dialog"[\s\S]*?<\/dialog>/)[0];
const storefront = fs.readFileSync('storefront-v2.js', 'utf8');

function fixture(t, prior) {
  const dom = new JSDOM('<main id="ap-main"></main>' + dialog, { url: 'https://getpurelabs.com/shop', runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => w.close());
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.fetch = async () => ({ ok: true, json: async () => [] });
  if (prior !== undefined) w.localStorage.setItem('ap-age-verified', JSON.stringify(prior));
  let resolve;
  w.AltaLocale = { countryReady: new Promise(r => { resolve = r; }), onChange() {}, t(_key, fallback) { return fallback; } };
  w.eval(storefront);
  return { w, gate: w.document.querySelector('dialog'), async detect(code) {
    Object.assign(w.AltaLocale, country({ headers: { 'x-vercel-ip-country': code } }));
    resolve();
    await new Promise(r => setImmediate(r));
  }};
}

test('the Canadian welcome waits for location and saves a regional 19+ confirmation', async t => {
  const page = fixture(t, true);
  const accept = page.gate.querySelector('[data-action="age-confirm"]');
  assert.equal(page.gate.open, true);
  assert.equal(accept.disabled, true);
  assert.equal(page.gate.querySelector('h2').textContent, 'Welcome to PURE');
  await page.detect('CA');
  assert.equal(page.gate.querySelector('h2').textContent, '19+ only');
  assert.match(page.gate.querySelector('[data-age-research]').textContent, /Purchasers must be 21/);
  page.gate.querySelector('[data-action="age-exit"]').click();
  assert.equal(page.gate.open, true);
  assert.match(page.gate.querySelector('#ap-age-message').textContent, /19\+/);
  accept.click();
  assert.equal(page.gate.open, false);
  assert.equal(JSON.parse(page.w.localStorage.getItem('ap-age-verified')), 'welcome-1:CA:19');
});

test('a saved confirmation applies to the same region and policy version only', async t => {
  const same = fixture(t, 'welcome-1:CA:19');
  await same.detect('CA');
  assert.equal(same.gate.open, false);
  const different = fixture(t, 'welcome-1:CA:19');
  await different.detect('US');
  assert.equal(different.gate.open, true);
  assert.equal(different.gate.querySelector('h2').textContent, '21+ only');
});
