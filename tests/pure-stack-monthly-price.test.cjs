'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {pricedBasket}=require('../lib/repeat-orders');
const delivery=require('../lib/delivery-options');
const {requestInvoice}=require('../lib/manual-commerce');
const commerceTerms=require('../config/launch-commercial-terms.json');

const catalog=[100.01,200.02,300.03,400.04].map((price,index)=>({
 id:'compound-'+index,name:'Compound '+index,category:'injectables',variants:[{size:'5 mg',price}]
})).concat({
 id:'fixture-supply',name:'Supply',category:'supplies',variants:[{size:'1',price:5}]
});
const selections=catalog.slice(0,4).map(({id})=>({id,size:'5 mg',qty:1}));

test('a month is priced from exact SKU cents with per-unit rounding and bundled express delivery',()=>{
 const amounts=[6001,12001,18002,24002];
 const discounts=[4000,8001,12001,16002];
 for(const country of ['US','CA']){
  const q=pricedBasket('builder',selections,catalog,country,delivery.defaults);
  assert.equal(q.currency,'USD');
  assert.equal(q.pricing.subtotal_cents,100010);
  assert.equal(q.pricing.discount_cents,40004);
  assert.equal(q.total_cents,60006);
  assert.equal(q.pricing.billing_mode,'invoice_per_cycle');
  assert.equal(q.pricing.discount_source,'monthly_invoice');
  assert.equal(q.pricing.usd_earned_points_basis_cents,0);
  assert.deepEqual(q.pricing.lines.map(line=>line.discount_cents),discounts);
  assert.deepEqual(q.pricing.lines.map(line=>line.line_total_cents),amounts);
  assert.ok(q.pricing.lines.every(line=>line.discount_bps===4000&&line.discount_reason==='monthly_invoice'));
  assert.deepEqual(q.pricing.bundled_items,[{id:'gift-bac-3',name:'Reconstitution Solution',size:'3 mL',qty:1,unit_price_cents:0,line_total_cents:0}]);
  assert.equal(q.pricing.delivery.country,country);
  assert.equal(q.pricing.delivery.selection.shipping,'express');
  assert.equal(q.pricing.delivery.shipping_cents,0);
 }
 const q=pricedBasket('builder',selections,catalog,'US',delivery.defaults,true);
 assert.equal(q.total_cents,60006+q.pricing.delivery.extras_cents);
 assert.equal(q.pricing.delivery.shipping_cents,0);
 assert.deepEqual(q.pricing.delivery.selection.extras,['protection']);
});

test('invalid monthly orders and retired checkout mode are rejected before invoice creation',async()=>{
 for(const [kind,items,country] of [
  ['unknown',selections,'US'],
  ['builder',selections,'ZZ'],
  ['builder',selections.slice(0,3),'US'],
  ['builder',[...selections.slice(0,3),selections[0]],'US'],
  ['builder',[...selections.slice(0,3),{id:'fixture-supply',size:'1',qty:1}],'US'],
  ['builder',[{...selections[0],qty:64}],'US'],
  ['product',selections,'US']
 ])assert.throws(()=>pricedBasket(kind,items,catalog,country,delivery.defaults),{status:400});
 const user={id:'fixture-owner',email:'owner@example.test'};
 const request={id:randomUUID(),kind:'goods',name:'Fixture owner',items:selections,research_use:true,consent:true,
  terms_version:commerceTerms.version,address:{line1:'23 Test Street',city:'Example',region:'NY',postal_code:'10001',country:'US'}};
 for(const flags of [{research_builder_mode:'monthly_invoice'},{automatic_renewal:true},{subscription:true}]){
  let calls=0;
  await assert.rejects(requestInvoice({rpc:()=>{calls++;}},user,{...request,...flags},catalog,{direct:true}),{status:409});
  assert.equal(calls,0);
 }
});
