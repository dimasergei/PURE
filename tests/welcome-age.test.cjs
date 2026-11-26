'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const dialog = fs.readFileSync('site-build.cjs', 'utf8').match(/<dialog id="ap-age-dialog"[\s\S]*?<\/dialog>/)[0];
const storefront = fs.readFileSync('storefront-v2.js', 'utf8');

function fixture(t, {prior, cookie} = {}) {
  const dom = new JSDOM('<main id="ap-main"></main>' + dialog, { url: 'https://getpurelabs.com/shop', runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => w.close());
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.fetch = async () => ({ ok: true, json: async () => [] });
  if (cookie) w.document.cookie = cookie + '; Path=/';
  if (prior !== undefined) w.localStorage.setItem('ap-age-verified', JSON.stringify(prior));
  w.AltaLocale = {countryReady: new Promise(() => {}), onChange() {}, t(_key, fallback) { return fallback; }};
  w.eval(storefront);
  return {w, gate: w.document.querySelector('dialog')};
}

test('the original 21+ dialog is ready immediately even when location never resolves', t => {
  const {w,gate} = fixture(t, {prior:true});
  const accept = gate.querySelector('[data-action="age-confirm"]');
  assert.equal(gate.open,true);
  assert.equal(gate.querySelector('h2').textContent,'21+ only');
  assert.equal(gate.querySelector('[data-age-loading]').hidden,true);
  assert.equal(gate.querySelector('[data-age-options]').hidden,false);
  assert.equal(accept.disabled,false);
  assert.equal(w.document.activeElement,accept);
  gate.querySelector('[data-action="age-exit"]').click();
  assert.equal(gate.open,true);
  assert.match(gate.querySelector('#ap-age-message').textContent,/21\+/);
  assert.equal(w.document.cookie,'');
  accept.click();
  assert.equal(gate.open,false);
  assert.equal(w.document.cookie,'pure_age=21-v1');
  const cookie = w.document.cookie;
  assert.equal(fixture(t,{cookie}).gate.open,false);
});

test('a current consent cookie skips the dialog regardless of legacy regional storage', t => {
  const {gate} = fixture(t, {prior:'welcome-1:CA:19',cookie:'pure_age=21-v1'});
  assert.equal(gate.open,false);
  assert.equal(fixture(t,{cookie:'pure_age=19-v1'}).gate.open,true);
  assert.equal(fixture(t,{cookie:'pure_age=21-v10'}).gate.open,true);
});

test('only a qualifying earlier consent migrates once to the current cookie', t => {
  const saved=fixture(t,{prior:'welcome-1:US:21'});
  assert.equal(saved.gate.open,false);
  assert.equal(saved.w.document.cookie,'pure_age=21-v1');
  assert.equal(saved.w.localStorage.getItem('ap-age-verified'),null);
  const tooYoung=fixture(t,{prior:'welcome-1:CA:19'});
  assert.equal(tooYoung.gate.open,true);
  assert.equal(tooYoung.w.document.cookie,'');
});
