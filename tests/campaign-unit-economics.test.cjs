'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, offers } = require('../scripts/evaluate-campaign.cjs');

const route = {
  confirmed: true, unitCostCents: {sample: 2000}, giftCostCents: {bac: 400},
  shippingCostCents: 900, paymentBps: 350, paymentFixedCents: 30,
  refundReserveCents: 420, fulfillmentCents: 120, allocatedOverheadCents: 300,
};
function order(priceCents, changes = {}, supplier = route) {
  return evaluate({applyBlackFridayCode: false, referral: 'first', minimumMarginBps: 1500,
    items: [{sku:'sample', paid:1, priceCents, bogoEligible:true}], ...changes}, supplier, offers[1], 4000);
}

test('costs two units, one gift, default economy, processor and first commission', () => {
  const q = order(15000, {concurrentOrders:3, spendableReceiptPerOrderCents:0});
  assert.equal(q.merchandise, 12000);
  assert.equal(q.freeUnits, 1);
  assert.equal(q.commission, 4800);
  assert.equal(q.shippingCollected, 795);
  assert.equal(q.dispatchCostCents, 5420);
  assert.equal(q.contribution, 1377);
  assert.equal(q.cashGapCents, 16260);
  assert.equal(order(15000).cashGapCents, null);
  assert.equal(order(15000, {spendableReceiptPerOrderCents:5600}).cashGapCents, 0);
});

test('link attribution survives a declined automatic first-order discount', () => {
  assert.equal(order(12500).merchandise, 10000);
  assert.equal(order(12499).codeEligible, false);
  assert.equal(order(12499).commission, 4999);
  assert.equal(order(12500, {payment:'crypto'}).merchandise, 11875);
  assert.equal(order(15000, {applyBlackFridayCode:true}).merchandise, 13500);
});

test('thresholds evaluate discounted merchandise and honor destination/service', () => {
  const repeat = {referral:'repeat'};
  assert.equal(order(24999, repeat).shippingCollected, 795);
  assert.equal(order(25000, repeat).shippingCollected, 0);
  assert.deepEqual(order(29899, repeat).gifts, []);
  assert.deepEqual(order(29900, repeat).gifts, ['bac']);
  assert.deepEqual(order(40000).gifts, ['bac']);
  assert.equal(order(29900, {...repeat,country:'CA',shippingService:'express'}).shippingCollected, 4995);
  assert.equal(order(24999, repeat).commission, 2499);
});

test('missing gift costs block recommendations and direct first orders include the gift', () => {
  assert.equal(order(10000, {referral:'none'}).firstOrder, true);
  assert.equal(order(10000, {referral:'none',firstOrder:false}).giftCost, 0);
  assert.deepEqual(order(15000, {}, {...route,giftCostCents:{}}).missing, ['bac']);
  assert.equal(order(15000, {}, {...route,confirmed:false}).status, 'blocked');
  assert.throws(() => order(15000, {creditCents:1000}), /redeemed balances/);
});
