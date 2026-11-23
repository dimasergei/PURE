'use strict';

const { discount_bps: discountBps, enabled } = require('../config/checkout.json').promotions.second_unit;

async function available(db, catalog) {
  const offer = { discount_bps: discountBps, eligible_variants: [] };
  if (!enabled) return offer;

  const { data, error } = await (db || require('./inventory-db').inventoryDb()).from('commerce_second_unit_variants').select('variant_key');
  if (error) throw Error('Second-unit offer could not be verified.');
  const listed = new Set(data.map(row => row.variant_key));
  const excluded = new Set(['supplies', 'supply', 'equipment', 'membership', 'memberships', 'plans']);
  offer.eligible_variants = (catalog || require('./catalog.json'))
    .filter(product => !excluded.has(product.category) && !excluded.has(product.form))
    .flatMap(product => product.variants.map(variant => product.id + ':' + variant.size))
    .filter(key => listed.has(key));
  return offer;
}

function choose(pricing, request, offer) {
  const eligible = new Set(offer?.eligible_variants || []);
  if (!eligible.size || request.bulk_order || request.research_builder_mode) return pricing;

  const pairs = pricing.lines.map(line => eligible.has(line.id + ':' + line.size) ? Math.floor(line.qty / 2) : 0);
  const discounts = pricing.lines.map((line, index) => Math.round(line.unit_price_cents * pairs[index] * discountBps / 10000));
  const savings = discounts.reduce((total, amount) => total + amount, 0);
  if (savings <= pricing.discount_cents) return pricing;

  pricing.lines = pricing.lines.map((line, index) => {
    const discount = discounts[index];
    return { ...line, discount_cents: discount, discount_bps: Math.round(discount * 10000 / line.gross_cents),
      discount_reason: discount ? 'second_unit' : 'none', membership_discount_cents: 0, coupon_discount_cents: 0,
      second_unit_discount_cents: discount, second_unit_discounted_qty: pairs[index], line_total_cents: line.gross_cents - discount };
  });
  Object.assign(pricing, { discount_cents: savings, membership_discount_cents: 0,
    coupon_discount_cents: 0, second_unit_discount_cents: savings });
  return pricing;
}

module.exports = { available, choose };
