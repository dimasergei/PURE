'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const planner = fs.readFileSync('subscribe-and-save.js', 'utf8');
const publicPage = fs.readFileSync('public-build/subscribe-and-save.html', 'utf8');
const planKey = 'pure-subscribe-plan-v1';

function openPlanner(path = '', draft = [], initialCart = []) {
  const dom = new JSDOM(publicPage, { url: 'https://getpurelabs.com/subscribe-and-save' + path, runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  const catalog = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((id, index) => ({
    id, name: 'Fixture ' + id, category: 'injectables', group: 'Fixture group',
    variants: [{ size: '5mg', price: 10 + index }, { size: '10mg', price: 20 + index }]
  }));
  catalog.push({ id: 'supply', name: 'Supply', category: 'supplies', variants: [{ size: '10mL', price: 50 }] });
  const cart = [...initialCart];
  const added = [];
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  window.AltaStore = {
    catalog, cart, esc,
    addItems: items => added.push(...items),
    product: id => catalog.find(product => product.id === id),
    image: () => '/assets/fixture.webp',
    priceMarkup: amount => '$' + amount.toFixed(2),
    read: key => JSON.parse(window.localStorage.getItem(key)),
    write: (key, value) => {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    }
  };
  window.localStorage.setItem(planKey, JSON.stringify(draft));
  let opened = 0;
  document.querySelector('.ap-header [data-action="cart"]').addEventListener('click', () => { opened += 1; });
  window.eval(planner);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const get = selector => document.querySelector(selector);
  const card = id => get('[data-pss-product="' + id + '"]');
  return {
    window, added, get, card, opened: () => opened,
    pick: id => card(id).querySelector('[data-pss-pick]').click(),
    saved: () => JSON.parse(window.localStorage.getItem(planKey)),
    close: () => dom.window.close()
  };
}

test('preselects the exact linked strength and preserves the locally saved plan', () => {
  const view = openPlanner('?product=alpha&size=10mg', [{ id: 'beta', size: '5mg' }, { id: 'supply', size: '10mL' }]);
  try {
    assert.equal(view.get('h1').textContent, 'SUBSCRIBE & SAVE.');
    assert.match(view.get('.pss-plan-note').textContent, /Automatic renewals are unavailable/);
    assert.equal(view.get('[data-pss-count]').textContent, '2 / 4');
    assert.equal(view.card('alpha').querySelector('select').value, '10mg');
    assert.equal(view.card('supply'), null);
    assert.deepEqual(view.saved(), [{ id: 'beta', size: '5mg' }, { id: 'alpha', size: '10mg' }]);
    assert.equal(view.get('[data-pss-cart]').disabled, true);
    assert.equal(view.window.location.search, '');
    assert.deepEqual(view.added, []);
  } finally { view.close(); }
});

test('changes the chosen strength and adds exactly four product variants through the normal cart', () => {
  const view = openPlanner();
  try {
    for (const id of ['alpha', 'beta', 'gamma', 'delta']) view.pick(id);
    assert.equal(view.get('[data-pss-count]').textContent, '4 / 4');
    assert.equal(view.card('epsilon').querySelector('[data-pss-pick]').disabled, true);
    const select = view.card('alpha').querySelector('select');
    select.value = '10mg';
    select.dispatchEvent(new view.window.Event('change', { bubbles: true }));
    assert.equal(view.get('[data-pss-subtotal]').textContent, '$56.00');
    view.get('[data-pss-cart]').click();
    assert.equal(view.opened(), 1);
    assert.deepEqual(JSON.parse(JSON.stringify(view.added)), [
      { id: 'alpha', size: '10mg', qty: 1 }, { id: 'beta', size: '5mg', qty: 1 },
      { id: 'gamma', size: '5mg', qty: 1 }, { id: 'delta', size: '5mg', qty: 1 }
    ]);
    view.get('[data-pss-remove="alpha"]').click();
    assert.equal(view.get('[data-pss-cart]').disabled, true);
    assert.equal(view.saved().length, 3);
  } finally { view.close(); }
});

test('preserves a full plan and prevents cart quantity truncation', () => {
  const draft = ['alpha', 'beta', 'gamma', 'delta'].map(id => ({ id, size: '5mg' }));
  const view = openPlanner('?product=epsilon&size=10mg', draft, [{ key: 'alpha:5mg', qty: 100 }]);
  try {
    assert.deepEqual(view.saved(), draft);
    assert.match(view.get('[data-pss-status]').textContent, /plan is full/);
    view.get('[data-pss-cart]').click();
    assert.deepEqual(view.added, []);
    assert.equal(view.opened(), 0);
    assert.match(view.get('[data-pss-status]').textContent, /reduce items/);
  } finally { view.close(); }
});

test('the published storefront router leaves the dedicated plan page mounted', async () => {
  const dom = new JSDOM(publicPage, { url: 'https://getpurelabs.com/subscribe-and-save', runScripts: 'outside-only' });
  const { window } = dom;
  try {
    window.matchMedia = () => ({ matches: false });
    window.fetch = async () => ({ ok: true, json: async () => [] });
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    for (const script of ['products.js', 'product-images.js', 'storefront-v2.js']) {
      window.eval(fs.readFileSync('public-build/' + script, 'utf8'));
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    window.AltaStore.render();
    assert.ok(window.document.querySelector('#subscribe-and-save-main [data-pss-planner]'));
    assert.equal(window.document.querySelector('a.ap-skip').getAttribute('href'), '#subscribe-and-save-main');
  } finally {
    window.close();
  }
});
