'use strict';

const fs = require('node:fs');
const { partner } = require('../config/conversion.json');
const { promotions, free_shipping_threshold_cents } = require('../config/checkout.json');
const { orderThresholds, bacMinimum } = require('../lib/order-thresholds');
const { applyPromotions } = require('../lib/checkout-promotions');
const { applyDiscount } = require('../lib/pure-payment-policy');
const delivery = require('../lib/delivery-options');

const offers = [
  { name: 'Regular checkout', shipping: free_shipping_threshold_cents, bac: bacMinimum, bogo: false },
  { name: 'BOGO campaign', shipping: free_shipping_threshold_cents, bac: bacMinimum, bogo: true },
];

function integer(value, name, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(name + ' must be an integer from ' + min + ' to ' + max);
  }
  return value;
}

function evaluate(cart, route, offer, commissionBps) {
  if (typeof cart.applyBlackFridayCode !== 'boolean') throw new Error('Specify whether BLACKFRIDAY10 is applied');
  if (!['none', 'first', 'repeat'].includes(cart.referral)) throw new Error('Invalid referral type');
  const firstOrder = cart.firstOrder ?? (cart.referral !== 'repeat');
  if (typeof firstOrder !== 'boolean') throw new Error('firstOrder must be true or false');
  if (cart.referral !== 'none' && firstOrder !== (cart.referral === 'first')) throw new Error('First order and referral type disagree');
  if (cart.payment !== undefined && !['card','crypto'].includes(cart.payment)) throw new Error('Model a USD card or crypto retail order');
  if (cart.membership || cart.bulk || cart.points || cart.creditCents || cart.membershipAddon) {
    throw new Error('This retail scenario excludes membership, bulk orders and redeemed balances');
  }
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
  const quote = rate => {
    const pricing = { subtotal_cents: subtotal, lines: rows.map(row => ({gross_cents: row.subtotal})) };
    applyPromotions(pricing, 'goods', cart.applyBlackFridayCode ? promotions.coupon : '', rate);
    if (cart.payment === 'crypto') applyDiscount(pricing, {native_provider:'polygon_usdc'});
    return subtotal - pricing.discount_cents;
  };
  const tryPartner = cart.referral === 'first' && !cart.applyBlackFridayCode;
  let merchandise = quote(tryPartner ? partner.customer_discount_bps : 0);
  const codeEligible = tryPartner && !orderThresholds(merchandise, {affiliateCodeEntered:true}).affiliateError;
  if (tryPartner && !codeEligible) merchandise = quote(0);
  const discount = subtotal - merchandise;
  const freeUnits = rows.reduce((sum, row) => sum + row.free, 0);
  const gifts = firstOrder || merchandise >= offer.bac ? ['bac'] : [];
  const missing = rows.filter(({ sku }) => !Object.hasOwn(route.unitCostCents, sku)).map(({ sku }) => sku);
  missing.push(...gifts.filter(gift => !Object.hasOwn(route.giftCostCents, gift)));
  if (missing.length || route.confirmed !== true) {
    return { subtotal, merchandise, discount, freeUnits, gifts, codeEligible, status: 'blocked', missing, routeConfirmed: route.confirmed === true };
  }
  const unitCost = rows.reduce((sum, row) => sum + (row.quantity + row.free) *
    integer(route.unitCostCents[row.sku], row.sku + ' unit cost'), 0);
  const giftCost = gifts.reduce((sum, gift) => sum + integer(route.giftCostCents[gift], gift + ' cost'), 0);
  const destination = cart.country ?? 'US';
  const service = {shipping: cart.shippingService ?? 'economy', extras: []};
  const deliveryQuote = delivery.price(service, merchandise >= offer.shipping, delivery.defaults, destination);
  const shippingCollected = deliveryQuote.shipping_cents === 0 ? 0 :
    integer(route.shippingChargedCents ?? deliveryQuote.shipping_cents, 'Shipping charged');
  const shippingCost = integer(route.shippingCostCents, 'Shipping cost');
  const payoutRate = cart.referral === 'none' ? 0 : cart.referral === 'repeat' ? partner.repeat_order_bps : commissionBps;
  const commission = Math.floor(merchandise * payoutRate / 10000);
  const fees = integer(route.paymentFixedCents, 'Fixed payment fee') +
    Math.round((merchandise + shippingCollected) * integer(route.paymentBps, 'Payment fee basis points', 0, 10000) / 10000);
  const reserve = integer(route.refundReserveCents, 'Refund reserve');
  const pickPack = integer(route.fulfillmentCents, 'Fulfillment cost');
  const revenue = merchandise + shippingCollected;
  const dispatchCostCents = unitCost + giftCost + shippingCost + pickPack;
  const overhead = integer(route.allocatedOverheadCents ?? 0, 'Allocated operating costs');
  const acquisition = integer(route.additionalAcquisitionCents ?? 0, 'Acquisition spend beyond commission');
  const contribution = revenue - dispatchCostCents - commission - fees - reserve - overhead - acquisition;
  const marginFloor = integer(cart.minimumMarginBps, 'Minimum margin basis points', 0, 10000);
  const requiredContribution = Math.ceil(revenue * marginFloor / 10000);
  // Full prepayment illustration for pay-per-order fulfillment. Only settled,
  // spendable customer receipts may reduce the dispatch cash requirement.
  const concurrent = integer(cart.concurrentOrders ?? 1, 'Identical concurrent orders', 1, 10000);
  const receipt = cart.spendableReceiptPerOrderCents;
  if (receipt !== undefined) integer(receipt, 'Spendable receipt after reserves', 0, revenue);
  const cashGapCents = receipt === undefined ? null : Math.max(0, dispatchCostCents - receipt) * concurrent;
  return { subtotal, merchandise, discount, freeUnits, codeEligible, gifts, firstOrder, shippingCollected, shippingCost, unitCost, giftCost,
    commission, fees, reserve, pickPack, overhead, acquisition, revenue, contribution, requiredContribution,
    dispatchCostCents, fullPrepaymentCents: dispatchCostCents * concurrent, cashGapCents,
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
