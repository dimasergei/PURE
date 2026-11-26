'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const gateway=require('../lib/native-gateway'),polygon=require('../lib/polygon-usdc'),guest=require('../lib/guest-checkout');
const id='e1000000-0000-4000-8000-000000000001',method='e1000000-0000-4000-8000-000000000002',attempt='e1000000-0000-4000-8000-000000000003';
const recipient='0x1111111111111111111111111111111111111111',payer='0x2222222222222222222222222222222222222222';
const env={SITE_URL:'https://getpurelabs.com',POLYGON_USDC_RECIPIENT:recipient,POLYGON_USDC_RPC_URL:'https://polygon-rpc.test',POLYGON_USDC_SECONDARY_RPC_URL:'https://polygon-second.test',POLYGON_USDC_ENABLED:'true',ADMIN_ORDERS_PASSWORD:'gateway-admin-fixture-with-at-least-32-characters'};
const invoice={id,method_id:method,customer_id:'customer-one',kind:'goods',status:'accepted',total_cents:11500,currency:'USD',expires_at:'2035-01-01T00:00:00Z',request_data:{address:{country:'CA'}}};
const account={method_id:method,provider:'polygon_usdc',mode:'live',account_tag:polygon.configuration(env).account_tag,countries:['US','CA'],polygon_recipient:recipient};
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
function request(body,admin=false){return{method:'POST',headers:{origin:env.SITE_URL,'content-type':'application/json',...(admin?{'x-admin-password':env.ADMIN_ORDERS_PASSWORD}:{authorization:'Bearer customer-session-fixture-with-32-characters'})},body:JSON.stringify(body)};}
function database({owner='customer-one',provider='polygon_usdc',order=invoice}={}){
 const calls=[];
 return{calls,auth:{getUser:async()=>({data:{user:{id:owner,email:'customer@example.test',email_confirmed_at:'2026-01-01'}}})},
  rpc:async(name,args)=>{calls.push({name,args});return{data:{id:args.p_data?.id||id}};},
  from(table){const filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},limit(){return q;},single:async()=>get(),maybeSingle:async()=>get(),then(resolve){return Promise.resolve(get()).then(resolve);}};
   function get(){
    if(table==='commerce_invoices')return{data:(!filters.id||filters.id===id)&&(!filters.customer_id||filters.customer_id===order.customer_id)?order:null};
    if(table==='commerce_gateway_accounts')return{data:{...account,provider}};
    if(table==='commerce_payment_methods')return{data:{id:method,active:true,native_provider:provider,currency:'USD',sale_scope:'goods'}};
    if(table==='commerce_gateway_attempts')return{data:[]};
    throw Error('Unexpected table '+table);
   }return q;
  }};
}
async function run(body,{admin=false,db=database(),overrideEnv={}}={}){const res=response();await gateway.handle(request(body,admin),res,new URLSearchParams({native:admin?'admin':'customer'}),{env:{...env,...overrideEnv},db,rateLimit:async()=>{},fetchImpl:async()=>{throw Error('No network in glue test');}});return{res,db};}
const pay={action:'pay',invoice_id:id,attempt_id:attempt,wallet_address:payer,confirm_amount_cents:11500,confirm_currency:'USD',consent:true};

test('Polygon readiness is a read-only redacted endpoint and accepts GET only',async()=>{
 const res=response(),db={from(){throw Error('Readiness must not access customer records');},rpc(){throw Error('Readiness must not mutate');}};
 await gateway.handle({method:'GET',headers:{}},res,new URLSearchParams({native:'polygon-usdc-readiness'}),{env:{},db});
 assert.equal(res.code,200);assert.equal(res.body.provider,'polygon_usdc');assert.equal(res.body.ready,false);assert.equal(res.body.configured,false);assert.ok(res.body.missing.includes('POLYGON_USDC_RECIPIENT'));assert.ok(!JSON.stringify(res.body).includes('rpc_url'));
 const post=response();await gateway.handle({method:'POST',headers:{}},post,new URLSearchParams({native:'polygon-usdc-readiness'}),{env:{},db});assert.equal(post.code,405);
});
test('owned wallet checkout enforces final amount, consent and attempt ID before starting an authorization',async t=>{
 let calls=0;t.mock.method(polygon,'start',async(db,i,a,c,b,u)=>{calls++;assert.equal(i.id,id);assert.equal(a.provider,'polygon_usdc');assert.equal(c.recipient,recipient);assert.equal(b.wallet_address,payer);assert.equal(u.id,invoice.customer_id);return{state:'awaiting_wallet',attempt_id:b.attempt_id};});
 for(const changed of [{confirm_amount_cents:11499},{confirm_currency:'CAD'},{consent:false},{attempt_id:'invalid'}]){const {res}=await run({...pay,...changed});assert.ok([400,409].includes(res.code));}
 assert.equal(calls,0);const {res}=await run(pay);assert.equal(res.code,200);assert.equal(res.body.state,'awaiting_wallet');assert.equal(calls,1);
});
test('another customer cannot view, start, or confirm this invoice',async t=>{
 let calls=0;t.mock.method(polygon,'start',async()=>{calls++;});t.mock.method(polygon,'confirm',async()=>{calls++;});t.mock.method(polygon,'customerState',async()=>{calls++;});
 for(const action of ['pay','confirm_crypto']){const {res}=await run({...pay,action},{db:database({owner:'customer-two'})});assert.equal(res.code,404);}
 const res=response();await gateway.handle({method:'GET',headers:{authorization:'Bearer customer-session-fixture-with-32-characters'}},res,new URLSearchParams({native:'customer',invoice:id}),{env,db:database({owner:'customer-two'})});assert.equal(res.code,404);assert.equal(calls,0);
});
test('confirmation stays available after new crypto collection is disabled; it cannot be used for card invoices',async t=>{
 let calls=0;t.mock.method(polygon,'confirm',async(db,i,a,c,b,u)=>{calls++;assert.equal(c.enabled,false);assert.equal(u.id,i.customer_id);assert.equal(b.attempt_id,attempt);return{state:'pending'};});
 const {res}=await run({...pay,action:'confirm_crypto'},{overrideEnv:{POLYGON_USDC_ENABLED:'false'}});assert.equal(res.code,200);assert.equal(res.body.state,'pending');assert.equal(calls,1);
 const other=await run({...pay,action:'confirm_crypto'},{db:database({provider:'rampex'})});assert.equal(other.res.code,400);assert.equal(calls,1);
 const disabled=await run(pay,{overrideEnv:{POLYGON_USDC_ENABLED:'false'}});assert.equal(disabled.res.code,503);
});
test('customer reload returns the stored wallet authorization without creating another attempt',async t=>{
 t.mock.method(polygon,'customerState',async(db,i,u)=>{assert.equal(i.id,id);assert.equal(u.id,invoice.customer_id);return{state:'pending',intent:{attempt_id:attempt}};});
 const db=database(),res=response();await gateway.handle({method:'GET',headers:{authorization:'Bearer customer-session-fixture-with-32-characters'}},res,new URLSearchParams({native:'customer',invoice:id}),{env,db});
 assert.equal(res.code,200);assert.equal(res.body.crypto.intent.attempt_id,attempt);assert.equal(res.body.gateway.provider,'polygon_usdc');assert.equal(res.body.gateway.ready,true);assert.equal(db.calls.length,0);assert.ok(!JSON.stringify(res.body.gateway).includes(recipient));
});
test('guest wallet handoff authorizes only the matching order and keeps customer details private',async t=>{
 const settings={...env,CHECKOUT_RATE_LIMIT_SECRET:'guest-wallet-fixture-secret'.repeat(2)},initial=response();
 const credential=guest.createCredential(id,initial,settings);credential.issue();
 const originalCookie=initial.headers['Set-Cookie'].split(';')[0];
 const order={...invoice,customer_id:credential.id,request_data:{checkout:{guest:true},address:{country:'CA'}}};
 const db=database({order});
 const start=t.mock.method(polygon,'start',async(_,i,a,c,b,u)=>{
  assert.equal(i.id,id);assert.equal(u.id,credential.id);
  return {state:'awaiting_wallet',attempt_id:b.attempt_id};
 });
 const confirm=t.mock.method(polygon,'confirm',async(_,i,a,c,b,u)=>{
  assert.equal(i.id,id);assert.equal(u.id,credential.id);
  return {state:'pending'};
 });
 t.mock.method(polygon,'customerState',async(_,i,u)=>{
  assert.equal(i.id,id);assert.equal(u.id,credential.id);
  return {state:'not_started'};
 });
 async function guestRequest(body,{cookie,origin=env.SITE_URL}={}){
  const req={method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})};
  const res=response();
  await gateway.handle(req,res,new URLSearchParams({native:'customer',invoice:id}),{env:settings,db,rateLimit:async()=>{}});
  return res;
 }
 const link={action:'guest_wallet_link',invoice_id:id};
 assert.equal((await guestRequest(link)).code,401);
 const issued=await guestRequest(link,{cookie:originalCookie});
 assert.equal(issued.code,200);
 const exchange={action:'guest_wallet_exchange',invoice_id:id,ticket:issued.body.ticket};
 assert.equal((await guestRequest(exchange,{origin:'https://other.example.test'})).code,403);
 assert.equal((await guestRequest({...exchange,invoice_id:method})).code,401);
 const invalidTicket=exchange.ticket.slice(0,-1)+(exchange.ticket.endsWith('a')?'b':'a');
 assert.equal((await guestRequest({...exchange,ticket:invalidTicket})).code,401);
 const realNow=Date.now(),oldClock=t.mock.method(Date,'now',()=>realNow-360000);
 const expiredTicket=require('../lib/guest-wallet-handoff').issue(id,credential.id,settings);
 oldClock.mock.restore();
 assert.equal((await guestRequest({...exchange,ticket:expiredTicket})).code,401);
 const redeemed=await guestRequest(exchange);
 assert.equal(redeemed.code,200);
 assert.match(redeemed.headers['Set-Cookie'],/Secure; HttpOnly; SameSite=Lax/);
 const cookie=redeemed.headers['Set-Cookie'].split(';')[0];
 const model=(await guestRequest(undefined,{cookie})).body;
 assert.equal(model.invoice.guest,true);
 assert.equal(model.gateway.provider,'polygon_usdc');
 assert.equal(model.customer,undefined);
 assert.equal((await guestRequest(pay)).code,401);
 assert.equal((await guestRequest({...pay,confirm_amount_cents:1},{cookie})).code,409);
 assert.equal((await guestRequest(pay,{cookie})).body.state,'awaiting_wallet');
 assert.equal((await guestRequest({...pay,action:'confirm_crypto'},{cookie})).body.state,'pending');
 assert.equal(start.mock.callCount(),1);
 assert.equal(confirm.mock.callCount(),1);
});
test('admin activation needs live token/finality readiness and derives the recipient from server configuration',async t=>{
 const body={action:'configure',provider:'polygon_usdc',id:method,version:0,active:true,currency:'USD',sale_scope:'goods',confirmed:true,label:'Crypto',payee:'PURE',approval_reference:'Owner-authorized recipient',countries:['US','CA'],polygon_recipient:payer,account_tag:'tampered',mode:'sandbox'};
 const mocked=t.mock.method(polygon,'readiness',async()=>({ready:false}));const blocked=await run(body,{admin:true});assert.equal(blocked.res.code,409);assert.equal(blocked.db.calls.length,0);
 mocked.mock.restore();t.mock.method(polygon,'readiness',async()=>({ready:true}));const accepted=await run(body,{admin:true});assert.equal(accepted.res.code,200);assert.equal(accepted.db.calls[0].name,'commerce_configure_polygon_usdc_gateway');const configured=accepted.db.calls[0].args.p_data;assert.equal(configured.polygon_recipient,recipient);assert.equal(configured.account_tag,account.account_tag);assert.equal(configured.mode,'live');
 for(const changed of [{currency:'CAD'},{sale_scope:'membership'}]){const invalid=await run({...body,...changed},{admin:true});assert.equal(invalid.res.code,400);assert.equal(invalid.db.calls.length,0);}
});
test('Polygon can retain all canonical shipping destinations without widening other providers',async t=>{
 const configured=require('../config/checkout.json').shipping_countries,unavailable=require('../config/shipping-zones.json').unavailable_countries;
 const countries=configured.filter(code=>!unavailable.includes(code));assert.equal(countries.length,243);assert.equal(new Set(countries).size,countries.length);
 const body={action:'configure',provider:'polygon_usdc',id:method,version:0,active:true,currency:'USD',sale_scope:'goods',confirmed:true,label:'Crypto',payee:'PURE',approval_reference:'Owner-authorized recipient',countries};
 t.mock.method(polygon,'readiness',async()=>({ready:true}));const accepted=await run(body,{admin:true});assert.equal(accepted.res.code,200);assert.deepEqual(accepted.db.calls[0].args.p_data.countries,countries);
 for(const bad of [['US','US'],['ZZ'],['RU'],['US',null],[],[...countries,'US']]){const rejected=await run({...body,countries:bad},{admin:true});assert.equal(rejected.res.code,400);assert.equal(rejected.db.calls.length,0);}
 const legacy=await run({...body,provider:'nmi',countries:countries.slice(0,61),active:false},{admin:true,overrideEnv:{NMI_MERCHANT_ID:'legacy-fixture',NMI_MODE:'live',NMI_CURRENCIES:'USD'}});assert.equal(legacy.res.code,400);assert.equal(legacy.db.calls.length,0);
});
