'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { handle } = require('../lib/gift-card-inquiry');
const root = path.join(__dirname, '..');
const user = { email: 'customer@example.test', email_confirmed_at: '2026-01-01' };
const example = { request_id: 'f1643e57-861b-4df2-8fad-70dfa8e9ba77', amount_cents: 2525, mode: 'gift', consent: true,
  recipient_email: 'recipient@example.test', confirm_email: 'recipient@example.test', note: 'Thank you', send_date: '2026-12-24' };
async function post(body, verifiedUser = user) {
  let inquiry;
  const req = { method: 'POST', headers: { origin: 'https://getpurelabs.com', authorization: 'Bearer ' + 'A'.repeat(30), 'content-type': 'application/json' }, body };
  const res = { status(n) { this.code = n; return this; }, json(data) { this.body = data; }, setHeader() {} };
  await handle(req, res, { env: { SITE_URL: 'https://getpurelabs.com', CHECKOUT_RATE_LIMIT_SECRET: 'test' },
    db: { auth: { getUser: async () => ({ data: { user: verifiedUser } }) } }, rateLimit: async () => {},
    storeRequest: async (_db, data) => { inquiry = data; return { email_status: 'queued' }; },
    deliverRequest: async () => ({ email_status: 'queued' }) });
  return { res, inquiry };
}

test('gift card inquiries use the verified purchaser email, store an inquiry and return a receipt', async () => {
  const { res, inquiry } = await post({ ...example, email: 'spoof@example.test' });
  assert.equal(res.code, 202);
  assert.equal(inquiry.email, user.email);
  assert.equal(inquiry.type, 'contact');
  assert.equal(inquiry.topic, 'Gift card availability');
  assert.deepEqual(inquiry.items, []);
  assert.match(inquiry.message, /USD 25\.25/);
  assert.match(inquiry.message, /recipient@example\.test/);
  assert.ok(res.body.saved);
  assert.equal(res.body.reference, 'REQ-' + example.request_id.toUpperCase());
});
test('recipient information is excluded from requests for oneself', async () => {
  const { res, inquiry } = await post({ ...example, mode: 'self' });
  assert.equal(res.code, 202);
  assert.doesNotMatch(inquiry.message, /recipient@example\.test|Thank you/);
});
test('invalid amounts, dates, recipient confirmation, missing consent, and unverified accounts cannot submit', async () => {
  for (const patch of [{ amount_cents: 2499 }, { amount_cents: 100001 }, { amount_cents: 5000.1 }, { send_date: '2026-02-31' },
    { confirm_email: '' }, { consent: false }]) {
    const { res, inquiry } = await post({ ...example, ...patch });
    assert.equal(res.code, 400);
    assert.equal(inquiry, undefined);
  }
  assert.equal((await post(example, { ...user, email_confirmed_at: null })).res.code, 401);
});
test('gift card page validates addresses, handles self mode, and confirms only saved inquiries', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'lib/templates/gift-cards.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://getpurelabs.com/gift-cards' });
  const w = dom.window;
  const form = w.document.querySelector('form');
  const input = form.elements;
  const fire = (element, type) => element.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
  const tick = () => new Promise(resolve => setImmediate(resolve));
  let payload;
  w.AltaWorkspace = { authClient: async () => ({ auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: { access_token: 'example' } } }) } }) };
  w.fetch = async (url, options) => {
    if (url.endsWith('gift_order=availability')) return {ok:true,json:async()=>({available:false,currency:'USD'})};
    if (url.endsWith('gift_order=account')) return {ok:true,json:async()=>({received:[],purchases:[]})};
    assert.equal(url, '/api/customer-config?gift_card=request');
    assert.equal(options.headers.Authorization, 'Bearer example');
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ saved: true, reference: 'REQ-EXAMPLE' }) };
  };
  w.eval(fs.readFileSync(path.join(root, 'gift-cards.js'), 'utf8'));
  await tick();
  form.querySelector('[data-value="500"]').click();
  assert.equal(w.document.querySelector('[data-gift-preview]').textContent, '$500');
  input.amount.value = '35.75'; fire(input.amount, 'input');
  assert.equal(w.document.querySelector('[data-gift-preview]').textContent, '$35.75');
  input.recipientEmail.value = 'a@example.test'; fire(input.recipientEmail, 'input');
  assert.ok(!input.confirmEmail.checkValidity());
  form.querySelector('[value="self"]').click();
  assert.ok(input.confirmEmail.disabled);
  assert.ok(w.document.querySelector('[data-gift-recipient]').hidden);
  input.consent.checked = true;
  fire(form, 'submit'); await tick();
  assert.equal(payload.amount_cents, 3575);
  assert.equal(payload.recipient_email, '');
  assert.equal(payload.mode, 'self');
  assert.match(w.document.querySelector('[role="status"]').textContent, /REQ-EXAMPLE/);
  assert.ok(form.querySelector('[type="submit"]').disabled);
  dom.window.close();
});
