'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const {orderBasis}=require('../lib/fulfillment-quote');
const {handle}=require('../lib/lotus-admin');
const variants=runInNewContext(readFileSync('products.js','utf8')+';CATALOG.flatMap(p=>p.variants.map(v=>({id:p.id,size:v.size,qty:1})))');
const id='11111111-1111-4111-8111-111111111111';
function invoice(currency='USD'){
 return{id,customer_id:'customer',kind:'goods',status:'paid',currency,paid_at:'2026-11-22T21:00:00Z',
  shipping_cents:1400,tax_cents:850,total_cents:14501,pricing:{delivery:{shipping_cents:900,extras_cents:500},membership_addon:{fee_cents:1500},fx:{fx_ppm:1380001},fx_ppm:1380001},
  request_data:{items:[{id:'a',size:'5mg',qty:1}]},commerce_receipts:[{kind:'payment',currency,amount_cents:14501}],commerce_partner_commissions:null,commerce_fulfillment_items:[]};
}
test('all catalog variants and mixed paid, BOGO and gift quantities use one settled order in invoice currency',()=>{
 assert.equal(new Set(variants.map(({id,size})=>id+":"+size)).size,variants.length);
 const order=invoice('CAD');
 order.request_data.items=variants;
 order.pricing.bogo_campaign={free_units:[variants[0],variants[2]]};
 order.pricing.bundled_items=[{id:'gift-bac-3',size:'3 mL',qty:1,line_total_cents:0}];
 order.commerce_partner_commissions={status:'pending',amount_cents:1500};
 assert.deepEqual(orderBasis(order),{available:true,currency:'CAD',receipts_cents:11651,commission_cents:2071,commission_usd_cents:1500,paid_units:variants.length,free_units:3});
 order.currency='USD';order.commerce_receipts[0].currency='USD';
 assert.equal(orderBasis(order).commission_cents,1500);
});
test('uncertain and reversed orders never return a quote cap',()=>{
 for(const change of [
  o=>o.commerce_receipts.length=0,o=>o.commerce_receipts[0].currency='USD',o=>o.commerce_receipts[0].amount_cents--,
  o=>o.commerce_receipts.push({kind:'refund',amount_cents:1,currency:'CAD'}),
  o=>o.status='refunded',o=>o.cancellation_status='review',o=>o.status='accepted',o=>o.tax_cents=null,
  o=>o.commerce_partner_commissions={status:'reversed',amount_cents:14},
  o=>{o.commerce_partner_commissions={status:'paid',amount_cents:14};delete o.pricing.fx;},
  o=>o.pricing.referral={partner_id:'partner'},o=>o.pricing.delivery.extras_cents=undefined,
  o=>o.pricing.membership_addon={},o=>o.pricing.bogo_campaign={free_units:[{id:'unmatched',size:'any',qty:1}]}
 ]){
  const order=invoice('CAD');change(order);assert.equal(orderBasis(order).available,false,String(change));
 }
 assert.equal(orderBasis(invoice(),{first_invoice_id:id,created_at:'2026-11-29T21:00:00Z'}).available,false);
 assert.equal(orderBasis(invoice(),{first_invoice_id:'other',created_at:'2026-11-21T21:00:00Z'}).available,false);
 assert.equal(orderBasis(invoice(),{first_invoice_id:'other',created_at:'2026-11-29T21:00:00Z'}).commission_cents,0);
});
test('the normal GET handler enforces admin authentication, reads only the requested records and reports missing attribution data',async()=>{
 const password='fixture'.repeat(6),params=new URLSearchParams({view:'fulfillment_quote',id});
 const tables=[];
 const db={from(table){tables.push(table);return{select(){return{eq(key,value){
   assert.equal(key,table==='commerce_invoices'?'id':'customer_id');assert.equal(value,table==='commerce_invoices'?id:'customer');
   return{maybeSingle:async()=>({data:table==='commerce_invoices'?invoice():null})};
 }}}}}};
 async function run(headers={}){
  const res={setHeader(){},status(n){this.code=n;return this},json(d){this.body=d;return this}};
  await handle({method:'GET',headers},res,params,{db,env:{ADMIN_ORDERS_PASSWORD:password}});return res;
 }
 assert.equal((await run()).code,401);assert.deepEqual(tables,[]);
 let res=await run({'x-admin-password':password});assert.equal(res.code,200);assert.equal(res.body.receipts_cents,11651);
 assert.deepEqual(tables,['commerce_invoices','commerce_referrals']);
});
