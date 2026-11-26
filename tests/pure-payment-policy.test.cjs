'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json'),gateway=require('../lib/gateway-config');
const policy=require('../lib/pure-payment-policy');
const env={SITE_URL:'https://getpurelabs.com',CHECKOUT_RATE_LIMIT_SECRET:'isolated-checkout-test-secret',
 RAMPEX_ENABLED:'true',RAMPEX_MODE:'live',RAMPEX_API_KEY:'isolated-rampex-key',RAMPEX_WEBHOOK_SECRET:'isolated-rampex-webhook-secret',
 POLYGON_USDC_ENABLED:'true',POLYGON_USDC_RECIPIENT:'0x1111111111111111111111111111111111111111',POLYGON_USDC_RPC_URL:'https://polygon-rpc.test',POLYGON_USDC_SECONDARY_RPC_URL:'https://polygon-second.test'};
const card={id:randomUUID(),kind:'hosted_link',native_provider:'rampex',rampex_provider:'hosted',active:true,label:'Card',currency:'USD',sale_scope:'goods',version:2,countries:['US','CA']};
const cryptoMethod={...card,id:randomUUID(),native_provider:'polygon_usdc',rampex_provider:null,label:'Crypto'};
const stripe={...card,id:randomUUID(),rampex_provider:'stripe',countries:['US']};
const bank={...card,id:randomUUID(),kind:'bank_transfer',native_provider:null};
const user={id:randomUUID(),email:'fixture@example.test',email_confirmed_at:'2026-11-17'};
const catalog=[{id:'a',name:'Compound A',variants:[{size:'5mg',price:19.99}]},{id:'b',name:'Compound B',variants:[{size:'10mg',price:30.01}]}];
const body=(method=card)=>({id:randomUUID(),kind:'goods',method_id:method.id,consent:true,research_use:true,checkout_version:config.version,
 name:'Fixture Researcher',items:[{id:'a',size:'5mg',qty:2},{id:'b',size:'10mg',qty:1}],
 address:{line1:'123 Test Street',city:'Test City',region:'ON',postal_code:'N2L 1A1',country:'CA'},delivery:{shipping:'next_day',extras:['protection']}});
function dbMock(methods=[card,cryptoMethod,stripe,bank]){
 const accounts=methods.filter(m=>m.native_provider).map(m=>({method_id:m.id,provider:m.native_provider,mode:'live',account_tag:gateway.configuration(m.native_provider,env).account_tag,countries:m.countries,rampex_provider:m.rampex_provider}));
 const calls=[];
 return {calls,auth:{getUser:async()=>({data:{user}})},from(table){
  const result=table==='commerce_payment_methods'?methods:table==='commerce_gateway_accounts'?accounts:table==='commerce_delivery_options'?require('../config/delivery-options.json'):table==='commerce_balance_accounts'?{points:0,credit_cents:0}:['commerce_balance_events','commerce_memberships'].includes(table)?[]:null;
  const q={select(){return q;},eq(){return q;},in(){return q;},is(){return q;},lte(){return q;},gt(){return q;},order(){return q;},limit(){return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve({data:result}).then(resolve,reject);}};return q;
 },rpc:async(name,args)=>{calls.push({name,args});return{data:{id:args.p_data?.id,status:'accepted'}};}};
}
async function request(body,params='',signed=true,db=dbMock(),overrides={}){
 const response={statusCode:200,setHeader(){},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};
 await checkout.handle({method:body?'POST':'GET',headers:{origin:env.SITE_URL,'content-type':'application/json',...(signed?{authorization:'Bearer fixture-auth-token-long-enough'}:{})},body},response,new URLSearchParams(params),{env:{...env,...overrides},db,catalog,rateLimit:async()=>{}});
 return {response,db};
}
test('only ready hosted Card and configured Crypto are offered; historical Stripe/bank stay out of new checkout',async()=>{
 const db=dbMock(),methods=await checkout.methods(db,env,'CA');
 assert.deepEqual(methods.map(m=>m.id),[card.id,cryptoMethod.id]);
 assert.deepEqual((await checkout.methods(db,env,'GB')).map(m=>m.id),[]);
 const {response}=await request(null,'checkout=public',false,db,{POLYGON_USDC_ENABLED:'false'});
 assert.equal(response.statusCode,200);assert.deepEqual(response.body.methods.map(m=>m.label),['Card']);
 assert.deepEqual(response.body.payment_options.map(m=>[m.key,m.status]),[['card','available'],['crypto','setup_pending'],['interac','setup_pending']]);
 assert.equal(response.body.capabilities.apple_pay,false);assert.equal(response.body.capabilities.google_pay,false);
 for(const old of [stripe,bank]){const {response,db}=await request({...body(old),action:'quote'});assert.equal(response.statusCode,409);assert.equal(db.calls.length,0);}
});
test('direct crypto gives 5% of merchandise; card conversion receives no crypto discount',async()=>{
 for(const method of [card,cryptoMethod]){
  const record=await checkout.normalize({},user,body(method),catalog),quote=checkout.price(record,method,null,{points:0,credit_cents:0});
  assert.equal(quote.subtotal_cents,6999);assert.equal(quote.shipping_cents,6995);
  assert.equal(quote.discount_cents,method===cryptoMethod?350:0);
  assert.equal(quote.pricing.crypto_discount_cents,method===cryptoMethod?350:0);
  assert.equal(quote.total_cents,method===cryptoMethod?13644:13994);
  assert.equal(quote.pricing.lines.reduce((total,line)=>total+line.crypto_discount_cents,0),quote.pricing.crypto_discount_cents);
 }
});
test('BLACKFRIDAY10 applies first, then Crypto saves 5% of the remaining merchandise; removing the coupon preserves Crypto',async()=>{
 const input={...body(cryptoMethod),coupon:'blackfriday10'},record=await checkout.normalize({},user,input,catalog);
 const quote=checkout.price(record,cryptoMethod,null,{points:0,credit_cents:0});
 assert.equal(quote.discount_cents,1015);assert.equal(quote.pricing.coupon_discount_cents,700);assert.equal(quote.pricing.crypto_discount_cents,315);
 assert.equal(quote.pricing.crypto_discount_eligible,true);assert.equal(quote.pricing.discount_source,'coupon_crypto');
 assert.deepEqual(quote.pricing.lines.map(line=>line.coupon_discount_cents),[400,300]);
 assert.deepEqual(quote.pricing.lines.map(line=>line.crypto_discount_cents),[180,135]);
 assert.deepEqual(quote.pricing.lines.map(line=>line.discount_cents),[580,435]);
 assert.ok(quote.pricing.lines.every(line=>line.discount_bps===1450&&line.line_total_cents===line.gross_cents-line.coupon_discount_cents-line.crypto_discount_cents));
 record.request.checkout.coupon='';
 const restored=checkout.price(record,cryptoMethod,null,{points:0,credit_cents:0});
 assert.equal(restored.discount_cents,350);assert.equal(restored.pricing.discount_source,'crypto');
});
test('Crypto stacks with the retail coupon at any regular quantity and preserves exclusive bulk tiers',async()=>{
 const cat=[{id:'a',name:'Compound A',variants:[{size:'5mg',price:100}]}];
 for(const method of [cryptoMethod,card])for(const qty of [1,2,5,10,25,50]){
  const input={...body(method),coupon:'BLACKFRIDAY10',items:[{id:'a',size:'5mg',qty}]};
  const record=await checkout.normalize({},user,input,cat),q=checkout.price(record,method,null,{points:0,credit_cents:0});
  const gross=10000*qty,base=gross*.10,crypto=method===cryptoMethod?(gross-base)*.05:0;
  assert.equal(q.pricing.quantity_discount_cents||0,0);
  assert.equal(q.pricing.coupon_discount_cents,base);
  assert.equal(q.pricing.crypto_discount_cents,crypto);
  assert.equal(q.discount_cents,base+crypto);
  assert.equal(q.shipping_cents,6995);assert.equal(q.tax_cents,0);
  assert.equal(q.total_cents,gross-q.discount_cents+6995);
  const bulkCoupon=await checkout.normalize({},user,{...input,bulk_order:true},cat);
  assert.throws(()=>checkout.price(bulkCoupon,method,null,{points:0,credit_cents:0}),/cannot be combined/);
  const bulk=await checkout.normalize({},user,{...input,bulk_order:true,coupon:''},cat);
  if(qty<10)assert.throws(()=>checkout.price(bulk,method,null,{points:0,credit_cents:0}),/require 10 units/);
  else{
   const bulkQuote=checkout.price(bulk,method,null,{points:0,credit_cents:0});
   const bulkSavings=gross*(qty>=50?.60:.50);
   assert.equal(bulkQuote.pricing.quantity_discount_cents,bulkSavings);
   assert.equal(bulkQuote.pricing.coupon_discount_cents,0);
   assert.equal(bulkQuote.pricing.crypto_discount_cents,0);
   assert.equal(bulkQuote.total_cents,gross-bulkSavings+6995);
  }
 }
});
test('unauthenticated or unselected cart never receives payment discount; authenticated method preview matches final quote',async()=>{
 const input=body(cryptoMethod),preview={...input,country:input.address.country};
 for(const signed of [false,true]){
  const {response}=await request(preview,'checkout=cart',signed);
  assert.equal(response.statusCode,200);assert.equal(response.body.discount_cents,signed?350:0);
 }
 const {response:unselected}=await request({...preview,method_id:null},'checkout=cart',true);
 assert.equal(unselected.body.discount_cents,0);
 const {response:cart}=await request(preview,'checkout=cart');
 const {response:quoted,db}=await request({...input,action:'quote'});
 assert.equal(quoted.statusCode,200);assert.deepEqual(cart.body.pricing,quoted.body.pricing);
 const {response:placed}=await request({...input,action:'place',quote:quoted.body.quote},'',true,db);
 assert.equal(placed.statusCode,201);assert.deepEqual(db.calls[0].args.p_data.pricing,quoted.body.pricing);
 const {response:stale}=await request({...input,method_id:card.id,action:'place',quote:quoted.body.quote});
 assert.equal(stale.statusCode,409);
});
test('stacked Crypto discounts exclude delivery fees and use net merchandise for free shipping',async()=>{
 for(const [cents,coupon,shipping] of [[26315,'',1195],[26316,'',0],[29239,'BLACKFRIDAY10',1195],[29240,'BLACKFRIDAY10',0]]){
  const localCatalog=[{id:'a',name:'Compound A',variants:[{size:'5mg',price:cents/100}]}];
  const input={...body(cryptoMethod),coupon,items:[{id:'a',size:'5mg',qty:1}],address:{...body().address,country:'US'},delivery:{shipping:'standard',extras:['protection']}};
  const record=await checkout.normalize({},user,input,localCatalog),quote=checkout.price(record,cryptoMethod,null,{points:0,credit_cents:0});
  assert.equal(quote.shipping_cents,shipping+500);assert.equal(quote.pricing.delivery.extras_cents,500);
 }
 assert.equal(policy.kind(stripe),null);assert.equal(policy.kind(bank),null);
});
test('balance-only or discount-covering redemption suppresses the automatic crypto saving; valid coupon remains usable',async()=>{
 const cat=[{id:'a',name:'Compound A',variants:[{size:'5mg',price:100}]}];
 const input={...body(cryptoMethod),items:[{id:'a',size:'5mg',qty:1}],address:{...body().address,country:'US'},delivery:{shipping:'standard',extras:[]}};
 for(const [credit,coupon,discount,total,suppressed] of [[500,'',500,10195,false],[10695,'',0,500,true],[11195,'',0,0,true],[500,'BLACKFRIDAY10',1450,9245,false],[9745,'BLACKFRIDAY10',1000,450,true],[10195,'BLACKFRIDAY10',1000,0,true]]){
  const record=await checkout.normalize({},user,{...input,credit_cents:credit,coupon},cat);
  const q=checkout.price(record,cryptoMethod,null,{points:0,credit_cents:20000});
  assert.equal(q.discount_cents,discount);assert.equal(q.total_cents,total);assert.equal(q.pricing.crypto_discount_suppressed_for_balance,suppressed);
 }
 for(const [points,discount,total,suppressed] of [[500,4350,25150,false],[25650,3000,1350,true],[27000,3000,0,true]]){
  const record=await checkout.normalize({},user,{...input,coupon:'BLACKFRIDAY10',items:[{id:'a',size:'5mg',qty:3}],points},cat);
  const q=checkout.price(record,cryptoMethod,null,{points:30000,credit_cents:0});
  assert.equal(q.discount_cents,discount);assert.equal(q.total_cents,total);assert.equal(q.pricing.crypto_discount_suppressed_for_balance,suppressed);
  assert.equal(q.pricing.coupon_discount_cents,3000);
 }
});
module.exports={env,card,cryptoMethod,stripe,bank,user,catalog,body,dbMock};
