'use strict';

// Public storefront facts. Pricing and destination eligibility come from the same
// records checkout reads. Keep unknown operational details null until confirmed.
const checkout = require('./checkout.json');
const deliveryPricing = require('../lib/delivery-options.js');
const zones = require('./shipping-zones.json');
const delivery = require('./delivery-options.json');
const { bacMinimum } = require('../lib/order-thresholds.js');
const { dispatchCutoff } = require('../lib/dispatch-cutoff.js');
const reports = require('../data/supplier-coas.json').reports;

const dollars = cents => 'US$' + (cents / 100).toLocaleString('en-US', {
  minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2
});
const dispatch = dispatchCutoff();
const protection = delivery.find(option => option.id === 'protection');
const threshold = checkout.free_shipping_threshold_cents;
const report = id => reports.find(item => item.id === id)?.document_url;
const endDate = process.env.PURE_PROMO_ENDS_AT || '';
// Require an explicit offset, so build servers in different zones agree.
const confirmedExpiry = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(endDate) && Number.isFinite(Date.parse(endDate));
// Derive eligible services from the same rate calculator used by checkout.
const freeServices = Object.fromEntries(['US', 'CA'].map(country => [country,
  Object.keys(zones[country]).filter(shipping => deliveryPricing.price(
    { shipping, extras: [] }, true, delivery, country
  ).shipping_cents === 0)
]));
const returnWindowDays = 7;
const processing = { min: 1, max: 3 };
const transit = { min: 3, max: 7 };
const sharedServices = freeServices.US.filter(service => freeServices.CA.includes(service));
const serviceList = codes => new Intl.ListFormat('en-US', { type: 'conjunction' })
  .format(codes.map(code => code.replaceAll('_', ' ')));
const freeGroups = [];
if (sharedServices.length) freeGroups.push(serviceList(sharedServices) + ' shipping in the U.S. and Canada');
for (const [country, name] of [['US', 'U.S.'], ['CA', 'Canadian']]) {
  const otherServices = freeServices[country].filter(service => !sharedServices.includes(service));
  if (otherServices.length) freeGroups.push(name + ' ' + serviceList(otherServices));
}
const freeServiceText = freeGroups.join(', plus ');
const freeServicesLabel = freeServiceText.charAt(0).toUpperCase() + freeServiceText.slice(1);
const protectionFee = protection.price_cents;
const methods = [
  { name: 'Reversed-phase HPLC', scope: 'The Optiq report separates the components of its submitted sample and reports chromatographic purity under the stated conditions.', sourceUrl: report('p99-0285-opt-260727-r1') },
  { name: 'LC–MS/MS', scope: 'The Purity Analytics report lists this identity method for its submitted CJC-1295 With DAC sample. Refer to the original for the result and conditions.', sourceUrl: report('ypb-220') },
  { name: 'MALDI-MS', scope: 'The Bioviridian NAD+ report includes a mass spectrum for the submitted sample. Read the spectrum alongside the sample identifier and method.', sourceUrl: report('pd-nad-500mg-research-peptide') },
  { name: 'Endotoxin (USP <85>)', scope: 'The Prodigy report identifies an endotoxin test for its Retatrutide sample. The specified limits and result apply to that submission.', sourceUrl: report('pd-retatrutide-glp-3-20mg') },
  { name: 'Sterility (USP <71>)', scope: 'The same Prodigy report records sterility testing on the submitted sample. Its result applies only to the sample identified in that report.', sourceUrl: report('pd-retatrutide-glp-3-20mg') }
].filter(method => method.sourceUrl);

const site = {
  name: 'PURE',
  // Stable filter keys are shared with saved links and plans. Only labels are public copy.
  catalogGroups: {
    'GLP-1 & Metabolic': 'Metabolic signaling',
    'Healing & Recovery': 'Peptide fragments and signaling',
    'Growth Hormone': 'Growth hormone research',
    'Cognitive & Nootropic': 'Neuropeptide research',
    'Longevity': 'Cellular and biochemical research',
    'Cosmetic & Skin': 'Copper peptides and related compounds',
    'Sexual & Hormonal': 'Hormone and receptor research',
    'Reconstitution Solution & Supplies': 'Laboratory supplies'
  },
  origin: 'https://getpurelabs.com',
  company: { address: null },
  minimumAge: 21,
  ruo: 'For in-vitro laboratory research only. Not for human or veterinary use.',
  support: { email: 'support@getpurelabs.com', hours: null, responseTime: null, bulkResponseTime: null },
  currency: {
    base: checkout.currency,
    disclosure: 'Catalog prices are in USD. Converted catalog prices are display estimates. Card and direct USDC orders are quoted in USD. Canadian Interac is charged in CAD. Review the final currency and amount before payment.'
  },
  shipping: {
    countries: checkout.shipping_countries.filter(code => !zones.unavailable_countries.includes(code)),
    regions: ['United States', 'Canada', 'Other eligible destinations'],
    cutoff: dispatch?.time || null, timeZone: dispatch?.time_zone || null,
    carriers: [],
    rates: { US: zones.US, CA: zones.CA, OTHER: zones.OTHER },
    freeThresholdCents: threshold, freeServices, freeServicesLabel, freeThresholdLabel: dollars(threshold),
    freeSummary: freeServicesLabel + ' are free from ' + dollars(threshold) + ' in eligible merchandise after discounts. Eligibility is measured before points or store credit.',
    giftThresholdCents: bacMinimum,
    giftSummary: 'One complimentary 3 mL reconstitution solution is available on the first eligible paid merchandise order placed while signed in or on an eligible merchandise order of ' + dollars(bacMinimum) + ' or more. Both offers require an undiscounted order. Overlapping offers include one vial.',
    processingEstimate: `Typical processing is ${processing.min}–${processing.max} business days after payment is confirmed.`,
    transitEstimate: `Estimated transit is ${transit.min}–${transit.max} business days after dispatch. The destination and carrier can affect timing.`,
    combinedEstimate: `${processing.min + transit.min}–${processing.max + transit.max} business days after payment`,
    deliveryNote: 'Available services and rates depend on the shipping address. Tracking and the carrier are confirmed after dispatch. International duties or local charges may apply.',
    protectionCents: protectionFee, protectionFeeLabel: 'US$' + (protectionFee / 100).toFixed(2),
    protectionSummary: 'Optional seller-backed shipping protection costs ' + dollars(protectionFee) + ' per order. It is selected by default and can be removed before payment.'
  },
  returns: {
    windowDays: returnWindowDays,
    summary: 'Request an eligible return within ' + returnWindowDays + ' calendar days of receipt. Products must be unused, unopened and in their original packaging. Campaign and affiliate purchases are excluded, as are custom or bulk orders marked non-refundable. Statutory rights still apply.'
  },
  testing: {
    methods, reportCount: reports.length,
    scope: 'Supplier reports identify the submitted sample and listed strength. A supplier reference does not establish the lot assigned to a PURE order.'
  },
  promo: { code: checkout.promotions.coupon, savingsLabel: (checkout.promotions.coupon_discount_bps / 100) + '% off the merchandise subtotal', percent: checkout.promotions.coupon_discount_bps / 100, endsAt: confirmedExpiry ? new Date(endDate).toISOString() : null },
  placeholders: {
    company: '[PLACEHOLDER: approved public business or mailing address]',
    supportHours: '[PLACEHOLDER: staffed support hours and time zone]',
    supportResponse: '[PLACEHOLDER: confirmed support response-time commitment]',
    bulkResponse: '[PLACEHOLDER: confirmed bulk quote response-time commitment]',
    dispatch: '[PLACEHOLDER: confirmed dispatch cutoff and IANA time zone]',
    carriers: '[PLACEHOLDER: verified carriers by shipping region and service]',
    promoExpiry: '[PLACEHOLDER: approved promotion end date, time and time zone]'
  }
};

function promoVisible(promo = site.promo, now = Date.now()) {
  return !!promo?.code && Number.isFinite(Date.parse(promo.endsAt)) && now < Date.parse(promo.endsAt);
}

module.exports = { site, promoVisible };
