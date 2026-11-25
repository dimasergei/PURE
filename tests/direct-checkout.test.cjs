'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json');
const id='c0000000-0000-4000-8000-000000000001',uid='c0000000-0000-4000-8000-000000000002',mid='c0000000-0000-4000-8000-000000000003';
const user={id:uid,email:'customer@example.test',email_confirmed_at:'2026-01-01'};
const method={id:mid,active:true,kind:'hosted_link',native_provider:'rampex',rampex_provider:'hosted',countries:['US','CA','GB'],version:1,currency:'USD',sale_scope:'goods',label:'Card'};
const catalog=[{id:'fixture-product',name:'Fixture product',variants:[{size:'5mg',price:100}]}];
const body={id,kind:'goods',method_id:mid,consent:true,checkout_version:config.version,items:[{id:'fixture-product',size:'5mg',qty:1,price:0.01}],name:'Customer',organization:'Lab',address:{line1:'123 Fixture Street',city:'Fixture City',region:'FL',postal_code:'34287',country:'US'},research_use:true};
const env={POLYGON_USDC_ENABLED:'true',POLYGON_USDC_RECIPIENT:'0x1111111111111111111111111111111111111111',POLYGON_USDC_RPC_URL:'https://primary.fixture.test',POLYGON_USDC_SECONDARY_RPC_URL:'https://secondary.fixture.test',RAMPEX_API_KEY:'isolated-rampex-fixture',RAMPEX_WEBHOOK_SECRET:'isolated-rampex-webhook-secret',RAMPEX_ENABLED:'true',RAMPEX_MODE:'live',SITE_URL:'https://getpurelabs.com',ADMIN_ORDERS_PASSWORD:'x'.repeat(40),CHECKOUT_RATE_LIMIT_SECRET:'fixture-secret-with-at-least-32-characters'};
function response(){return{code:200,setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};}
function dbMock({balance={points:1000,credit_cents:5000},membership=null,existing=null,partner=null,existingReferral=null,paymentMethods=[method],environment=env,cardTestGrant=null}={}){
 const calls=[];return{calls,auth:{getUser:async()=>({data:{user}})},from(table){const value=table==='commerce_gateway_accounts'?paymentMethods.filter(m=>m.native_provider).map(m=>({method_id:m.id,provider:m.native_provider,rampex_provider:m.rampex_provider,mode:'live',account_tag:require('../lib/gateway-config').configuration(m.native_provider,environment).account_tag,countries:m.countries})):table==='commerce_delivery_options'?require('../config/delivery-options.json'):table==='commerce_partner_codes'?(partner?{partner_id:partner.customer_id}:null):table==='commerce_partners'?partner:table==='commerce_referrals'?existingReferral:table==='commerce_payment_methods'?paymentMethods:table==='commerce_memberships'?(membership?[membership]:[]):table==='commerce_balance_accounts'?balance:table==='commerce_invoices'?existing:table==='commerce_card_test_entitlements'?cardTestGrant:[];
  const q={select(){return q;},eq(){return q;},in(){return q;},ilike(){return q;},is(){return q;},lte(){return q;},gt(){return q;},order(){return q;},limit(){return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve({data:value}).then(resolve,reject);}};return q;},rpc:async(name,args)=>{calls.push({name,args});return{data:{id,status:'accepted'}};}};
}
const request=(b,headers={})=>({method:'POST',headers:{origin:env.SITE_URL,'content-type':'application/json',authorization:'Bearer fixture-auth-token-long-enough',...headers},body:b});
async function call(b,{db=dbMock(),cat=catalog,params='',headers={},deps={}}={}){const res=response();await checkout.handle(request(b,headers),res,new URLSearchParams(params),{env,db,catalog:cat,rateLimit:async()=>{},...deps});return{res,db};}

test('checkout quotes require the canonical production origin and never place orders',async()=>{
 for(const configured of ['https://getpurelabs.com','https://altapurelabs.com'])for(const origin of ['https://getpurelabs.com','https://altapurelabs.com']){
  const db=dbMock(),res=response();await checkout.handle(request({...body,action:'quote'},{origin}),res,new URLSearchParams(),{env:{...env,SITE_URL:configured},db,catalog,rateLimit:async()=>{}});
  assert.equal(res.code,origin==='https://getpurelabs.com'?200:403);assert.equal(db.calls.length,0);
 }
});
test('authoritative catalog ignores client prices and retired volume/referral discounts while applying verified BLACK benefits',async()=>{
 for(const qty of [1,2,10,25,50]){
  const record=await checkout.normalize({},user,{...body,items:[{...body.items[0],qty}]},catalog);
  const q=checkout.price(record,method,{plan:'elite',invoice_id:id},{points:0,credit_cents:0},{customer_id:uid,code:'PARTNER',first_order:true});
  const rate=.10;assert.equal(q.subtotal_cents,qty*10000);assert.equal(q.discount_cents,qty*10000*rate);assert.equal(q.earned_points,qty*10000*(1-rate)/10);
  assert.equal(q.total_cents,qty*10000*(1-rate));assert.equal(q.membership_invoice_id,id);
  assert.equal(q.pricing.lines[0].qty,qty);assert.equal(q.pricing.lines[0].unit_price_cents,10000);
  assert.equal(q.pricing.lines[0].bogo_free_units,0);assert.deepEqual(q.pricing.referral,{partner_id:uid,code:'PARTNER',first_order:true});assert.equal(q.pricing.payment_discount,undefined);
 }
});
test('existing points and store credit remain payment value without changing regular source prices',async()=>{
 const record=await checkout.normalize({},user,{...body,points:500,credit_cents:1000},catalog);
 const q=checkout.price(record,method,null,{points:600,credit_cents:1200});
 assert.equal(q.total_cents,9295);assert.equal(q.discount_cents,0);assert.equal(q.earned_points,0);
 assert.equal(q.points_redeemed,500);assert.equal(q.credit_redeemed_cents,1000);
 assert.throws(()=>checkout.price(record,method,null,{points:499,credit_cents:1200}),/available/);
 assert.throws(()=>checkout.price(record,method,null,{points:600,credit_cents:999}),/credit/);
 for(const points of [1,99]){
  const r=await checkout.normalize({},user,{...body,points},catalog);assert.throws(()=>checkout.price(r,method,null,{points:1000,credit_cents:0}),/at least 100/);
 }
 const over=await checkout.normalize({},user,{...body,points:10001},catalog);
 assert.throws(()=>checkout.price(over,method,null,{points:20000,credit_cents:0}),/merchandise only/);
});
test('BLACKFRIDAY10 is normalized and cart, quote and persisted order have identical canonical prices',async()=>{
 const cat=[{id:'a',name:'A',variants:[{size:'5mg',price:19.99}]},{id:'b',name:'B',variants:[{size:'10mg',price:30.01}]}];
 const b={...body,coupon:' blackFriday10 ',items:[{id:'a',size:'5mg',qty:2,price:0},{id:'b',size:'10mg',qty:1,price:0}],total_cents:1,pricing:{discount_cents:999999}};
 const {res:quoted,db}=await call({...b,action:'quote'},{cat});assert.equal(quoted.code,200);
 assert.equal(quoted.body.subtotal_cents,6999);assert.equal(quoted.body.discount_cents,700);assert.equal(quoted.body.total_cents,7094);
 assert.deepEqual(quoted.body.pricing.lines.map(x=>x.coupon_discount_cents),[400,300]);
 const {res:cart}=await call({...b,country:'US'},{db,cat,params:'checkout=cart',headers:{authorization:''}});
 assert.equal(cart.code,200);assert.deepEqual(cart.body.pricing,quoted.body.pricing);assert.equal(db.calls.length,0);
 const {res:placed}=await call({...b,action:'place',quote:quoted.body.quote},{db,cat});assert.equal(placed.code,201);assert.equal(db.calls.length,1);
 const saved=db.calls[0].args.p_data;assert.equal(db.calls[0].name,'commerce_place_checkout');
 assert.deepEqual(saved.pricing,quoted.body.pricing);assert.equal(saved.total_cents,quoted.body.total_cents);
 assert.equal(saved.request.checkout.coupon,'BLACKFRIDAY10');assert.deepEqual(saved.request.items.map(x=>x.qty),[2,1]);
 assert.equal(saved.checkout_version,config.version);assert.equal(saved.earned_points,0);
});
test('removing the explicit coupon restores regular price and invalidates the prior quote',async()=>{
 const b={...body,coupon:'BLACKFRIDAY10',items:[{...body.items[0],qty:2}]};
 const {res:q,db}=await call({...b,action:'quote'});assert.equal(q.body.discount_cents,2000);assert.equal(q.body.total_cents,18795);
 const {res:r}=await call({...b,coupon:'',action:'quote'},{db});assert.equal(r.body.discount_cents,0);assert.equal(r.body.total_cents,20795);
 const {res:stale}=await call({...b,coupon:'',action:'place',quote:q.body.quote},{db});assert.equal(stale.code,409);assert.equal(db.calls.length,0);
});
test('CARDTEST gives the approved account a one-item sandbox Card quote with a US$1 merchandise floor',async()=>{
 const environment={...env,VERCEL_ENV:'preview',PURE_GATEWAY_ALLOW_TEST_PAYMENTS:'true',PURE_GATEWAY_ENABLED:'true',
  PURE_GATEWAY_URL:'https://sandbox.fixture.test',PURE_GATEWAY_API_SECRET:'a'.repeat(40),
  PURE_GATEWAY_WEBHOOK_SECRET:'b'.repeat(40),PURE_GATEWAY_CURRENCIES:'USD'};
 const card={...method,native_provider:'pure_gateway'};
 const grant={expires_at:new Date(Date.now()+60000).toISOString(),redeemed_invoice_id:null};
 const cat=[{...catalog[0],variants:[{size:'5mg',price:30}]}];
 const b={...body,coupon:' cardtest ',action:'quote'};
 const paymentMethods=[card,{...method,id:'c0000000-0000-4000-8000-000000000004',native_provider:'polygon_usdc'}];
 const opts={cat,db:dbMock({paymentMethods,environment,cardTestGrant:grant}),deps:{env:environment}};
 const {res:cart}=await call({...b,method_id:null,country:'US'},{...opts,params:'checkout=cart'});
 const {res:q}=await call(b,opts);
 assert.equal(cart.code,200);
 assert.equal(q.code,200);
 assert.equal(q.body.pricing.coupon_code,'CARDTEST');
 assert.equal(q.body.pricing.lines[0].discount_reason,'coupon_cardtest');
 assert.equal(q.body.discount_cents,2900);
 assert.equal(q.body.total_cents,100+q.body.shipping_cents);
 assert.equal(q.body.earned_points,0);
 assert.deepEqual(cart.body.pricing,q.body.pricing);
 const {res:placed}=await call({...b,action:'place',quote:q.body.quote},opts);
 assert.equal(placed.code,201);
 assert.equal(opts.db.calls[0].args.p_data.total_cents,q.body.total_cents);
 const denied=[
  {...opts,params:'checkout=cart',headers:{authorization:''}},
  {...opts,deps:{env:{...environment,PURE_GATEWAY_ALLOW_TEST_PAYMENTS:'false'}}},
  {...opts,db:dbMock({paymentMethods,environment})},
  {...opts,db:dbMock({paymentMethods,environment,cardTestGrant:{...grant,redeemed_invoice_id:id}})},
  {...opts,db:dbMock({paymentMethods,environment,cardTestGrant:{...grant,expires_at:'2000-01-01T00:00:00Z'}})},
 ];
 for(const opt of denied)assert.equal((await call(b,opt)).res.code,400);
 for(const change of [{credit_cents:100},{items:[{...body.items[0],qty:2}]},{bulk_order:true}])
  assert.equal((await call({...b,...change},opts)).res.code,400);
 const {res:alternative}=await call({...b,method_id:paymentMethods[1].id},opts);
 assert.equal(alternative.code,400);
 assert.equal(opts.db.calls.length,1);
});
test('US standard shipping threshold uses discounted merchandise before account balances',async()=>{
 for(const [cents,coupon,shipping] of [[24999,'',795],[25000,'',0],[27777,'BLACKFRIDAY10',795],[27778,'BLACKFRIDAY10',0]]){
  const cat=[{...catalog[0],variants:[{size:'5mg',price:cents/100}]}];
  const r=await checkout.normalize({},user,{...body,coupon,points:500,credit_cents:1000},cat),q=checkout.price(r,method,null,{points:1000,credit_cents:2000});
  assert.equal(q.shipping_cents,shipping,'subtotal '+cents+' '+coupon);assert.equal(q.total_cents,cents-Math.round(cents*(coupon?0.10:0))+shipping-1500);
 }
});
test('coupon does not make express, international shipping, priority or protection free',async()=>{
 for(const [country,shipping,extras,expected] of [['US','standard',['protection'],1695],['US','express',['protection'],3495],['US','next_day',['priority','protection'],7494],['CA','standard',[],2495],['CA','next_day',[],6495],['CA','next_day',['protection'],6995],['GB','express',[],7995]]){
  const r=await checkout.normalize({},user,{...body,coupon:'BLACKFRIDAY10',items:[{...body.items[0],qty:2}],address:{...body.address,country},delivery:{shipping,extras}},catalog);
  assert.equal(checkout.price(r,method,null,{points:0,credit_cents:0}).shipping_cents,expected);
 }
 for(const country of ['ZZ','RU','GB']){
  const r=await checkout.normalize({},user,{...body,address:{...body.address,country},delivery:{shipping:'next_day',extras:[]}},catalog);
  assert.throws(()=>checkout.price(r,method,null,{points:0,credit_cents:0}),/unavailable|not available/);
 }
});
test('removed coupons, unsupported membership routes and forged program flags are blocked before any writes',async()=>{
 for(const params of ['','checkout=cart'])for(const action of ['quote','place'])for(const extra of [{kind:'membership',plan:'vip'},{plan:'elite'},{billing_period:'annual'},{research_builder:true},{subscription:true}]){
  const {res,db}=await call({...body,action,...extra},{params});assert.ok([400,409].includes(res.code));assert.equal(db.calls.length,0);
 }
 for(const coupon of ['BOGO','AP-ABCDEFGH2345','WELCOME10'])for(const params of ['','checkout=cart']){
  const {res,db}=await call({...body,action:'quote',coupon},{params});assert.equal(res.code,400);assert.equal(db.calls.length,0);
 }
});
test('Bulk checkout groups strengths by compound and includes US express',async()=>{
 const cat=[{...catalog[0],variants:[...catalog[0].variants,{size:'20mg',price:80}]},
  {id:'fixture-two',name:'Second compound',variants:[{size:'10mg',price:80}]}];
 const lines=(a,b,id=cat[0].id)=>[{id:cat[0].id,size:'5mg',qty:a},{id,size:id===cat[0].id?'20mg':'10mg',qty:b}];
 for(const [a,b,rate] of [[6,4,5000],[35,15,6000]]){
  const rec=await checkout.normalize({},user,{...body,bulk_order:true,items:lines(a,b)},cat);
  const q=checkout.price(rec,method,null,{points:0,credit_cents:0});
  assert.equal(q.shipping_cents,0);
  assert.equal(q.pricing.delivery.selection.shipping,'express');
  assert.deepEqual(q.pricing.lines.map(line=>line.discount_bps),[rate,rate]);
  assert.equal(q.pricing.bulk_unit_count,a+b);
 }
 const rec=await checkout.normalize({},user,{...body,bulk_order:true,items:lines(6,4,cat[1].id)},cat);
 assert.throws(()=>checkout.price(rec,method,null,{points:0,credit_cents:0}),/10 units of each compound/);
});

test('bulk preview, checkout quote and saved invoice use only the volume price despite old campaign settings',async()=>{
 const partner={customer_id:'c0000000-0000-4000-8000-000000000008',code:'BULKLAB',status:'active'};
 const db=dbMock({partner});
 const headers={cookie:'ap_ref='+require('../lib/partner-program').cookieToken(partner.code,env.CHECKOUT_RATE_LIMIT_SECRET)};
 const deps={env:{...env,BOGO_ENABLED:'true',BOGO_VARIANTS:'catalog',
  BOGO_STARTS_AT:new Date(Date.now()-86400000).toISOString(),BOGO_ENDS_AT:new Date(Date.now()+86400000).toISOString()}};
 const cat=[{...catalog[0],variants:[{size:'5mg',price:40},{size:'10mg',price:80}]}];
 const options={db,cat,headers,deps};
 const basket={...body,bulk_order:true,items:[{id:cat[0].id,size:'5mg',qty:4,price:.01},{id:cat[0].id,size:'10mg',qty:6,price:.01}]};
 for(const coupon of ['BLACKFRIDAY10',partner.code,'WHEEL10','REVIEW50']){
  for(const action of ['cart','quote','place']){
   const result=await call({...basket,coupon,...(action==='cart'?{country:'US'}:{action})},{...options,params:action==='cart'?'checkout=cart':''});
   assert.equal(result.res.code,400,action+' '+coupon);
  }
 }
 assert.equal(db.calls.length,0);
 const {res:preview}=await call({...basket,country:'US'},{...options,params:'checkout=cart'});
 const {res:quoted}=await call({...basket,action:'quote'},options);
 assert.equal(preview.code,200);assert.equal(quoted.code,200);
 for(const priced of [preview.body,quoted.body]){
  assert.equal(priced.subtotal_cents,64000);assert.equal(priced.discount_cents,32000);
  assert.equal(priced.total_cents,32000);assert.equal(priced.shipping_cents,0);
  assert.deepEqual(priced.pricing.lines.map(line=>line.qty),[4,6]);
  assert.equal(priced.pricing.bogo_campaign,undefined);
  assert.equal(priced.pricing.affiliate_code,undefined);assert.equal(priced.pricing.coupon_discount_cents,0);
  assert.equal(priced.automatic_partner_offer,undefined);
  assert.deepEqual(priced.pricing.referral,{partner_id:partner.customer_id,code:partner.code,first_order:true});
  assert.equal(priced.pricing.bundled_items,undefined);
 }
 assert.equal(preview.body.membership_offer,null);
 const {res:placed}=await call({...basket,action:'place',quote:quoted.body.quote},options);
 assert.equal(placed.code,201);assert.equal(db.calls.length,1);
 const stored=db.calls[0].args.p_data;
 assert.deepEqual(stored.pricing,quoted.body.pricing);assert.equal(stored.total_cents,32000);
 const {res:regular}=await call({...basket,bulk_order:false,country:'US'},{...options,params:'checkout=cart'});
 assert.equal(regular.code,200);
 assert.equal(regular.body.pricing.quantity_discount_cents,undefined);
 assert.equal(regular.body.pricing.bogo_campaign,undefined);
 assert.equal(regular.body.pricing.coupon_discount_cents,12800);
});

test('guest bulk preview enforces per-compound thresholds, quantity limits and Canadian delivery',async()=>{
 const cat=[{...catalog[0],variants:[{size:'5mg',price:10},{size:'10mg',price:20}]}];
 const get=items=>call({bulk_order:true,items,country:'CA',delivery:{shipping:'express',extras:['protection']}},
  {cat,params:'checkout=cart',headers:{authorization:''}});
 for(const [small,large,rate] of [[4,5,0],[4,6,5000],[40,9,5000],[40,10,6000],[100,100,6000],[101,1,0]]){
  const items=[{id:cat[0].id,size:'5mg',qty:small},{id:cat[0].id,size:'10mg',qty:large}];
  const {res}=await get(items);
  if(!rate){assert.equal(res.code,400);continue;}
  assert.equal(res.code,200);assert.equal(res.body.pricing.bulk_unit_count,small+large);
  assert.deepEqual(res.body.pricing.lines.map(line=>line.discount_bps),[rate,rate]);
  const gross=small*1000+large*2000;
  assert.equal(res.body.discount_cents,gross*rate/10000);assert.equal(res.body.shipping_cents,5495);
  assert.equal(res.body.total_cents,gross-res.body.discount_cents+5495);
 }
});

test('bulk member earns the promised non-price benefits and retains one recon gift',async()=>{
 const cat=[{...catalog[0],variants:[{size:'5mg',price:20}]}];
 const black={plan:'elite',invoice_id:id};
 for(const qty of [10,50]){
  const record=await checkout.normalize({},user,{...body,bulk_order:true,items:[{id:cat[0].id,size:'5mg',qty}],
   delivery:{shipping:'standard',extras:['priority','protection']}},cat);
  const q=checkout.price(record,method,black,{points:0,credit_cents:0});
  assert.equal(q.pricing.quantity_discount_cents,qty===10?10000:60000);
  assert.equal(q.pricing.membership_discount_cents,0);assert.equal(q.pricing.coupon_discount_cents,0);
  assert.equal(q.pricing.bundled_items.length,1);assert.equal(q.pricing.bundled_items[0].qty,1);
  assert.equal(q.pricing.delivery.extras.find(extra=>extra.id==='priority').amount_cents,0);
  assert.equal(q.shipping_cents,500);assert.equal(q.membership_invoice_id,black.invoice_id);
  assert.equal(q.earned_points,(q.subtotal_cents-q.discount_cents)/10);
 }
});

test('modified totals, quantities, delivery, prices and old version quotes fail before placement',async()=>{
 const {res:q,db}=await call({...body,action:'quote'});
 const changes=[{body:{items:[{...body.items[0],qty:2}]}},{body:{coupon:'BLACKFRIDAY10'}},{body:{delivery:{shipping:'express',extras:[]}}},{body:{quote:'0'.repeat(64)}},{cat:[{...catalog[0],variants:[{size:'5mg',price:101}]}]}];
 for(const change of changes){const {res}=await call({...body,action:'place',quote:q.body.quote,...change.body},{db,cat:change.cat||catalog});assert.equal(res.code,409);}
 for(const version of ['checkout-2026-11-v1','checkout-2026-11-v2','checkout-2026-11-v3','checkout-2026-11-v4','checkout-2026-11-v5','checkout-2026-11-v6']){
  const {res}=await call({...body,action:'place',quote:q.body.quote,checkout_version:version},{db});assert.equal(res.code,400);
 }
 assert.equal(db.calls.length,0);
});
test('completed request replay returns its existing order without a second debit',async()=>{
 const normalized=await checkout.normalize({},user,body,catalog);
 const db=dbMock({existing:{id,status:'accepted',request_digest:normalized.digest,checkout_version:config.version}});
 const {res}=await call({...body,action:'place',quote:'old'},{db});assert.equal(res.code,200);assert.equal(res.body.replayed,true);assert.equal(db.calls.length,0);
 const {res:conflict}=await call({...body,action:'place',points:100},{db});assert.equal(conflict.code,409);
});
test('an exact retry of a legacy bulk coupon invoice returns the original order once',async()=>{
 const basket={...body,bulk_order:true,coupon:'BLACKFRIDAY10',items:[{...body.items[0],qty:10}]};
 // Saved by the previous production normalizer for this fixture, before new bulk codes were rejected.
 const priorDigest='d82abc044f159eff0a918b6b6081ac4945a15e3dd1aced4903d484b615d245fa';
 const existing={id,status:'accepted',checkout_version:config.version,request_digest:priorDigest};
 const db=dbMock({existing}),place={...basket,action:'place',quote:'prior-confirmed-quote'};
 const {res:replay}=await call(place,{db});
 assert.equal(replay.code,200);assert.deepEqual(replay.body,{id,status:'accepted',replayed:true});
 const {res:changed}=await call({...place,items:[{...body.items[0],qty:11}]},{db});
 assert.equal(changed.code,409);assert.equal(db.calls.length,0);
 const fresh=await call(place);
 assert.equal(fresh.res.code,400);assert.match(fresh.res.body.error,/bulk/i);assert.equal(fresh.db.calls.length,0);
});

test('authentication, origin, malformed cart and credit issuance fail closed',async()=>{
 for(const headers of [{authorization:''},{origin:'https://untrusted.example'}]){const {res,db}=await call({...body,action:'quote'},{headers});assert.ok([401,403].includes(res.code));assert.equal(db.calls.length,0);}
 for(const items of [[{...body.items[0],qty:0}],[{...body.items[0],qty:101}],[{...body.items[0],qty:1.5}],[body.items[0],body.items[0]],[{...body.items[0],size:'unknown'}]]){
  const {res,db}=await call({...body,items,action:'quote'});assert.equal(res.code,400);assert.equal(db.calls.length,0);
 }
 const {res,db}=await call({action:'issue_credit',id,customer_id:uid,amount_cents:100},{params:'checkout=admin'});assert.equal(res.code,401);assert.equal(db.calls.length,0);
});
test('public preview needs no card processor and public/account terms expose current PURE plans',async()=>{
 const db=dbMock({paymentMethods:[]});const {res}=await call({...body,country:'CA',delivery:{shipping:'standard',extras:['protection']}},{db,params:'checkout=cart',headers:{authorization:''}});
 assert.equal(res.code,200);assert.equal(res.body.total_cents,12995);assert.equal(db.calls.length,0);
 for(const params of ['checkout=public','']){const r=response();await checkout.handle({method:'GET',headers:{authorization:'Bearer fixture-auth-token-long-enough'}},r,new URLSearchParams(params),{env,db,catalog});
  assert.equal(r.code,200);assert.equal(r.body.terms.memberships,undefined);assert.equal(r.body.terms.membership_days,undefined);assert.equal(r.body.terms.renewal,undefined);
  assert.equal(r.body.terms.conversion.plans.vip.name,'PURE WHITE');assert.equal(r.body.terms.conversion.plans.elite.name,'PURE BLACK');assert.equal(r.body.terms.conversion.automatic_renewal,false);assert.equal(r.body.config.points_per_dollar,0);
 }
});

test('partner links below the net minimum retain attribution and respect an explicit coupon',async()=>{
 const partners=require('../lib/partner-program');
 const partner={customer_id:'c0000000-0000-4000-8000-000000000004',code:'AP-ABCDEFGH2345',status:'active'};
 const cookie='ap_ref='+partners.cookieToken(partner.code,env.CHECKOUT_RATE_LIMIT_SECRET);
 for(const extra of [{},{coupon:'BLACKFRIDAY10'}]){
  const db=dbMock({partner}),{res}=await call({...body,action:'quote',...extra},{db,headers:{cookie}});
  assert.equal(res.code,200);assert.deepEqual(res.body.pricing.referral,{partner_id:partner.customer_id,code:partner.code,first_order:true});
  assert.equal(res.body.discount_cents,extra.coupon?1000:0);assert.equal(res.body.total_cents,extra.coupon?9795:10795);
 }
 const {res}=await call({...body,action:'quote'},{db:dbMock({partner}),headers:{cookie:cookie+'forged'}});
 assert.equal(res.code,200);assert.equal(res.body.pricing.referral,undefined);assert.equal(res.body.discount_cents,0);
 assert.equal(require('../config/conversion.json').partner.first_order_bps,4000);assert.equal(require('../config/conversion.json').partner.repeat_order_bps,1000);
 assert.equal(require('../config/conversion.json').partner.customer_discount_bps,2000);
});

test('signed first touch qualifies only a verified new buyer and reaches the stored invoice',async()=>{
 const partner={customer_id:'c0000000-0000-4000-8000-000000000004',code:'LAB20',status:'active'};
 const cookie='ap_ref='+require('../lib/partner-program').cookieToken(partner.code,env.CHECKOUT_RATE_LIMIT_SECRET);
 const cat=[{...catalog[0],variants:[{size:'5mg',price:125}]}];
 const db=dbMock({partner}), data={...body,country:'US'};
 const {res:guest}=await call(data,{cat,db,params:'checkout=cart',headers:{authorization:'',cookie}});
 assert.equal(guest.body.partner_offer_pending,true);assert.equal(guest.body.discount_cents,0);assert.equal(guest.body.pricing.referral,undefined);
 const {res:cart}=await call(data,{cat,db,params:'checkout=cart',headers:{cookie}});
 const {res:q}=await call({...data,action:'quote'},{cat,db,headers:{cookie}});
 assert.equal(cart.body.discount_cents,2500);assert.equal(q.body.automatic_partner_offer,true);
 assert.equal(q.body.pricing.affiliate_code,partner.code);assert.deepEqual(cart.body.pricing,q.body.pricing);
 const {res:placed}=await call({...data,action:'place',quote:q.body.quote},{cat,db,headers:{cookie}});
 assert.equal(placed.code,201);assert.equal(db.calls[0].args.p_data.request.checkout.affiliate_code,partner.code);
 assert.equal(db.calls[0].args.p_data.total_cents,q.body.total_cents);
 const explicit=await call({...data,coupon:'BLACKFRIDAY10',action:'quote'},{cat,db,headers:{cookie}});
 assert.equal(explicit.res.body.discount_cents,2500);assert.equal(explicit.res.body.automatic_partner_offer,true);
 assert.equal(explicit.res.body.requested_coupon,'BLACKFRIDAY10');
 assert.equal(explicit.res.body.pricing.merchandise_offer,'affiliate');
 assert.equal(explicit.res.body.pricing.referral.code,partner.code);
 const otherPartner={...partner,customer_id:'c0000000-0000-4000-8000-000000000005',code:'OTHER20'};
 const conflictDb=dbMock({partner});
 const table=conflictDb.from.bind(conflictDb);
 conflictDb.from=name=>{
  const query=table(name);const filter=query.eq.bind(query);
  query.eq=(column,value)=>{
   if(name==='commerce_partner_codes'&&value===otherPartner.code)query.then=resolve=>resolve({data:{partner_id:otherPartner.customer_id}});
   if(name==='commerce_partners'&&value===otherPartner.customer_id)query.then=resolve=>resolve({data:otherPartner});
   return filter(column,value);
  };
  return query;
 };
 const conflict=await call({...data,coupon:otherPartner.code,action:'quote'},{cat,db:conflictDb,headers:{cookie}});
 assert.equal(conflict.res.code,400);
 const repeat=await call({...data,action:'quote'},{cat,db:dbMock({partner,existingReferral:{partner_id:partner.customer_id}}),headers:{cookie}});
 assert.equal(repeat.res.body.discount_cents,0);assert.equal(repeat.res.body.pricing.referral.first_order,false);
 const self=await call({...data,action:'quote'},{cat,db:dbMock({partner:{...partner,customer_id:uid}}),headers:{cookie}});
 assert.equal(self.res.body.discount_cents,0);assert.equal(self.res.body.pricing.referral,undefined);
});

test('an automatic partner discount respects the post-Crypto threshold and CAD uses the USD threshold',async()=>{
 const partner={customer_id:'c0000000-0000-4000-8000-000000000004',code:'LAB20',status:'active'};
 const cookie='ap_ref='+require('../lib/partner-program').cookieToken(partner.code,env.CHECKOUT_RATE_LIMIT_SECRET);
 const crypto={...method,native_provider:'polygon_usdc',rampex_provider:undefined};
 const db=dbMock({partner,paymentMethods:[crypto]});
 for(const [price,discount] of [[125,625],[150,3600]]){
  const cat=[{...catalog[0],variants:[{size:'5mg',price}]}];
  const q=await call({...body,action:'quote'},{cat,db,headers:{cookie}});
  assert.equal(q.res.code,200);assert.equal(q.res.body.discount_cents,discount);
  assert.equal(Boolean(q.res.body.automatic_partner_offer),price===150);
 }
 const interac={...method,kind:'interac',currency:'CAD',provider_key:'interac',native_provider:null,label:'Business e-Transfer'};
 const transferDb=dbMock({partner,paymentMethods:[interac]});
 const cat=[{...catalog[0],variants:[{size:'5mg',price:125}]}];
 const fx={fx_ppm:1400000,token:'fixture-fx'};
 const deps={interacFx:{resolve:async()=>fx}};
 const input={...body,address:{...body.address,country:'CA'}};
 const {res:q}=await call({...input,action:'quote'},{cat,db:transferDb,headers:{cookie},deps});
 assert.equal(q.code,200);assert.equal(q.body.discount_cents,3500);assert.equal(q.body.pricing.usd_basis.merchandise_cents,10000);
 const {res:place}=await call({...input,action:'place',quote:q.body.quote},{cat,db:transferDb,headers:{cookie},deps});
 assert.equal(place.code,201);const stored=transferDb.calls[0].args.p_data;
 const existing={id:stored.id,status:'accepted',checkout_version:stored.checkout_version,request_data:stored.request,request_digest:stored.digest,total_cents:stored.total_cents,currency:'CAD'};
 const replayDb=dbMock({existing,paymentMethods:[interac]});
 const {res:replay}=await call({...input,action:'place',quote:q.body.quote},{cat,db:replayDb,deps});
 assert.equal(replay.body.replayed,true);assert.equal(replay.body.total_cents,stored.total_cents);assert.equal(replayDb.calls.length,0);
});
