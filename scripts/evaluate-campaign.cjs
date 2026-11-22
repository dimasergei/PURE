'use strict';

const fs = require('node:fs');
const { partner, free_shipping_threshold_cents } = require('../config/conversion.json');

const { promotions } = require('../config/checkout.json');

const offers = [
  { name: 'Regular checkout', shipping: free_shipping_threshold_cents, bac: 29900, bogo: false },
  { name: 'BOGO campaign', shipping: free_shipping_threshold_cents, bac: 29900, bogo: true },
];
const affiliateMinimum = 10000;

function integer(value, name, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(name + ' must be an integer from ' + min + ' to ' + max);
  }
  return value;
}

function evaluate(cart, route, offer, commissionBps) {
  if (typeof cart.applyBlackFridayCode !== 'boolean') throw new Error('Specify whether BLACKFRIDAY10 is applied');
  if (!['none', 'first', 'repeat'].includes(cart.referral)) throw new Error('Invalid referral type');
  if (!Array.isArray(cart.items) || !cart.items.length || cart.items.length > 100) {
    throw new Error('Provide 1–100 cart lines');
  }
  const rows = cart.items.map(({ sku, paid, priceCents, bogoEligible }) => {
    if (typeof sku !== 'string' || !sku.trim()) throw new Error('SKU required');
    if (typeof bogoEligible !== 'boolean') throw new Error('Specify BOGO eligibility for ' + sku);
    const quantity = integer(paid, 'Paid quantity', 1, 10000);
    const free = offer.bogo && bogoEligible ? quantity : 0;
    return { sku, quantity, free, subtotal: quantity * integer(priceCents, 'Unit price', 1, 1000000) };
  });
  const subtotal = integer(rows.reduce((sum, row) => sum + row.subtotal, 0), 'Cart subtotal');
  const discount = cart.applyBlackFridayCode ? Math.round(subtotal * promotions.coupon_discount_bps / 10000) : 0;
  const merchandise = subtotal - discount;
  const codeEligible = cart.referral === 'first' && merchandise >= affiliateMinimum && !cart.applyBlackFridayCode;
  const freeUnits = rows.reduce((sum, row) => sum + row.free, 0);
  const gifts = Object.entries({ bac: offer.bac })
    .filter(([, threshold]) => merchandise >= threshold).map(([gift]) => gift);
  const missing = rows.filter(({ sku }) => !Object.hasOwn(route.unitCostCents, sku)).map(({ sku }) => sku);
  missing.push(...gifts.filter(gift => !Object.hasOwn(route.giftCostCents, gift)));
  if (missing.length || route.confirmed !== true) {
    return { subtotal, merchandise, discount, freeUnits, gifts, codeEligible, status: 'blocked', missing, routeConfirmed: route.confirmed === true };
  }
  const unitCost = rows.reduce((sum, row) => sum + (row.quantity + row.free) *
    integer(route.unitCostCents[row.sku], row.sku + ' unit cost'), 0);
  const giftCost = gifts.reduce((sum, gift) => sum + integer(route.giftCostCents[gift], gift + ' cost'), 0);
  const shippingCollected = merchandise >= (freeUnits ? offer.shipping : free_shipping_threshold_cents) ? 0 : integer(route.shippingChargedCents, 'Shipping charged');
  const shippingCost = integer(route.shippingCostCents, 'Shipping cost');
  const payoutRate = cart.referral === 'none' ? 0 : cart.referral === 'repeat' ? partner.repeat_order_bps : commissionBps;
  const commission = Math.floor(merchandise * payoutRate / 10000);
  const fees = integer(route.paymentFixedCents, 'Fixed payment fee') +
    Math.round((merchandise + shippingCollected) * integer(route.paymentBps, 'Payment fee basis points', 0, 10000) / 10000);
  const reserve = integer(route.refundReserveCents, 'Refund reserve');
  const pickPack = integer(route.fulfillmentCents, 'Fulfillment cost');
  const contribution = merchandise + shippingCollected - unitCost - giftCost - shippingCost - commission - fees - reserve - pickPack;
  const marginFloor = integer(cart.minimumMarginBps, 'Minimum margin basis points', 0, 10000);
  const requiredContribution = Math.ceil(merchandise * marginFloor / 10000);
  return { subtotal, merchandise, discount, freeUnits, codeEligible, gifts, shippingCollected, shippingCost, unitCost, giftCost,
    commission, fees, reserve, pickPack, contribution, requiredContribution,
    status: contribution >= requiredContribution && merchandise > 0 ? 'passes_margin' : 'below_margin' };
}

function compare(input) {
  if (!input.carts?.length || !input.routes?.length) throw new Error('Provide carts and confirmed single-supplier routes');
  return input.routes.flatMap(route => input.carts.flatMap(cart => offers.flatMap(offer =>
    [{
      route: route.name, cart: cart.name, offer: offer.name, firstOrderCommissionBps: partner.first_order_bps,
      ...evaluate(cart, route, offer, partner.first_order_bps),
    }],
  )));
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/evaluate-campaign.cjs path/to/scenarios.json');
    const results = compare(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(results, null, 2));
    if (results.some(result => result.status !== 'passes_margin')) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

module.exports = { compare, evaluate, offers };
