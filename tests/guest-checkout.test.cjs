'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,randomUUID}=require('node:crypto');
const checkout=require('../lib/direct-checkout');
const native=require('../lib/native-gateway');
const {configuration}=require('../lib/pure-gateway');
const {envelope}=require('../lib/invoice-notifications');
const config=require('../config/checkout.json');

const env={SITE_URL:'https://getpurelabs.com',VERCEL:'1',CHECKOUT_RATE_LIMIT_SECRET:'s'.repeat(40),
 PURE_GATEWAY_ENABLED:'true',PURE_GATEWAY_URL:'https://pay.example.test',PURE_GATEWAY_API_SECRET:'a'.repeat(40),
 PURE_GATEWAY_WEBHOOK_SECRET:'b'.repeat(40),PURE_GATEWAY_CURRENCIES:'USD'};
const method={id:randomUUID(),active:true,kind:'hosted_link',native_provider:'pure_gateway',version:1,currency:'USD',sale_scope:'goods',label:'Card'};
const interac={id:randomUUID(),active:true,kind:'interac',provider_key:'interac',version:1,currency:'CAD',sale_scope:'goods',label:'Interac'};
const account={method_id:method.id,provider:method.native_provider,mode:'live',account_tag:configuration(env).account_tag,countries:['US','CA']};
const customer={id:randomUUID(),email:'guest@example.test',email_confirmed_at:'2026-11-26'};
const catalog=[{id:'fixture',name:'Fixture',variants:[{size:'5mg',price:100}]}];
const paymentId='pi_guestFixture123456';
const orderNumber='P00001234';
const checkoutBody={guest:true,id:randomUUID(),kind:'goods',checkout_version:config.version,method_id:method.id,consent:true,research_use:true,
 name:'Guest Customer',email:' Guest@example.test ',items:[{id:'fixture',size:'5mg',qty:1,price:1}],coupon:' blackfriday10 ',
 address:{line1:'123 Fixture Street',city:'Fixture City',region:'NY',postal_code:'10001',country:'US'}};

function fixture(){
 const invoices=[],attempts=[],calls=[],requests=[],rates=[];
 const db={auth:{getUser:async token=>token==='account-token-fixture-01234'?{data:{user:customer}}:{error:true}},
  from(table){
   const available={commerce_invoices:invoices,commerce_gateway_attempts:attempts,commerce_payment_methods:[method,interac],
    commerce_gateway_accounts:[account],commerce_delivery_options:require('../config/delivery-options.json'),commerce_second_unit_variants:[]};
   assert.ok(Object.hasOwn(available,table),'Unexpected table '+table);
   const constraints=[];
   const select=()=>available[table].filter(row=>constraints.every(([key,value])=>row[key]===value));
   const query={select(){return query;},order(){return query;},limit(){return query;},eq(key,value){constraints.push([key,value]);return query;},
    then(resolve,reject){return Promise.resolve({data:select()}).then(resolve,reject);},
    maybeSingle:async()=>({data:select()[0]||null}),single:async()=>select()[0]?{data:select()[0]}:{error:{code:'PGRST116'}}};
   return query;
  },
  async rpc(name,args){
   calls.push({name,args});
   if(name==='commerce_place_checkout'){
    const order=args.p_data;
    invoices.push({...order,request_data:order.request,request_digest:order.digest,status:'accepted',
     public_order_number:orderNumber,expires_at:new Date(Date.now()+86400000).toISOString()});
    return {data:{id:order.id,status:'accepted'}};
   }
   if(name==='commerce_begin_gateway_attempt'){
    const invoice=invoices.find(row=>row.id===args.p_invoice&&row.customer_id===args.p_customer);
    assert.ok(invoice);
    const attempt={id:args.p_id,invoice_id:invoice.id,account_tag:account.account_tag,mode:account.mode,
     amount_cents:invoice.total_cents,currency:invoice.currency,provider:'pure_gateway',operation:'sale',state:'started'};
    attempts.push(attempt);
    return {data:{...attempt,claimed:true}};
   }
   if(name==='commerce_bind_pure_gateway_session'){
    const attempt=attempts.find(row=>row.id===args.p_id);
    Object.assign(attempt,{state:'redirected',provider_session_id:args.p_session,redirect_url:args.p_redirect});
    return {data:attempt};
   }
   if(name==='commerce_finish_gateway_attempt'){
    assert.equal(args.p_outcome,'approved');
    const attempt=attempts.find(row=>row.id===args.p_id);
    attempt.state='paid';
    invoices.find(row=>row.id===attempt.invoice_id).status='paid';
    return {data:{state:'paid'}};
   }
   throw Error('Unexpected RPC '+name);
  }};
 const deps={env,db,catalog,rateLimit:async(_db,key)=>rates.push(key),fetchImpl:async(url,opts)=>{
  requests.push({url,body:JSON.parse(opts.body)});
  const invoice=invoices[0];
  const value=url.endsWith('/create')?{paymentIntentId:paymentId,payUrl:env.PURE_GATEWAY_URL+'/pay?pi='+paymentId}:
   {status:'succeeded',paymentIntentId:paymentId,amount:invoice.total_cents,currency:'usd',livemode:true,amountRefunded:0,
    chargeId:'ch_guestFixture123456',paidAt:'2026-11-26T01:00:00.000Z',metadata:{orderId:invoice.id,orderNumber}};
  return {ok:true,json:async()=>value};
 }};
 return {deps,calls,requests,rates,invoices};
}

async function call(handler,params,deps,body,headers={}){
 const req={method:body===undefined?'GET':'POST',headers:{origin:env.SITE_URL,'content-type':'application/json',
  'x-forwarded-for':'192.0.2.10',...headers}};
 if(body!==undefined)req.body=handler===native.handle?JSON.stringify(body):body;
 const res={headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
 await handler(req,res,new URLSearchParams(params),deps);
 return res;
}

test('guest quote, exact-order cookie and provider-verified payment work without a customer account',async()=>{
 const f=fixture();
 const run=(body,headers)=>call(checkout.handle,'checkout=customer',f.deps,body,headers);
 const configResponse=await call(checkout.handle,'checkout=public',f.deps);
 assert.deepEqual(configResponse.data.guest_methods,[method.id]);
 const preview=await call(checkout.handle,'checkout=cart',f.deps,{...checkoutBody,country:'US'});
 const quote=await run({...checkoutBody,action:'quote'});
 assert.equal(quote.code,200);
 assert.equal(quote.data.total_cents,9795);
 assert.deepEqual(preview.data.pricing,quote.data.pricing);
 assert.equal(quote.data.earned_points,0);
 assert.equal(quote.headers['Cache-Control'],'no-store');
 assert.match(quote.headers['Set-Cookie'],/Max-Age=7200; Path=\/; Secure; HttpOnly; SameSite=Lax/);
 const cookie=quote.headers['Set-Cookie'].split(';')[0];
 const place={...checkoutBody,action:'place',quote:quote.data.quote};
 assert.equal((await run(place)).code,401);
 assert.equal((await run({...place,email:'another@example.test'},{cookie})).code,409);
 assert.equal((await run(place,{cookie})).code,201);
 assert.equal((await run(place,{cookie})).data.replayed,true);
 assert.equal((await run({...checkoutBody,action:'quote'})).code,409);
 assert.equal(f.invoices.length,1);
 assert.equal(f.invoices[0].customer_email,customer.email);
 assert.notEqual(f.invoices[0].customer_id,customer.id);
 assert.equal(f.invoices[0].request_data.checkout.guest,true);
 assert.ok(f.rates.includes('guest-checkout-ip:quote:192.0.2.10'));
 assert.ok(f.rates.includes('guest-checkout-email:place:guest@example.test'));

 const invoice=checkoutBody.id,nativeUrl='native=customer&invoice='+invoice;
 const pay=(params,body,headers)=>call(native.handle,params,f.deps,body,headers);
 assert.equal((await pay(nativeUrl)).code,401);
 assert.equal((await pay(nativeUrl,undefined,{cookie,authorization:'Bearer account-token-fixture-01234'})).code,404);
 assert.equal((await pay('native=customer&invoice='+randomUUID(),undefined,{cookie})).code,401);
 assert.equal((await pay(nativeUrl,undefined,{cookie:cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a')})).code,401);
 const identity=cookie.split('=')[1].split('.')[0];
 const expired=1000000000;
 const expiredSignature=createHmac('sha256',env.CHECKOUT_RATE_LIMIT_SECRET).update(`pure-guest-invoice-v1\n${invoice}\n${identity}\n${expired}`).digest('base64url');
 assert.equal((await pay(nativeUrl,undefined,{cookie:cookie.split('=')[0]+'='+identity+'.'+expired+'.'+expiredSignature})).code,401);
 const info=await pay(nativeUrl,undefined,{cookie});
 assert.equal(info.code,200);
 assert.equal(info.data.invoice.guest,true);
 assert.equal(info.data.invoice.order_number,orderNumber);
 assert.equal(info.data.gateway.origin,env.PURE_GATEWAY_URL);
 const payment={action:'pay',invoice_id:invoice,attempt_id:randomUUID(),consent:true,redirect_notice_ack:true,
  confirm_amount_cents:quote.data.total_cents,confirm_currency:'USD'};
 assert.equal((await pay('native=customer',payment,{cookie,origin:'https://wrong.example.test'})).code,403);
 assert.equal((await pay('native=customer',{...payment,invoice_id:randomUUID()},{cookie})).code,401);
 assert.equal((await pay('native=customer',{...payment,confirm_amount_cents:1},{cookie})).code,409);
 assert.equal(f.requests.length,0);
 const start=await pay('native=customer',payment,{cookie});
 assert.equal(start.data.redirect_url,env.PURE_GATEWAY_URL+'/pay?pi='+paymentId);
 assert.deepEqual(f.requests[0].body,{orderId:invoice,orderNumber,amountCents:quote.data.total_cents,currency:'usd',returnUrl:env.SITE_URL+'/pay.html?invoice='+invoice});
 const returned=await pay('native=customer',{action:'confirm_card',invoice_id:invoice},{cookie});
 assert.equal(returned.code,200);
 assert.equal(returned.data.confirmed,true);
 assert.equal((await pay(nativeUrl,undefined,{cookie})).data.invoice.status,'paid');
 assert.equal((await pay('native=customer',{action:'refund',invoice_id:invoice},{cookie})).code,400);
});

test('guest checkout rejects account-only benefits and never issues a credential for an invalid purchase',async()=>{
 const f=fixture();
 for(const [change,status] of [[{email:'bad'},400],[{method_id:interac.id,address:{...checkoutBody.address,country:'CA'}},409],
  [{points:100},403],[{credit_cents:200},403],[{bulk_order:true},403],[{coupon:'CARDTEST'},403],
  [{coupon:'AP-ABCDEFGH2345'},403],[{membership_addon:{plan:'vip',period:'monthly'}},403],[{research_builder_mode:'member_stack'},403]]){
  const response=await call(checkout.handle,'checkout=customer',f.deps,{...checkoutBody,action:'quote',...change});
  assert.equal(response.code,status,JSON.stringify(change));
  assert.equal(response.headers['Set-Cookie'],undefined);
 }
 assert.equal(f.calls.length,0);
});

test('Canadian guest checkout uses its destination-specific shipping quote and collects Card in USD',async()=>{
 const f=fixture();
 const body={...checkoutBody,delivery:{shipping:'standard',extras:[]},address:{line1:'123 Fixture Street',city:'Waterloo',region:'ON',postal_code:'N2L 1A1',country:'CA'}};
 const preview=await call(checkout.handle,'checkout=cart',f.deps,{...body,country:'CA'});
 const quote=await call(checkout.handle,'checkout=customer',f.deps,{...body,action:'quote'});
 assert.equal(quote.code,200);
 assert.equal(quote.data.currency,'USD');
 assert.equal(quote.data.shipping_cents,2495);
 assert.deepEqual(quote.data.pricing,preview.data.pricing);
 const cookie=quote.headers['Set-Cookie'].split(';')[0];
 assert.equal((await call(checkout.handle,'checkout=customer',f.deps,{...body,action:'place',quote:quote.data.quote},{cookie})).code,201);
});

test('guest receipts include order updates without sending customers to account purchases',()=>{
 const order={snapshot:{id:checkoutBody.id,kind:'goods',public_order_number:orderNumber,checkout_version:config.version,currency:'USD',customer_email:'guest@example.test',total_cents:9795,status:'accepted'},
  detail:{request_data:{checkout:{guest:true}}},audience:'customer',event_action:'checkout_placed'};
 const emailEnv={ORDER_CONFIRMATION_FROM:'orders@fixture.test'};
 const notice=envelope(order,emailEnv);
 assert.match(notice.text,/browser you used at checkout/);
 assert.match(notice.text,/pay\.html\?guest=1&invoice=/);
 const receipt=envelope({...order,snapshot:{...order.snapshot,status:'paid'},event_action:'payment_recorded'},emailEnv);
 assert.match(receipt.text,/guest@example.test/);
 assert.doesNotMatch(receipt.text,/account\/purchases|pay\.html/);
});
