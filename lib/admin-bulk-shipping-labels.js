'use strict';

const shipping = require('./admin-shipping-labels');
const { readPreferences } = require('./admin-shipping-preferences');

const MAX_BATCH = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_ID = /^[0-9a-f]{32}$/i;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function batchOrders(input, requiresLabel = false) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_BATCH) {
    fail(400, `Choose between 1 and ${MAX_BATCH} orders for a shipping label batch.`);
  }
  const orders = new Set();
  const labels = new Set();
  return input.map(row => {
    if (!object(row) || typeof row.id !== 'string' || !UUID.test(row.id) || !['commerce', 'store'].includes(row.source)) {
      fail(400, 'A shipping batch can only contain physical orders.');
    }
    const id = row.id.toLowerCase();
    const key = row.source + ':' + id;
    if (orders.has(key)) fail(400, 'An order may only appear once in a shipping label batch.');
    orders.add(key);
    if (!requiresLabel) return { ...row, id };
    if (typeof row.label_id !== 'string' || !UUID.test(row.label_id)) fail(400, 'Each selected order needs a verified shipping label reference.');
    const labelId = row.label_id.toLowerCase();
    if (labels.has(labelId)) fail(400, 'A label may only appear once in a shipment batch.');
    labels.add(labelId);
    return { ...row, id, label_id: labelId };
  });
}

async function perOrder(rows, operation, fallback) {
  return Promise.all(rows.map(async row => {
    const identity = { id: row.id, source: row.source };
    try {
      return { ...identity, ok: true, ...await operation(row) };
    } catch (error) {
      const expected = [400, 404, 409, 502, 503].includes(error.status);
      return { ...identity, ok: false, status: expected ? error.status : 503, error: expected ? error.message : fallback };
    }
  }));
}

function confirmedRates(rows, input) {
  if (input.confirm_purchase !== true || typeof input.test_mode !== 'boolean' || !object(input.totals)) {
    fail(400, 'Review the total postage and confirm whether the label batch is test or live.');
  }
  const totals = {};
  for (const row of rows) {
    if (typeof row.rate_id !== 'string' || !RATE_ID.test(row.rate_id) ||
      !Number.isSafeInteger(row.amount_cents) || row.amount_cents <= 0 || row.amount_cents > 10000000 || !['USD', 'CAD'].includes(row.currency)) {
      fail(400, 'Every selected order must have a valid carrier rate and price.');
    }
    totals[row.currency] = (totals[row.currency] || 0) + row.amount_cents;
  }
  const currencies = Object.keys(totals);
  if (Object.keys(input.totals).length !== currencies.length || currencies.some(currency => input.totals[currency] !== totals[currency])) {
    fail(409, 'The selected rates do not match the confirmed postage total. Review the batch again.');
  }
}

async function handle(db, input, options = {}) {
  if (input.action === 'shipping_label_bulk_state') {
    const rows = batchOrders(input.orders);
    const preferences = await readPreferences(db);
    return { results: await perOrder(rows, async row => {
      const state = await shipping.state(db, row, { ...options, preferences });
      const recent = state.labels.slice(0, 5);
      const active = state.labels.find(label => label.test === state.test_mode && ['purchasing', 'created', 'review'].includes(label.status));
      if (active && !recent.includes(active)) recent.push(active);
      return { state: { ...state, labels: recent } };
    }, 'Shipping details could not be loaded for this order.') };
  }

  const settings = shipping.config(options.env);
  if (!settings.configured) fail(503, settings.error);
  if (input.action === 'shipping_label_bulk_quote') {
    const rows = batchOrders(input.orders);
    const preferences = await readPreferences(db);
    if (!preferences.sender) fail(409, 'Save the return address in Shipping Labels on any order before requesting batch rates.');
    return { results: await perOrder(rows, async row => {
      const packed = { ...preferences.package_defaults, ...(object(row.parcel) ? row.parcel : {}) };
      const quoted = await shipping.quote(db, { id: row.id, source: row.source, sender: preferences.sender, parcel: packed, customs: row.customs }, options, true);
      return { ...quoted, purchase_enabled: settings.purchaseEnabled, test_mode: settings.test };
    }, 'Rates could not be saved for this order. Request fresh rates before buying a label.') };
  }

  if (input.action !== 'shipping_label_bulk_buy') fail(400, 'Unknown shipping label batch action.');
  const rows = batchOrders(input.orders, true);
  confirmedRates(rows, input);
  if (input.test_mode !== settings.test) fail(409, 'The shipping account mode changed. Review fresh rates before purchasing.');
  if (!settings.purchaseEnabled) fail(409, 'Live label purchases are disabled in the shipping configuration. You can still review rates.');
  return { results: await perOrder(rows, row => shipping.purchase(db, { ...row, confirm_purchase: true }, options),
    'The label outcome is unconfirmed. Open the order and check its label status before trying again.') };
}

module.exports = { handle, batchOrders };
