'use strict';

const { free_shipping_threshold_cents: shippingMinimum } = require('../config/checkout.json');

const affiliateMinimum = 10000;
const bacMinimum = 29900;
const bac = { id: 'gift-bac-3', name: 'Complimentary Reconstitution Solution', size: '3 mL',
  qty: 1, unit_price_cents: 0, line_total_cents: 0 };

function orderThresholds(merchandiseCents, {
  affiliateCodeEntered = false, includesMembershipBac = false, allowCampaignGift = true, shippingThreshold = shippingMinimum,
} = {}) {
  if (!Number.isSafeInteger(merchandiseCents) || merchandiseCents < 0) {
    throw new TypeError('Expected the discounted merchandise subtotal in USD cents.');
  }
  const affiliateError = affiliateCodeEntered && merchandiseCents < affiliateMinimum
    ? 'Affiliate codes require at least $100.00 in merchandise after discounts.'
    : null;
  const campaignBac = allowCampaignGift && merchandiseCents >= bacMinimum && !includesMembershipBac;
  const bundledItems = includesMembershipBac || campaignBac ? [{ ...bac }] : [];
  return { affiliateError, freeShipping: merchandiseCents >= shippingThreshold, bundledItems, campaignBac };
}

module.exports = { orderThresholds, affiliateMinimum, bacMinimum };
