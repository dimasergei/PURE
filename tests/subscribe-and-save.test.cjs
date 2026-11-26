'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const planner = fs.readFileSync('subscribe-and-save.js', 'utf8');
const publicPage = fs.readFileSync('public-build/subscribe-and-save.html', 'utf8');
const planKey = 'pure-subscribe-plan-v1';

function openPlanner(path = '', draft = [], initialCart = [], monthly = false) {
  const dom = new JSDOM(publicPage, { url: 'https://getpurelabs.com/subscribe-and-save' + path, runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const catalog = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((id, index) => ({
    id, name: 'Fixture ' + id, category: 'injectables', group: 'Fixture group',
    variants: [{ size: '5mg', price: 10 + index }, { size: '10mg', price: 20 + index }]
  }));
  catalog.push({ id: 'supply', name: 'Supply', category: 'supplies', variants: [{ size: '10mL', price: 50 }] });
  catalog.push({ id: 'bac-3', name: 'Reconstitution Solution', category: 'supplies', variants: [{ size: '3 mL', price: 14.95 }] });
  const cart = [...initialCart];
  const added = [];
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  window.fetch = async url => ({ ok: true, json: async () => ({ available: monthly && url.endsWith('repeat_orders=status') }) });
  window.AltaStore = {
    catalog, cart, esc,
    addItems: items => added.push(...items),
    product: id => catalog.find(product => product.id === id),
    image: product => product?.id === 'bac-3' ? '/assets/fixture-gift.webp' : '/assets/fixture.webp',
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
    assert.ok(view.get('aside [data-pss-selection]'));
    assert.equal(view.get('.pss-benefits').querySelectorAll('li').length, 3);
    assert.equal(view.get('.pss-benefits a[href="/coas"]'), null);
    assert.equal(view.get('[data-pss-count]').textContent, '2 / 4');
    assert.equal(view.get('[data-pss-selection]').querySelectorAll('[data-pss-choose]').length, 2);
    assert.equal(view.card('alpha').querySelector('[data-pss-size][aria-pressed="true"]').dataset.pssSize, '10mg');
    assert.equal(view.card('supply'), null);
    assert.deepEqual(view.saved(), [{ id: 'beta', size: '5mg' }, { id: 'alpha', size: '10mg' }]);
    assert.equal(view.get('[data-pss-cart]').disabled, true);
    assert.equal(view.window.location.search, '');
    assert.deepEqual(view.added, []);
  } finally { view.close(); }
});

test('shows the chosen strength in the summary and adds the four selected variants through the normal cart', () => {
  const view = openPlanner();
  try {
    view.card('alpha').querySelector('[data-pss-size="10mg"]').click();
    for (const id of ['alpha', 'beta', 'gamma', 'delta']) view.pick(id);
    view.card('alpha').querySelector('[data-pss-size="5mg"]').click();
    assert.equal(view.get('[data-pss-count]').textContent, '4 / 4');
    assert.equal(view.card('epsilon').querySelector('[data-pss-pick]').disabled, true);
    assert.equal(view.get('[data-pss-another]'), null);
    const row = view.get('[data-pss-remove="0"]').closest('li');
    assert.equal(row.querySelector('select'), null);
    assert.equal(row.querySelector('small').textContent, '10mg');
    assert.equal(row.querySelector('.pss-row-price').textContent, '$20.00');
    assert.equal(view.get('[data-pss-subtotal]').textContent, '$56.00');
    view.get('[data-pss-cart]').click();
    assert.equal(view.opened(), 1);
    assert.deepEqual(JSON.parse(JSON.stringify(view.added)), [
      { id: 'alpha', size: '10mg', qty: 1 }, { id: 'beta', size: '5mg', qty: 1 },
      { id: 'gamma', size: '5mg', qty: 1 }, { id: 'delta', size: '5mg', qty: 1 }
    ]);
    view.get('[data-pss-remove="0"]').click();
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

test('restores an older larger draft and consolidates repeated variants for the cart', () => {
  const draft = Array.from({ length: 4 }, () => ({ id: 'alpha', size: '5mg' }));
  draft.push({ id: 'alpha', size: '10mg' });
  const view = openPlanner('', draft);
  try {
    assert.equal(view.get('[data-pss-count]').textContent, '5 / 8');
    assert.equal(view.get('[data-pss-cart]').disabled, true);
    for (let i = 0; i < 3; i++) view.pick('beta');
    assert.equal(view.get('[data-pss-count]').textContent, '8 / 8');
    assert.equal(view.get('[data-pss-subtotal]').textContent, '$93.00');
    assert.equal(view.get('[data-pss-monthly]').disabled, true);
    assert.equal(view.get('[data-pss-selection]').querySelectorAll('[data-pss-remove]').length, 8);
    assert.deepEqual([...view.get('[data-pss-selection]').querySelectorAll('.pss-set')].map(set => set.querySelectorAll('.pss-selected').length), [4, 4]);
    const restored = openPlanner('', view.saved());
    try {
      assert.equal(restored.get('[data-pss-subtotal]').textContent, '$93.00');
      restored.get('[data-pss-cart]').click();
      assert.deepEqual(JSON.parse(JSON.stringify(restored.added)), [
        { id: 'alpha', size: '5mg', qty: 4 }, { id: 'alpha', size: '10mg', qty: 1 }, { id: 'beta', size: '5mg', qty: 3 }
      ]);
    } finally { restored.close(); }
  } finally { view.close(); }
});

test('guards combined cart quantities when a selected variant repeats', () => {
  const draft = Array.from({ length: 4 }, () => ({ id: 'alpha', size: '5mg' }));
  const view = openPlanner('', draft, [{ key: 'alpha:5mg', qty: 97 }]);
  try {
    view.get('[data-pss-cart]').click();
    assert.deepEqual(view.added, []);
    assert.match(view.get('[data-pss-status]').textContent, /reduce items/);
  } finally { view.close(); }
});

test('only offers monthly checkout for eligible complete sets after a positive readiness response', async () => {
  const draft = Array.from({ length: 4 }, () => ({ id: 'beta', size: '5mg' }));
  const view = openPlanner('', draft, [], true);
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(view.get('[data-pss-monthly]').disabled, false);
    assert.equal(view.get('aside [data-pss-monthly]').textContent,'Continue · $26.40/mo');
    assert.equal(view.get('[data-pss-monthly-total]').textContent, '$26.40 /mo');
    assert.equal(view.get('[data-pss-subtotal]').textContent, '$58.95');
    assert.equal(view.get('[data-pss-subtotal] del').textContent, '$58.95');
    assert.equal(view.get('[data-pss-savings]').textContent, '−$17.60');
    assert.equal(view.get('[data-pss-gift-savings]').textContent, '−$14.95');
    assert.match(view.get('.pss-totals').textContent, /Express shipping U\.S\. & CanadaFree/);
    assert.deepEqual(Array.from(view.get('[data-pss-timeline]').children, node => node.textContent), ['Month 1', 'Month 2', 'Month 3']);
    assert.equal(view.card('beta').querySelector('.pss-card-price').textContent, '$6.60 /mo');
    assert.doesNotMatch(view.card('beta').textContent, /\$11\.00/);
    const row = view.get('[data-pss-remove="0"]').closest('li');
    assert.equal(row.querySelector('.pss-row-price').textContent, '$6.60');
    assert.equal(row.querySelector('del').textContent, '$11.00');
    assert.equal(view.get('[data-pss-selection]').querySelectorAll('.pss-included').length, 1);
    assert.equal(view.get('.pss-included img').getAttribute('src'), '/assets/fixture-gift.webp');
    assert.equal(view.get('.pss-included strong.pss-gift-label').textContent, 'Bundled');
    assert.equal(view.get('.pss-included del').textContent, '$14.95');
    view.get('[data-pss-remove="3"]').click();
    assert.equal(view.get('[data-pss-monthly]').disabled, true);
    assert.equal(view.get('[data-pss-monthly]').textContent, 'Choose 1 more');
    assert.equal(view.get('[data-pss-gift-line]').hidden, true);
  } finally { view.close(); }
});

test('mobile plan review exposes the shared summary and returns to product selection', () => {
  const view = openPlanner();
  try {
    view.get('[data-pss-mobile-review]').click();
    assert.equal(view.get('[data-pss-drawer]').open, true);
    assert.ok(view.get('[data-pss-drawer] #pss-plan'));
    assert.equal(view.get('[data-pss-selection]').querySelectorAll('[data-pss-choose]').length, 4);
    view.get('[data-pss-choose]').click();
    assert.equal(view.get('[data-pss-drawer]').open, false);
    assert.equal(view.get('[data-pss-drawer] #pss-plan'), null);
    assert.equal(view.window.document.activeElement, view.get('[data-pss-search]'));
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
