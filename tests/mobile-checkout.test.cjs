'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const config = require('../config/checkout.json');
const deliveryOptions = require('../config/delivery-options.json');
const shippingZones = require('../config/shipping-zones.json');

const card = { id: 'card-test', native_provider: 'pure_gateway', countries: ['US', 'CA'] };
const interac = { id: 'interac-test', kind: 'interac', provider_key: 'interac', currency: 'CAD', countries: ['CA'] };
const item = { id: 'fixture', size: 'Single', key: 'fixture:Single', name: 'Catalog item', price: 40, qty: 1 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function checkout(t, matches, { signedIn = false, geoCountry } = {}) {
  const dom = new JSDOM('<main></main>', { url: 'https://getpurelabs.com/checkout', runScripts: 'outside-only' });
  const w = dom.window;
  const root = w.document.querySelector('main');
  const requestBodies = [];
  const listeners = new Set();
  const mediaQuery = {
    matches,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener)
  };
  const resize = next => {
    mediaQuery.matches = next;
    listeners.forEach(listener => listener({ matches: next }));
  };
  const auth = signedIn ? { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) } } : null;
  const user = signedIn ? { email: 'account@example.test', user_metadata: { alta_profile: { shipping: { country: 'CA', line1: '100 Canadian Street' } } } } : null;
  t.after(() => w.close());
  w.matchMedia = () => mediaQuery;
  if (geoCountry) w.AltaLocale = { country: geoCountry, countryReady: Promise.resolve() };
  w.AltaStore = { cart: [item], catalog: [], product: () => item };
  w.fetch = async (url, options) => {
    if (url.endsWith(signedIn ? 'checkout=customer' : 'checkout=public')) return {
      ok: true,
      json: async () => ({ config, delivery_options: deliveryOptions, shipping_zones: shippingZones, methods: [card, interac], guest_methods: [card.id] })
    };
    assert.ok(url.endsWith('checkout=cart'), 'The layout test must never place an order');
    const body = JSON.parse(options.body);
    requestBodies.push(body);
    assert.equal(body.guest, signedIn ? undefined : true);
    const cad = body.method_id === interac.id;
    const cents = value => cad ? Math.round(value * 1.4) : value;
    const shipping = cents(shippingZones[body.country][body.delivery.shipping]);
    const extras = deliveryOptions.filter(option => body.delivery.extras.includes(option.id))
      .map(option => ({ id: option.id, label: option.label, amount_cents: cents(option.price_cents) }));
    const subtotal = cents(4000);
    return {
      ok: true,
      json: async () => ({
        currency: cad ? 'CAD' : 'USD',
        fx_quote: cad ? 'fixture-cad-quote' : undefined,
        total_cents: subtotal + shipping + extras.reduce((total, extra) => total + extra.amount_cents, 0),
        pricing: { subtotal_cents: subtotal, fx_ppm: cad ? 1400000 : undefined, delivery: { shipping_cents: shipping, selection: body.delivery, extras } }
      })
    };
  };
  for (const file of ['direct-checkout-client.js', 'checkout-reference.js']) w.eval(readFileSync(file, 'utf8'));
  await w.DirectCheckout.checkout(root, auth, user);
  await delay(0);
  return { w, root, resize, requestBodies, form: root.querySelector('form') };
}

function contact(form) {
  const address = { first_name: 'Test', last_name: 'Guest', phone: '4165550100', line1: '100 Main St', city: 'Waterloo', region: 'ON', postal_code: 'N2L 3G1' };
  for (const [field, value] of Object.entries(address)) form.elements[field].value = value;
}

test('phone checkout keeps contact, delivery and the current USD total in a two-stage flow', async t => {
  const { root, w, form, requestBodies } = await checkout(t, true);
  const inlineDelivery = root.querySelector('[data-nlx-inline-delivery]');
  const actions = root.querySelector('.nlx-mobile-actions');
  assert.equal(inlineDelivery.hidden, false);
  assert.equal(actions.querySelector('[data-nlx-action-total]').hidden, false);
  assert.equal(actions.querySelector('[data-nlx-action-amount]').textContent, '$52.95');
  assert.equal(actions.querySelector('[data-nlx-next]').textContent, 'Continue to payment');
  assert.equal(actions.querySelector('button').form, form);
  assert.deepEqual([...root.querySelectorAll('[data-nlx-step]:not([hidden])')].map(step => step.textContent), ['1Contact & delivery', '2Payment']);

  contact(form);
  actions.querySelector('button').click();
  assert.equal(root.querySelector('[data-nlx-place]'), null, 'A guest email is still required before payment');
  form.elements.email.value = 'guest@example.test';
  form.elements.country.value = 'CA';
  form.elements.country.dispatchEvent(new w.Event('change'));
  const standard = inlineDelivery.querySelector('[value=standard]');
  assert.equal(standard.closest('label').querySelector('.nlx-delivery-price').textContent, '$24.95');
  standard.click();
  inlineDelivery.querySelector('[data-nlx-extra=priority]').click();
  form.elements.note.value = 'Fixture note';
  assert.equal(actions.querySelector('[data-nlx-action-amount]').textContent, '—');
  await delay(240);

  assert.equal(requestBodies.at(-1).country, 'CA');
  assert.deepEqual(requestBodies.at(-1).delivery, { shipping: 'standard', extras: ['priority', 'protection'] });
  assert.equal(actions.querySelector('[data-nlx-action-amount]').textContent, '$79.94');
  actions.querySelector('button').click();
  const pay = root.querySelector('[data-nlx-place]');
  assert.equal(pay.disabled, true, 'Payment still requires consent');
  assert.equal(pay.closest('.nlx-mobile-actions').querySelector('[data-nlx-action-amount]').textContent, '$79.94');
  assert.equal(pay.textContent, 'CONTINUE TO CARD PAYMENT');
  root.querySelector('[data-nlx-edit="1"]').click();
  assert.equal(form.elements.email.value, 'guest@example.test');
  assert.equal(form.elements.note.value, 'Fixture note');
  assert.equal(form.elements.delivery_speed.value, 'standard');
});

test('desktop checkout retains its Delivery step and a resize preserves the address, note and selected rate', async t => {
  const { root, form, resize } = await checkout(t, false);
  assert.equal(root.querySelector('[data-nlx-inline-delivery]').hidden, true);
  assert.equal(root.querySelectorAll('[data-nlx-step]:not([hidden])').length, 3);
  assert.equal(root.querySelector('[data-nlx-next]').closest('.nlx-step-shipping').contains(form.elements.email), true);
  contact(form);
  form.elements.email.value = 'guest@example.test';
  root.querySelector('[data-nlx-next]').click();
  assert.ok(root.querySelector('.nlx-step-delivery'));
  form.elements.note.value = 'Preserve on resize';
  form.querySelector('[value=standard]').click();
  resize(true);
  assert.equal(form.elements.email.value, 'guest@example.test');
  assert.equal(form.elements.note.value, 'Preserve on resize');
  assert.equal(form.elements.delivery_speed.value, 'standard');
  assert.equal(root.querySelector('[data-nlx-inline-delivery]').hidden, false);
  resize(false);
  assert.equal(root.querySelector('[data-nlx-inline-delivery]').hidden, true);
  assert.equal(root.querySelector('[data-nlx-next]').textContent, 'Continue');
  root.querySelector('[data-nlx-next]').click();
  assert.ok(root.querySelector('.nlx-step-delivery'));
  assert.equal(form.elements.note.value, 'Preserve on resize');
  assert.equal(form.elements.delivery_speed.value, 'standard');
});

test('phone payment updates the displayed amount from the signed-in CAD quote', async t => {
  const { root, form, requestBodies } = await checkout(t, true, { signedIn: true });
  contact(form);
  assert.equal(form.elements.email.readOnly, true);
  root.querySelector('[data-nlx-next]').click();
  assert.equal(root.querySelector('[data-nlx-action-currency]').textContent, 'Total · USD');
  assert.equal(root.querySelector('[data-nlx-action-amount]').textContent, '$59.95');
  form.querySelector('[name=payment_choice][value=interac]').click();
  assert.equal(root.querySelector('[data-nlx-place]').disabled, true);
  await delay(0);
  assert.equal(requestBodies.at(-1).method_id, interac.id);
  assert.equal(root.querySelector('[data-nlx-action-currency]').textContent, 'Total · CAD');
  assert.equal(root.querySelector('[data-nlx-action-amount]').textContent, '$83.93');
  assert.equal(root.querySelector('[data-nlx-place]').textContent, 'PLACE ORDER');
});

test('checkout defaults to the detected country and preserves an available saved address', async t => {
  const guest = await checkout(t, true, { geoCountry: 'CA' });
  assert.equal(guest.form.elements.country.value, 'CA');
  assert.equal(guest.requestBodies[0].country, 'CA');
  const signedIn = await checkout(t, true, { signedIn: true, geoCountry: 'US' });
  assert.equal(signedIn.form.elements.country.value, 'CA');
  assert.equal(signedIn.form.elements.line1.value, '100 Canadian Street');
  assert.equal(signedIn.requestBodies[0].country, 'CA');
});
