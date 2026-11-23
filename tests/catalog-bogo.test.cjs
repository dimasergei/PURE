'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkoutCampaign } = require('../lib/campaign-window');
const secondUnit = require('../lib/second-unit-offer');
const { price } = require('../lib/direct-checkout');

const now = Date.parse('2026-11-22T20:00:00Z');
const env = { BOGO_ENABLED: 'true', BOGO_STARTS_AT: '2026-11-22T18:00:00Z', BOGO_ENDS_AT: '2026-11-25T18:00:00Z' };
const method = { kind: 'hosted_link', currency: 'USD', sale_scope: 'goods', native_provider: null };
const balance = { points: 0, credit_cents: 0 };

function quote({ coupon = '', qty = 2, promo, affiliateCode, bulk = false } = {}) {
  return price({ kind: 'goods', request: { bulk_order: bulk, address: { country: 'US' },
    items: [{ id: 'fixture', name: 'Fixture', size: '5mg', qty, unit_price_usd_cents: 8000 }],
    checkout: { coupon, affiliate_code: affiliateCode, points: 0, credit_cents: 0, delivery: { shipping: 'economy', extras: [] } } } },
  method, null, balance, affiliateCode ? { customer_id: 'partner-id', code: affiliateCode, first_order: true } : null,
  undefined, null, promo);
}

test('expired rollout configuration cannot grant free units or enable an unapproved second-unit offer', async () => {
  for (const BOGO_VARIANTS of ['catalog', 'fixture:5mg']) {
    const campaign = checkoutCampaign({ ...env, BOGO_VARIANTS }, now);
    assert.equal(campaign.ends_at, null);
    assert.deepEqual(campaign.eligible_variants, []);
  }
  const offer = await secondUnit.available();
  assert.deepEqual(offer, { discount_bps: 2500, eligible_variants: [] });
  assert.equal(quote({ promo: offer }).discount_cents, 0);
});

test('a selected pair receives one price discount, never a complimentary unit or stacked coupon', () => {
  const promo = { discount_bps: 2500, eligible_variants: ['fixture:5mg'] };
  const paired = quote({ coupon: 'BLACKFRIDAY10', promo });
  assert.equal(paired.pricing.merchandise_offer, 'second_unit');
  assert.equal(paired.discount_cents, 2000);
  assert.equal(paired.pricing.coupon_discount_cents, 0);
  assert.equal(paired.pricing.bogo_campaign, undefined);
  assert.equal(paired.pricing.lines[0].qty, 2);
  assert.equal(paired.pricing.lines[0].second_unit_discounted_qty, 1);
  const odd = quote({ qty: 3, coupon: 'BLACKFRIDAY10', promo });
  assert.equal(odd.pricing.merchandise_offer, 'coupon');
  assert.equal(odd.discount_cents, 2400);
  const affiliate = quote({ promo, affiliateCode: 'FIXTURE20' });
  assert.equal(affiliate.pricing.merchandise_offer, 'affiliate');
  assert.equal(affiliate.discount_cents, 3200);
  assert.equal(affiliate.pricing.second_unit_discount_cents, undefined);
  const bulk = quote({ qty: 10, promo, bulk: true });
  assert.equal(bulk.pricing.merchandise_offer, 'bulk');
  assert.equal(bulk.pricing.second_unit_discount_cents, undefined);
});

test('shipping eligibility and retained first-order rewards use discounted merchandise independently', () => {
  const regular = quote({ qty: 4 });
  assert.equal(regular.shipping_cents, 0);
  assert.equal(regular.pricing.campaign_bac, true);
  const discounted = quote({ qty: 4, coupon: 'BLACKFRIDAY10' });
  assert.equal(discounted.shipping_cents, 0);
  assert.equal(discounted.pricing.campaign_bac, undefined);
  assert.equal(discounted.pricing.bundled_items, undefined);
});
