'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { handle } = require('../lib/guest-interac');
const { createCredential } = require('../lib/guest-checkout');
const { envelope } = require('../lib/invoice-notifications');

const env = { CHECKOUT_RATE_LIMIT_SECRET: 'fixture-only-key-for-existing-guest-credential' };
function fixture() {
  const id = randomUUID(), methodId = randomUUID();
  const headers = {};
  const response = {
    setHeader(key, value) { headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(value) { this.value = value; return this; }
  };
  const credential = createCredential(id, response, env);
  credential.issue();
  const req = { method: 'GET', headers: { cookie: headers['Set-Cookie'].split(';')[0] } };
  const payment = { kind: 'interac', currency: 'CAD', method_version: 3, payee: 'Fixture business',
    instructions: 'Fixture receiving details', payment_reference: 'ORDER-FIXTURE' };
  const row = {
    id, customer_id: credential.id, public_order_number: 'P00000123', kind: 'goods', status: 'accepted',
    currency: 'CAD', total_cents: 10245, expires_at: new Date(Date.now() + 3600000).toISOString(), method_id: methodId,
    request_data: { address: { country: 'CA' }, checkout: { guest: true }, preferred_payment: { provider_key: 'interac' } },
    payment_snapshot: payment
  };
  const method = { id: methodId, active: true, kind: 'interac', currency: 'CAD', version: 3, provider_key: 'interac', native_provider: null };
  const reads = [];
  const db = { from(table) {
    reads.push(table);
    const filters = {};
    const query = {
      select() { return query; },
      eq(key, value) { filters[key] = value; return query; },
      async maybeSingle() {
        const entry = table === 'commerce_invoices' ? row : method;
        return { data: Object.entries(filters).every(([key, value]) => entry[key] === value) ? entry : null };
      }
    };
    return query;
  } };
  return { id, req, row, method, response, headers, reads,
    run: (overrides = {}) => handle(req, response, overrides.id || id, { db, env, ...overrides }) };
}

test('guest Interac sends only the verified order total, status and its accepted transfer instructions', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.response.code, 200);
  assert.equal(f.headers['Cache-Control'], 'private, no-store');
  assert.equal(f.headers['Vary'], 'Cookie');
  assert.deepEqual(f.response.value, {
    order_number: 'P00000123', status: 'accepted', currency: 'CAD',
    total_cents: 10245, expires_at: f.row.expires_at,
    payment: { payee: 'Fixture business', instructions: 'Fixture receiving details', reference: 'ORDER-FIXTURE' }
  });
});

test('guest transfer details require the exact session cookie and invoice owner', async () => {
  const f = fixture();
  await f.run({ id: randomUUID() });
  assert.equal(f.response.code, 401);
  assert.deepEqual(f.reads, []);
  f.row.customer_id = randomUUID();
  await f.run();
  assert.equal(f.response.code, 404);
  assert.deepEqual(f.reads, ['commerce_invoices']);
});

test('settled, expired, canceled or changed Interac routes conceal receiving details', async () => {
  const f = fixture();
  f.row.status = 'paid';
  await f.run();
  assert.equal(f.response.value.status, 'paid');
  assert.equal(f.response.value.payment, null);
  f.row.status = 'accepted';
  await f.run({ now: () => Date.now() + 7200000 });
  assert.equal(f.response.value.status, 'expired');
  assert.equal(f.response.value.payment, null);
  f.row.cancellation_status = 'pending';
  await f.run();
  assert.equal(f.response.value.status, 'under_review');
  assert.equal(f.response.value.payment, null);
  f.row.cancellation_status = null;
  f.method.version++;
  await f.run();
  assert.equal(f.response.value.payment, null);
});

test('guest receipt leads to a CAD status page with no account session requirement', async t => {
  const f = fixture();
  await f.run();
  const path = '/guest-interac-pay.html?invoice=' + f.id;
  const receipt = envelope({
    audience: 'customer', event_action: 'checkout_placed',
    snapshot: { ...f.row, checkout_version: 'checkout-interac-cad-2026-11-v2',
      customer_email: 'guest@example.test', customer_name: 'Guest' },
    detail: { request_data: f.row.request_data, subtotal_cents: 10000, discount_cents: 0, shipping_cents: 245, tax_cents: 0,
      pricing: { currency: 'CAD', lines: [{ name: 'Fixture', qty: 1, gross_cents: 10000 }] } }
  }, {});
  assert.ok(receipt.text.includes('https://getpurelabs.com' + path));
  assert.ok(!receipt.text.includes(f.row.payment_snapshot.instructions));
  const dom = new JSDOM(readFileSync('guest-interac-pay.html','utf8'), { url: 'https://getpurelabs.com' + path, runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => w.close());
  w.fetch = async (url, options) => {
    assert.equal(url, '/api/customer-config?guest_interac=' + f.id);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers, undefined);
    return { ok: true, json: async () => f.response.value };
  };
  w.eval(readFileSync('guest-interac-pay.js','utf8'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.document.querySelector('#interac-total').textContent, '$102.45');
  assert.equal(w.document.querySelector('#interac-payment').hidden, false);
  assert.equal(w.document.querySelector('#interac-reference').textContent, 'ORDER-FIXTURE');
  f.row.status = 'paid';
  await f.run();
  w.document.querySelector('#interac-refresh').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.document.querySelector('#interac-status').textContent, 'Payment confirmed.');
  assert.equal(w.document.querySelector('#interac-payment').hidden, true);
});
