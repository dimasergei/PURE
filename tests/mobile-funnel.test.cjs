'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const { browserGroup, checkoutAttribution, handle } = require('../lib/mobile-funnel');

const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const chrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36';

test('mobile counts distinguish target browsers from in-app clients and honor opt-outs', () => {
  const classify = (ua, headers = {}) => browserGroup({ 'user-agent': ua, ...headers });
  assert.equal(classify(safari), 'iphone_safari');
  assert.equal(classify(chrome, { 'sec-ch-ua': '"Chromium";v="135", "Google Chrome";v="135"' }), 'android_chrome');
  assert.equal(classify(chrome, { 'sec-ch-ua': '"Chromium";v="135", "Brave";v="135"' }), null);
  assert.equal(classify(safari.replace('Version/18.6', 'CriOS/135.0.0')), null);
  assert.equal(classify(safari + ' Instagram 401.0'), null);
  assert.equal(classify(chrome.replace('; K)', '; K; wv)')), null);
  assert.equal(classify(chrome, { dnt: '1' }), null);
  assert.equal(classify(safari, { 'sec-gpc': '1' }), null);
});

test('only ordinary placed checkout can inherit a validated browser/day cohort', () => {
  const req = { headers: { 'user-agent': chrome } };
  const now = new Date('2026-11-26T23:59:01.000Z');
  const record = { kind: 'goods', request: { checkout: {} } };
  const body = { funnel_day: '2026-11-26' };
  assert.deepEqual(checkoutAttribution(req, body, record, now), { browser: 'android_chrome', day: '2026-11-26' });
  assert.equal(checkoutAttribution(req, { funnel_day: '2026-10-14' }, record, now), null);
  assert.equal(checkoutAttribution(req, body, { ...record, kind: 'membership' }, now), null);
  assert.equal(checkoutAttribution(req, body, { ...record, request: { ...record.request, research_builder_mode: 'member_stack' } }, now), null);
  assert.equal(checkoutAttribution({ headers: { ...req.headers, dnt: '1' } }, body, record, now), null);
});

test('client posts an allowlisted anonymous stage once per tab and suppresses opt-outs', async () => {
  const values = new Map(), posts = [];
  const navigator = {};
  const ctx = {
    location: { origin: 'https://getpurelabs.com' }, navigator, window: {},
    sessionStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    fetch: async (...args) => { posts.push(args); return { ok: true }; }
  };
  vm.runInNewContext(readFileSync('mobile-funnel.js', 'utf8'), ctx);
  const { mark, cohort } = ctx.window.PureFunnel;
  mark('cart');
  mark('cart');
  mark('checkout');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(posts.map(([, options]) => JSON.parse(options.body)), [{ stage: 'cart' }, { stage: 'checkout' }]);
  assert.ok(posts.every(([url, options]) => url.startsWith('/') && options.credentials === 'omit' && options.referrerPolicy === 'no-referrer'));
  assert.match(cohort(), /^\d{4}-\d{2}-\d{2}$/);
  navigator.globalPrivacyControl = true;
  assert.equal(cohort(), undefined);
  values.clear();
  mark('cart');
  assert.equal(posts.length, 2);
});

test('public event handler persists only the derived bucket and stage', async () => {
  const req = {
    method: 'POST', headers: { origin: 'https://getpurelabs.com', 'content-type': 'application/json', 'user-agent': safari },
    body: { stage: 'checkout' }, socket: { remoteAddress: '127.0.0.1' }
  };
  const calls = [];
  const deps = {
    env: { SITE_URL: 'https://getpurelabs.com' },
    db: { rpc: async (name, payload) => { calls.push([name, payload]); return {}; } },
    rateLimit: async () => {}
  };
  const status = [];
  const res = { status(code) { status.push(code); return this; }, end() {} };
  await handle(req, res, 'event', deps);
  await handle({ ...req, body: { stage: 'checkout', email: 'fixture@example.invalid' } }, res, 'event', deps);
  await handle({ ...req, headers: { ...req.headers, 'sec-gpc': '1' } }, res, 'event', deps);
  await handle({ ...req, headers: { ...req.headers, origin: 'https://other.example' } }, res, 'event', deps);
  assert.deepEqual(status, [204, 400, 204, 403]);
  assert.deepEqual(calls, [['pure_record_mobile_funnel', { p_browser: 'iphone_safari', p_stage: 'checkout' }]]);
  await handle({ method: 'GET', headers: {} }, { status: res.status, json() {} }, 'report', deps);
  assert.equal(status.at(-1), 401);
});

test('report groups daily events and counts only verified, eligible paid invoice cohorts', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create schema commerce_internal;
      create table public.commerce_invoices(id int primary key, kind text, paid_at timestamptz, total_cents integer, request_data jsonb);
      create table public.commerce_gateway_attempts(invoice_id int, operation text, mode text, state text);
    `);
    await db.exec(readFileSync('supabase/migrations/20261126020506_mobile_checkout_funnel.sql', 'utf8'));
    await db.exec(`
      set role service_role;
      select public.pure_record_mobile_funnel('android_chrome', 'cart');
      select public.pure_record_mobile_funnel('android_chrome', 'cart');
      select public.pure_record_mobile_funnel('android_chrome', 'checkout');
      reset role;
      with data as (
        select jsonb_build_object('measurement', jsonb_build_object('browser', 'android_chrome', 'day', (now() at time zone 'UTC')::date)) as order_data
      )
      insert into public.commerce_invoices values
        (1, 'goods', now(), 1000, (select order_data from data)),
        (2, 'goods', null, 1000, (select order_data from data)),
        (3, 'goods', now(), 1000, (select order_data from data)),
        (4, 'goods', now(), 0, (select order_data from data)),
        (5, 'goods', now(), 99, (select order_data || '{"checkout":{"coupon":"CARDTEST"}}' from data)),
        (6, 'membership', now(), 1000, (select order_data from data));
      insert into public.commerce_gateway_attempts values (3, 'sale', 'sandbox', 'paid');
      set role service_role;
    `);
    const { rows } = await db.query('select * from public.pure_mobile_funnel_report() order by browser');
    assert.deepEqual(rows, [
      { browser: 'android_chrome', carts: 2, checkouts: 1, paid: 1 },
      { browser: 'iphone_safari', carts: 0, checkouts: 0, paid: 0 }
    ]);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.pure_mobile_funnel_report()'), /permission denied/);
  } finally {
    await db.close();
  }
});
