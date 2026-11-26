'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {JSDOM} = require('jsdom');
const {workspace} = require('../reference-ui-functions.cjs');
const read = file => readFileSync(file, 'utf8');

test('the retired worksheet still validates quantities without requesting an order or payment', () => {
  const js = read('bulk-preview.js');
  assert.match(js, /Number\.isSafeInteger/);
  assert.match(js, /worksheet\.set/);
  assert.doesNotMatch(js, /\bfetch\s*\(|location\.assign|window\.open|innerHTML\s*=/);
});

test('bulk quantities stay in a separate draft and checkout requires ten units per compound', async () => {
  const dom = new JSDOM(read('storefront-v2.html'), {url:'https://getpurelabs.com/bulk-orders',runScripts:'outside-only'});
  const {window} = dom;
  const {document} = window;
  const bytes = JSON.stringify([{id:'ghk-cu',size:'50mg',qty:2}]);
  const requests = [];
  try {
    window.localStorage.setItem('ap-age-verified','true');
    window.localStorage.setItem('pp-cart',bytes);
    window.matchMedia = () => ({matches:false});
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLDialogElement.prototype.showModal = function(){this.open = true;};
    window.HTMLDialogElement.prototype.close = function(){this.open = false;};
    window.fetch = async (url, options) => {
      requests.push([String(url),options?.method || 'GET']);
      return {ok:true,json:async () => []};
    };
    const scripts = ['products.js','product-images.js','quantity-pricing.js','storefront-v2.js'].map(read);
    scripts.push(read('workspace-v2.js').replace(' window.AltaWorkspace=',
      '\n bulkPage = ' + workspace.bulkPage.toString() + ';\n window.AltaWorkspace='));
    window.eval(scripts.join('\n'));
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise(resolve => setTimeout(resolve,0));
    assert.ok(document.querySelector('#ap-nav a[href="/bulk-orders"]'));
    assert.ok(document.querySelector('#ap-cart-dialog'));
    const savedCart = window.localStorage.getItem('pp-cart');
    const checkout = () => document.querySelector('[data-action="bulk-checkout"]');
    const input = document.querySelector('[data-bulk-id="bpc-157"]');
    const setQuantity = value => {
      input.value = value;
      input.dispatchEvent(new window.Event('input',{bubbles:true}));
    };
    assert.equal(checkout().disabled,true);
    setQuantity('9');
    assert.equal(checkout().disabled,true);
    assert.equal(document.querySelector('.nl-bulk-estimate-total del'),null);
    assert.equal(document.querySelector('.nl-bulk-included-shipping'),null);
    setQuantity('10');
    assert.equal(checkout().disabled,false);
    assert.match(document.querySelector('#ap-bulk-summary').textContent,/50% off/);
    assert.ok(input.closest('article').querySelector('.nl-bulk-sizes button[aria-pressed=true] del'));
    const line = document.querySelector('.nl-bulk-menu-line-price');
    assert.deepEqual([...line.children].map(child => child.tagName),['STRONG','DEL']);
    assert.equal(document.querySelector('.nl-bulk-estimate-total del').textContent,line.querySelector('del').textContent);
    assert.match(document.querySelector('.nl-bulk-tier-savings strong').textContent,/^−/);
    assert.equal(document.querySelector('.nl-bulk-included-shipping strong').textContent,'FREE');
    assert.match(document.querySelector('.nl-bulk-included-shipping small').textContent,/U\.S\./);
    assert.deepEqual(JSON.parse(window.localStorage.getItem('ap-bulk-draft-v2')),[
      {id:'bpc-157',size:input.dataset.bulkSize,qty:10}
    ]);
    assert.equal(window.localStorage.getItem('pp-cart'),savedCart);
    assert.ok(requests.every(([,method]) => method === 'GET'));
  } finally {
    window.close();
  }
});
