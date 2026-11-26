'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findOrder, handle } = require('../lib/track-order');

const address = 'checkout@example.com';
const reference = 'P00001234';
const env = {
  SITE_URL: 'https://getpurelabs.com',
  CHECKOUT_RATE_LIMIT_SECRET: 'test-key-with-at-least-thirty-two-bytes',
  RESEND_API_KEY: 'fake-mail-provider-key',
  ORDER_CONFIRMATION_FROM: 'PURE <support@getpurelabs.com>'
};
const stored = {
  customer_email: 'Checkout@Example.com', status: 'shipped',
  tracking_carrier: 'UPS', tracking_number: '1Z100&test',
  shipping_address: 'private', payment_snapshot: 'private'
};

function request(body, options = {}) {
  return {
    method: 'POST', headers: { origin: env.SITE_URL, 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.20' }, body, ...options
  };
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function dbWith(legacy, commerce, queries = []) {
  return {
    from(table) {
      const clauses = [];
      const query = { table, clauses };
      queries.push(query);
      return {
        select(fields) { query.fields = fields; return this; },
        eq(...args) { clauses.push(['eq', ...args]); return this; },
        gte(...args) { clauses.push(['gte', ...args]); return this; },
        lte(...args) { clauses.push(['lte', ...args]); return this; },
        is(...args) { clauses.push(['is', ...args]); return this; },
        limit() { return { data: table === 'store_orders' ? legacy : commerce }; }
      };
    }
  };
}

function dependencies(order, unique = {}) {
  return {
    env, db: {}, delay: async () => {}, rateLimit: async () => {},
    findOrder: async () => order, send: async () => {}, ...unique
  };
}

const requestBody = { email: address, order_number: reference };

test('queries exact current and legacy references and never returns an email mismatch', async () => {
  const queries = [];
  assert.equal(await findOrder(dbWith([], [stored], queries), reference, 'other@example.com'), null);
  assert.deepEqual(queries.map(q => [q.table, q.clauses]), [
    ['store_orders', [['eq', 'order_number', reference]]],
    ['commerce_invoices', [['eq', 'kind', 'goods'], ['eq', 'public_order_number', reference]]]
  ]);
  assert.ok(queries.every(q => !/address|payment_snapshot|request_data/.test(q.fields)));
  assert.equal(await findOrder(dbWith([], [stored]), reference, address), stored);
  assert.equal(await findOrder(dbWith([stored], [stored]), reference, address), null);
});

test('supports unnumbered legacy commerce references within the UUID prefix range', async () => {
  const queries = [];
  await findOrder(dbWith([], [], queries), 'AP0123456789', address);
  assert.deepEqual(queries[1].clauses, [
    ['eq', 'kind', 'goods'], ['is', 'public_order_number', null],
    ['gte', 'id', '01234567-8900-0000-0000-000000000000'],
    ['lte', 'id', '01234567-89ff-ffff-ffff-ffffffffffff']
  ]);
});

test('sends minimal order data to the stored address and returns identical generic responses', async () => {
  const limits = [], sent = [], windows = [];
  const match = response(), miss = response();
  await handle(request({ email: ' Checkout@Example.com ', order_number: ' p00001234 ' }), match, dependencies(stored, {
    rateLimit: async (db, scope) => limits.push(scope),
    delay: async ms => windows.push(ms),
    findOrder: async (db, orderNumber, customer) => {
      assert.equal(orderNumber, reference);
      assert.equal(customer, address);
      assert.equal(limits.length, 3, 'rate limits run before lookup');
      return stored;
    },
    send: async (...args) => sent.push(args)
  }));
  await handle(request(requestBody), miss, dependencies(null, {
    delay: async ms => windows.push(ms), send: async (...args) => sent.push(args)
  }));
  assert.deepEqual(limits, ['track-order:network:203.0.113.20', `track-order:email:${address}`, `track-order:reference:${reference}`]);
  assert.deepEqual(windows, [2000, 2000]);
  assert.equal(match.statusCode, 202);
  assert.equal(miss.statusCode, match.statusCode);
  assert.deepEqual(miss.body, match.body);
  assert.equal(match.headers['Cache-Control'], 'no-store');
  assert.equal(sent.length, 1);
  const [[message, options]] = sent;
  assert.deepEqual(message.to, ['Checkout@Example.com']);
  assert.match(message.text, /Status: Shipped/);
  assert.match(message.text, /https:\/\/www\.ups\.com\/track\?tracknum=1Z100%26test/);
  assert.match(message.html, /Tracking number: 1Z100&amp;test/);
  assert.match(options.idempotencyKey, /^pure-track-order\/[a-f0-9]{64}$/);
  assert.doesNotMatch(message.text + message.html, /private|secret|checkout@example\.com/i);
  assert.doesNotMatch(JSON.stringify(match.body), /1Z100|P00001234|checkout@example\.com/i);
});

test('rejects invalid requests and fails closed before lookup when configuration or rate limits fail', async () => {
  const source = request(requestBody, { headers: { origin: 'https://example.com', 'content-type': 'application/json' } });
  const inputs = [
    [source, {}, 403], [request(requestBody, { method: 'GET' }), {}, 405],
    [request({ email: 'bad', order_number: reference }), {}, 400],
    [request(requestBody), { env: { ...env, RESEND_API_KEY: '' } }, 503],
    [request(requestBody), { env: { ...env, VERCEL_ENV: 'preview', SUPABASE_URL: 'https://production.supabase.co' } }, 503],
    [request(requestBody), { rateLimit: async () => { throw Object.assign(Error(), { status: 429 }); } }, 429]
  ];
  let lookupCalls = 0;
  for (const [req, dep, expected] of inputs) {
    const res = response();
    await handle(req, res, dependencies(null, { findOrder: async () => { lookupCalls += 1; }, ...dep }));
    assert.equal(res.statusCode, expected);
  }
  assert.equal(lookupCalls, 0);
});

test('tracking page posts checkout details privately and displays the generic acknowledgement', async () => {
  const { readFileSync } = require('node:fs');
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<main id="ap-main"></main>', { url: 'https://getpurelabs.com/track-order', runScripts: 'outside-only' });
  try {
    const { window: w } = dom;
    const { document: d } = w;
    w.AltaStore = {
      $: (selector, root = d) => root.querySelector(selector), catalog: [],
      normalizeLines: value => value, read: (key, fallback) => fallback, route: () => '/track-order',
      heading: (brand, title, intro) => `<h1>${title}</h1><p>${intro}</p>`
    };
    let posted;
    w.fetch = async (...args) => {
      posted = args;
      return { ok: true, json: async () => ({ message: 'If the order matches, check your email.' }) };
    };
    w.eval(readFileSync('workspace-v2.js', 'utf8'));
    const form = d.querySelector('#ap-track-order-form');
    const submit = form.querySelector('button');
    assert.equal(form.method, 'post');
    form.elements.order_number.value = reference;
    form.elements.email.value = address;
    const event = new w.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(submit.disabled, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(posted[0], '/api/customer-config?track_order=request');
    assert.equal(posted[1].method, 'POST');
    assert.deepEqual(JSON.parse(posted[1].body), requestBody);
    assert.equal(form.querySelector('[role="status"]').textContent, 'If the order matches, check your email.');
    assert.equal(form.elements.email.value, '');
    assert.equal(submit.disabled, false);
  } finally {
    dom.window.close();
  }
});
