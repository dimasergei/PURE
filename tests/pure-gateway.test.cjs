'use strict';
// Card route on the owner-operated Get Pure Skin payment page (Stripe). No network, no real provider, no database.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const gw=require('../lib/pure-gateway'),flow=require('../lib/pure-gateway-payments'),g=require('../lib/native-gateway'),cfg=require('../lib/gateway-config');
const policy=require('../lib/pure-payment-policy');
const env={PURE_GATEWAY_ENABLED:'true',PURE_GATEWAY_URL:'https://pay.example.test',PURE_GATEWAY_API_SECRET:'a'.repeat(40),PURE_GATEWAY_WEBHOOK_SECRET:'b'.repeat(40),
 PURE_GATEWAY_CURRENCIES:'USD',SITE_URL:'https://getpurelabs.com',CHECKOUT_RATE_LIMIT_SECRET:'x'.repeat(40)};
const config=gw.configuration(env);
const attempt={id:'91000000-0000-4000-8000-000000000001',invoice_id:'91000000-0000-4000-8000-000000000002',provider:'pure_gateway',operation:'sale',mode:'live',
 account_tag:config.account_tag,amount_cents:12995,currency:'USD',state:'redirected',provider_session_id:'pi_fixture123456',redirect_url:'https://pay.example.test/pay?pi=pi_fixture123456'};
const paid={status:'succeeded',amount:12995,currency:'usd',livemode:true,chargeId:'ch_3FixtureCharge01',paidAt:'2026-11-25T01:00:00.000Z',amountRefunded:0,
 metadata:{orderId:attempt.invoice_id,orderNumber:null}};
const reply=data=>async()=>({ok:true,status:200,json:async()=>data});
function signed(body,{secret=env.PURE_GATEWAY_WEBHOOK_SECRET,stamp=Math.floor(Date.now()/1000)}={}){
 const raw=Buffer.from(JSON.stringify(body));
 return{raw,header:'t='+stamp+',v1='+crypto.createHmac('sha256',secret).update(stamp+'.').update(raw).digest('hex')};
}
const ping={orderId:attempt.invoice_id,paymentIntentId:attempt.provider_session_id,eventType:'succeeded'};
const confirmation=(payment=paid)=>({...ping,payment});
// A chainable table stand-in: every filter returns itself and the chain resolves to the rows.
function table(rows){const t={select:()=>t,eq:()=>t,neq:()=>t,order:()=>t,limit:()=>t,
 single:async()=>({data:rows[0]}),maybeSingle:async()=>({data:rows[0]??null}),then:(ok,no)=>Promise.resolve({data:rows}).then(ok,no)};return t;}
function dbMock({attempts=[attempt],invoices=[],accounts=[],methods=[],begin,bind}={}){
 const calls=[];
 return{calls,auth:{getUser:async()=>({data:{user:{id:'92000000-0000-4000-8000-000000000003',email:'buyer@example.test',email_confirmed_at:'2026-11-25'}}})},
  from:name=>table({commerce_gateway_attempts:attempts,commerce_invoices:invoices,commerce_gateway_accounts:accounts,commerce_payment_methods:methods}[name]||[]),
  async rpc(name,args){calls.push({name,args});
   if(name==='commerce_begin_gateway_attempt')return begin?begin(args):{data:{...attempt,state:'started',provider_session_id:null,claimed:true}};
   if(name==='commerce_bind_pure_gateway_session')return bind?bind(args):{data:{id:args.p_id,state:'redirected'}};
   return{data:{state:args.p_outcome==='approved'?'paid':args.p_outcome==='declined'?'declined':args.p_outcome==='review'?'review':'unknown',invoice_status:'accepted'}};}};
}
const finisher=calls=>async(db,att,key,result)=>{const r=await db.rpc('commerce_finish_gateway_attempt',{p_id:att.id,p_event:key,p_outcome:result.outcome,p_transaction:result.transaction||null,p_amount:result.amount??null,p_currency:result.currency||null,p_redirect:null,p_error:result.error||null});calls.push(key);return r.data;};

test('configuration needs every setting and never activates from credentials alone',()=>{
 assert.equal(gw.configuration({}).ready,false);
 assert.equal(config.ready,true);assert.equal(config.mode,'live');assert.equal(config.origin,'https://pay.example.test');assert.match(config.account_tag,/^[a-f0-9]{64}$/);
 for(const delta of [{PURE_GATEWAY_ENABLED:'false'},{PURE_GATEWAY_URL:''},{PURE_GATEWAY_URL:'http://pay.example.test'},{PURE_GATEWAY_URL:'https://pay.example.test/path'},
  {PURE_GATEWAY_URL:'https://user:pw@pay.example.test'},{PURE_GATEWAY_API_SECRET:'short'},{PURE_GATEWAY_WEBHOOK_SECRET:''},{PURE_GATEWAY_WEBHOOK_SECRET:'a'.repeat(40)},{PURE_GATEWAY_CURRENCIES:'CAD'}])
  assert.equal(gw.configuration({...env,...delta}).ready,false,JSON.stringify(delta));
 assert.equal(JSON.stringify(cfg.publicStatus(env)).includes('a'.repeat(40)),false,'secrets are never reported');
 assert.ok(cfg.publicStatus(env).some(x=>x.provider==='pure_gateway'));
});
test('the on/off switch: the route can be registered while off, and only the switch shows or hides it',()=>{
 const off={...env,PURE_GATEWAY_ENABLED:'false'},none={...env};delete none.PURE_GATEWAY_ENABLED;
 for(const e of [off,none]){const c=gw.configuration(e);assert.equal(c.ready,false);assert.equal(c.enabled,false);assert.equal(c.mode,'live');assert.equal(c.account_tag,config.account_tag,'same identity on or off');}
 assert.equal(gw.configuration({...env,PURE_GATEWAY_ENABLED:'TRUE'}).ready,false,'only the exact value true turns it on');
 assert.equal(gw.configuration({...env,PURE_GATEWAY_ENABLED:'true'}).ready,true);
});
test('loopback http is for development only and test payments can never be enabled in production',()=>{
 const local={...env,PURE_GATEWAY_URL:'http://localhost:3100'};
 assert.equal(gw.configuration(local).ready,true);
 assert.notEqual(gw.configuration(local).account_tag,config.account_tag,'a development route can never be used in production');
 assert.equal(gw.configuration({...local,VERCEL_ENV:'production'}).ready,false);
 assert.equal(gw.configuration({...env,PURE_GATEWAY_ALLOW_TEST_PAYMENTS:'true'}).test_payments,true);
 const prod=gw.configuration({...env,PURE_GATEWAY_ALLOW_TEST_PAYMENTS:'true',VERCEL_ENV:'production'});
 assert.equal(prod.ready,false);assert.equal(prod.test_payments,false);
});
test('opening a payment sends the server-priced amount and an exact return address, nothing about the customer',async()=>{
 let sent;
 const out=await gw.create(attempt,{public_order_number:'P00000123',customer_email:'buyer@example.test'},env,async(url,opts)=>{sent={url,opts,body:JSON.parse(opts.body)};
  return{ok:true,status:200,json:async()=>({paymentIntentId:'pi_fixture123456',payUrl:'https://pay.example.test/pay?pi=pi_fixture123456'})};});
 assert.equal(out.id,'pi_fixture123456');assert.equal(out.url,'https://pay.example.test/pay?pi=pi_fixture123456');
 assert.equal(sent.url,'https://pay.example.test/api/payments/create');
 assert.equal(sent.opts.headers.Authorization,'Bearer '+env.PURE_GATEWAY_API_SECRET);
 assert.deepEqual(sent.body,{orderId:attempt.invoice_id,orderNumber:'P00000123',amountCents:12995,currency:'usd',returnUrl:'https://getpurelabs.com/pay.html?invoice='+attempt.invoice_id});
 assert.equal(JSON.stringify(sent.body).includes('buyer@example.test'),false);
 await assert.rejects(gw.create({...attempt,amount_cents:10},{},env,reply({})),e=>e.status===400);
 await assert.rejects(gw.create({...attempt,currency:'CAD'},{},env,reply({})),e=>e.status===400);
});
test('a payment page answer that is not exactly this payment’s own address is refused',async()=>{
 const good={paymentIntentId:'pi_fixture123456',payUrl:'https://pay.example.test/pay?pi=pi_fixture123456'};
 for(const delta of [{payUrl:'https://evil.example/pay?pi=pi_fixture123456'},{payUrl:'https://pay.example.test.evil.example/pay?pi=pi_fixture123456'},{payUrl:'https://pay.example.test/other?pi=pi_fixture123456'},
  {payUrl:'https://pay.example.test/pay?pi=pi_other0000001'},{payUrl:'https://pay.example.test/pay?pi=pi_fixture123456&next=https://evil.example'},{payUrl:'https://pay.example.test/pay?pi=pi_fixture123456#x'},
  {payUrl:'https://u:p@pay.example.test/pay?pi=pi_fixture123456'},{payUrl:'javascript:alert(1)'},{paymentIntentId:'../etc'},{paymentIntentId:undefined}])
  await assert.rejects(gw.create(attempt,{},env,reply({...good,...delta})),e=>e.status===502,JSON.stringify(delta));
 await assert.rejects(gw.create(attempt,{},env,async()=>{throw Error('network');}),e=>e.status===502);
 await assert.rejects(gw.create(attempt,{},env,async()=>({ok:false,status:500,json:async()=>({})})),e=>e.status===502);
});
test('signed pings need the exact bytes, a fresh time and the shared secret',()=>{
 const {raw,header}=signed(ping);
 assert.deepEqual(gw.verifyPing(raw,header,env),ping);
 for(const bad of [header.replace('v1=','v1=0'),header.replace(/t=\d+/,'t=1'),signed(ping,{secret:'c'.repeat(40)}).header,'',undefined,header+',x=1'])
  assert.throws(()=>gw.verifyPing(raw,bad,env),e=>e.status===401,String(bad));
 assert.throws(()=>gw.verifyPing(Buffer.from(raw+' '),header,env),e=>e.status===401);
 assert.throws(()=>gw.verifyPing(raw,header,{...env,PURE_GATEWAY_WEBHOOK_SECRET:''}),e=>e.status===503);
 for(const body of [{...ping,orderId:'nope'},{...ping,paymentIntentId:'x'},{...ping,eventType:'paid'},[],'x']){const s=signed(body);assert.throws(()=>gw.verifyPing(s.raw,s.header,env),e=>e.status===400);}
});
test('only an exact, fully matching succeeded payment is approved',()=>{
 assert.deepEqual(gw.result(paid,attempt,env),{outcome:'approved',transaction:'ch_3FixtureCharge01',amount:12995,currency:'USD'});
 for(const delta of [{amount:12994},{currency:'cad'},{metadata:{...paid.metadata,orderId:'91000000-0000-4000-8000-0000000000ff'}},{metadata:{...paid.metadata,orderId:attempt.id}},{metadata:{orderNumber:'P1'}},{metadata:null},
  {chargeId:'fake'},{chargeId:null},{paidAt:null},{livemode:false},{livemode:undefined},{amountRefunded:100},{amountRefunded:undefined},{status:'requires_capture'},{status:'weird'}])
  assert.equal(gw.result({...paid,...delta},attempt,env).outcome,'review',JSON.stringify(delta));
 assert.equal(gw.result(paid,{...attempt,provider_session_id:null},env).outcome,'review');
 for(const status of ['requires_payment_method','requires_confirmation','requires_action','processing'])assert.deepEqual(gw.result({...paid,status,chargeId:null,paidAt:null},attempt,env),{outcome:'unknown',error:'pure_gateway_pending'});
 assert.deepEqual(gw.result({...paid,status:'canceled',chargeId:null,paidAt:null},attempt,env),{outcome:'declined',error:'pure_gateway_canceled'});
});
test('a Stripe test-mode payment settles a development database only',()=>{
 const test_={...paid,livemode:false};
 assert.equal(gw.result(test_,attempt,env).error,'pure_gateway_test_payment');
 assert.equal(gw.result(test_,attempt,{...env,PURE_GATEWAY_ALLOW_TEST_PAYMENTS:'true'}).outcome,'approved');
 assert.equal(gw.result(test_,attempt,{...env,PURE_GATEWAY_ALLOW_TEST_PAYMENTS:'true',VERCEL_ENV:'production'}).error,'pure_gateway_test_payment');
});
test('a message without facts makes PURE ask the payment page, and nothing is recorded from the message itself',async()=>{
 const {raw,header}=signed(ping),req={headers:{'x-pure-gateway-signature':header}};
 for(const [data,expect]of [[{...paid,status:'processing',chargeId:null,paidAt:null},'retry'],[{...paid,amount:1},'review'],[paid,'paid']]){
  const db=dbMock(),keys=[];let reads=0;
  const run=()=>flow.event(db,raw,req,env,async(url,opts)=>{reads++;assert.equal(url,'https://pay.example.test/api/payments/status');assert.deepEqual(JSON.parse(opts.body),{paymentIntentId:'pi_fixture123456'});return{ok:true,status:200,json:async()=>data};},{finish:finisher(keys)});
  if(expect==='retry'){await assert.rejects(run,e=>e.status===503);assert.equal(db.calls.length,0);}
  else{const out=await run();assert.equal(out.live_payment_applied,expect==='paid');assert.equal(db.calls[0].args.p_outcome,expect==='paid'?'approved':'review');if(expect==='paid')assert.equal(db.calls[0].args.p_transaction,'ch_3FixtureCharge01');}
  assert.equal(reads,1);
 }
});
test('the payment page is responsible for the confirmation: a signed message with facts is checked against the order record and recorded without calling back',async()=>{
 const never=async()=>{throw Error('PURE must not call the payment page for a signed confirmation');};
 const send=(payment,extra={})=>{const s=signed({...confirmation(payment),...extra});return{raw:s.raw,req:{headers:{'x-pure-gateway-signature':s.header}}};};
 let db=dbMock(),s=send(paid);
 let out=await flow.event(db,s.raw,s.req,env,never,{finish:finisher([])});
 assert.equal(out.live_payment_applied,true);assert.equal(db.calls.length,1);
 assert.deepEqual([db.calls[0].args.p_outcome,db.calls[0].args.p_transaction,db.calls[0].args.p_amount,db.calls[0].args.p_currency],['approved','ch_3FixtureCharge01',12995,'USD']);
 assert.equal(db.calls[0].args.p_event,'pure-gateway-paid:pi_fixture123456');
 // facts that do not match PURE's own record are never accepted as a payment
 for(const [name,facts,error]of [['amount',{...paid,amount:100},'pure_gateway_amount_currency_mismatch'],['currency',{...paid,currency:'cad'},'pure_gateway_amount_currency_mismatch'],
  ['another invoice',{...paid,metadata:{...paid.metadata,orderId:'91000000-0000-4000-8000-0000000000ee'}},'pure_gateway_order_mismatch'],['test-mode charge',{...paid,livemode:false},'pure_gateway_test_payment'],
  ['already refunded',{...paid,amountRefunded:12995},'pure_gateway_refund_review'],['no charge',{...paid,chargeId:null},'pure_gateway_settlement_unconfirmed'],['unknown status',{...paid,status:'weird'},'pure_gateway_status_unrecognised']]){
  db=dbMock();s=send(facts);out=await flow.event(db,s.raw,s.req,env,never,{finish:finisher([])});
  assert.equal(out.live_payment_applied,false,name);assert.equal(db.calls[0].args.p_outcome,'review',name);assert.equal(db.calls[0].args.p_error,error,name);
 }
 // not final yet: tell the payment page to deliver again; a cancelled payment is declined
 db=dbMock();s=send({...paid,status:'processing',chargeId:null,paidAt:null});
 await assert.rejects(flow.event(db,s.raw,s.req,env,never,{finish:finisher([])}),e=>e.status===503);assert.equal(db.calls.length,0);
 db=dbMock();s=send({...paid,status:'canceled',chargeId:null,paidAt:null});out=await flow.event(db,s.raw,s.req,env,never,{finish:finisher([])});
 assert.equal(db.calls[0].args.p_outcome,'declined');
 // a message that names the right invoice but a payment that is not the one bound to the attempt
 db=dbMock();s=send(paid,{paymentIntentId:'pi_otherPayment0001'});
 await assert.rejects(flow.event(db,s.raw,s.req,env,never,{finish:finisher([])}),e=>e.status===409);assert.equal(db.calls.length,0);
 // the facts are not trusted without the signature
 const forged=signed(confirmation(paid),{secret:'c'.repeat(40)});
 await assert.rejects(flow.event(dbMock(),forged.raw,{headers:{'x-pure-gateway-signature':forged.header}},env,never,{finish:finisher([])}),e=>e.status===401);
 const tampered=signed(confirmation({...paid,amount:12000}));
 await assert.rejects(flow.event(dbMock(),Buffer.from(tampered.raw.toString().replace('12000','12995')),{headers:{'x-pure-gateway-signature':tampered.header}},env,never,{finish:finisher([])}),e=>e.status===401);
 // an invoice with an earlier cancelled attempt: the message is matched to the attempt that owns the payment
 db=dbMock({attempts:[{...attempt,id:'91000000-0000-4000-8000-0000000000aa',provider_session_id:'pi_newer1234567',state:'redirected'},{...attempt,state:'declined'}]});
 s=send(paid,{paymentIntentId:'pi_fixture123456'});out=await flow.event(db,s.raw,s.req,env,never,{finish:finisher([])});
 assert.equal(db.calls[0].args.p_id,attempt.id);
});
test('pings for unknown orders, other payments, failed payments or an unconfigured route record nothing',async()=>{
 const sign=body=>{const s=signed(body);return{raw:s.raw,req:{headers:{'x-pure-gateway-signature':s.header}}};};
 const never=async()=>{throw Error('must not read the provider');};
 let s=sign({...ping,eventType:'failed'});let db=dbMock();
 assert.equal((await flow.event(db,s.raw,s.req,env,never,{finish:finisher([])})).ignored,true);assert.equal(db.calls.length,0);
 s=sign(ping);db=dbMock({attempts:[]});
 assert.equal((await flow.event(db,s.raw,s.req,env,never,{finish:finisher([])})).unmatched,true);assert.equal(db.calls.length,0);
 db=dbMock({attempts:[{...attempt,provider_session_id:null}]});
 await assert.rejects(flow.event(db,s.raw,s.req,env,never,{finish:finisher([])}),e=>e.status===503);
 db=dbMock({attempts:[{...attempt,provider_session_id:'pi_somethingelse1'}]});
 await assert.rejects(flow.event(db,s.raw,s.req,env,never,{finish:finisher([])}),e=>e.status===409);
 db=dbMock({attempts:[{...attempt,account_tag:'f'.repeat(64)}]});
 await assert.rejects(flow.event(db,s.raw,s.req,env,never,{finish:finisher([])}),e=>e.status===503);
 await assert.rejects(flow.event(dbMock(),s.raw,s.req,{...env,PURE_GATEWAY_ENABLED:'false'},never,{finish:finisher([])}),e=>e.status===503);
 await assert.rejects(flow.event(dbMock(),s.raw,{headers:{'x-pure-gateway-signature':'t=1,v1='+'0'.repeat(64)}},env,never,{finish:finisher([])}),e=>e.status===401);
 assert.equal(db.calls.length,0);
});
test('a refund reported by the provider is flagged for review and never changes a paid order automatically',async()=>{
 const {raw,header}=signed({...ping,eventType:'refunded'}),db=dbMock({attempts:[{...attempt,state:'paid'}]});
 const out=await flow.event(db,raw,{headers:{'x-pure-gateway-signature':header}},env,reply({...paid,amountRefunded:12995}),{finish:finisher([])});
 assert.equal(db.calls.length,1);assert.equal(db.calls[0].args.p_outcome,'review');assert.equal(db.calls[0].args.p_error,'pure_gateway_refund_review');
 assert.equal(out.live_payment_applied,false);
 // the same refund delivered by the payment page with its facts needs no call back
 const viaPage=signed({...ping,eventType:'refunded',payment:{...paid,amountRefunded:12995}}),db2=dbMock({attempts:[{...attempt,state:'paid'}]});
 await flow.event(db2,viaPage.raw,{headers:{'x-pure-gateway-signature':viaPage.header}},env,async()=>{throw Error('no call back');},{finish:finisher([])});
 assert.equal(db2.calls[0].args.p_error,'pure_gateway_refund_review');
});
const invoice={id:attempt.invoice_id,kind:'goods',status:'accepted',currency:'USD',total_cents:12995,expires_at:new Date(Date.now()+3600000).toISOString(),public_order_number:'P00000123'};
const account={provider:'pure_gateway',mode:'live',account_tag:config.account_tag,countries:['US'],method:{active:true}};
const body={attempt_id:attempt.id,confirm_amount_cents:12995,confirm_currency:'USD',consent:true,redirect_notice_ack:true};
const created=async()=>({ok:true,status:200,json:async()=>({paymentIntentId:'pi_fixture123456',payUrl:'https://pay.example.test/pay?pi=pi_fixture123456'})});
test('starting a payment needs the notice acknowledged, opens one PaymentIntent and binds it before redirecting',async()=>{
 const db=dbMock(),limited=[];
 await assert.rejects(flow.start(db,invoice,account,config,{...body,redirect_notice_ack:false},{id:'u1'},env,created,async()=>{}),e=>e.status===400);
 await assert.rejects(flow.start(db,{...invoice,kind:'membership'},account,config,body,{id:'u1'},env,created,async()=>{}),e=>e.status===409);
 await assert.rejects(flow.start(db,invoice,account,{...config,ready:false},body,{id:'u1'},env,created,async()=>{}),e=>e.status===503);
 assert.equal(db.calls.length,0,'nothing is recorded before the checks pass');
 const out=await flow.start(db,invoice,account,config,body,{id:'u1'},env,created,async(_d,key)=>limited.push(key));
 assert.equal(out.redirect_url,'https://pay.example.test/pay?pi=pi_fixture123456');assert.equal(out.state,'redirected');
 assert.deepEqual(db.calls.map(c=>c.name),['commerce_begin_gateway_attempt','commerce_bind_pure_gateway_session']);
 assert.equal(db.calls[1].args.p_session,'pi_fixture123456');assert.equal(db.calls[1].args.p_account_tag,config.account_tag);assert.deepEqual(limited,['native-payment:u1']);
});
test('a repeated submission never opens a second payment and an uncertain result is kept, not retried',async()=>{
 let calls=0;
 const again=dbMock({begin:()=>({data:{...attempt,claimed:false}})});
 const out=await flow.start(again,invoice,account,config,body,{id:'u1'},env,async()=>{calls++;return created();},async()=>{});
 assert.equal(out.already_started,true);assert.equal(out.redirect_url,attempt.redirect_url);assert.equal(calls,0);
 const down=dbMock();
 const lost=await flow.start(down,invoice,account,config,body,{id:'u1'},env,async()=>{throw Error('timeout');},async()=>{});
 assert.equal(lost.state,'unknown');assert.equal(lost.redirect_url,null);
 assert.equal(down.calls.at(-1).args.p_outcome,'unknown');assert.equal(down.calls.at(-1).args.p_error,'pure_gateway_session_uncertain');
 const unbound=dbMock({bind:()=>({error:{code:'XX000'}})});
 assert.equal((await flow.start(unbound,invoice,account,config,body,{id:'u1'},env,created,async()=>{})).state,'unknown');
});
test('reconciling an unbound attempt re-asks for the same payment instead of opening another path to charge',async()=>{
 const stuck={...attempt,state:'unknown',provider_session_id:null,redirect_url:null},db=dbMock({attempts:[stuck]}),seen=[];
 const fetchImpl=async(url,opts)=>{seen.push(url);return url.endsWith('/create')?created():{ok:true,status:200,json:async()=>paid};};
 const out=await flow.settle(db,stuck,env,fetchImpl,{finish:finisher([]),invoice,recover:true});
 assert.deepEqual(seen,['https://pay.example.test/api/payments/create','https://pay.example.test/api/payments/status']);
 assert.equal(out.confirmed,true);assert.equal(db.calls[0].name,'commerce_bind_pure_gateway_session');
 const idle=await flow.settle(dbMock(),stuck,env,never=>{throw Error('no network without recover');},{finish:finisher([])});
 assert.equal(idle.pending,true);
});
test('the customer’s return only asks the server to re-check; the answer comes from the provider',async()=>{
 const db=dbMock({invoices:[invoice],accounts:[{...account,method_id:'m1'}],methods:[{id:'m1',active:true}]});
 const req=extra=>({method:'POST',headers:{authorization:'Bearer '+'t'.repeat(40),origin:'https://getpurelabs.com','content-type':'application/json'},body:Buffer.from(JSON.stringify({action:'confirm_card',invoice_id:invoice.id,...extra}))});
 const run=async(r,data,deps={})=>{const res={code:null,out:null,setHeader(){},status(c){this.code=c;return this;},json(o){this.out=o;return this;}};
  await g.handle(r,res,new URLSearchParams('native=customer&invoice='+invoice.id),{env,db,fetchImpl:reply(data),rateLimit:async()=>{},...deps});return res;};
 let res=await run(req(),paid);
 assert.equal(res.code,200);assert.deepEqual(res.out,{state:'paid',confirmed:true,pending:false});
 assert.equal(db.calls.at(-1).args.p_outcome,'approved');
 const before=db.calls.length;
 res=await run(req(),{...paid,status:'requires_payment_method',chargeId:null,paidAt:null});
 assert.equal(res.code,200);assert.equal(res.out.pending,true);assert.equal(res.out.confirmed,false);assert.equal(db.calls.length,before,'a pending payment writes nothing');
 res=await run(req({redirect_status:'succeeded',payment_intent:'pi_fixture123456'}),{...paid,amount:1});
 assert.equal(res.out.state,'review','a query string claiming success cannot override the provider');
 const other=dbMock({invoices:[invoice],accounts:[{provider:'nmi',mode:'live',account_tag:'z',countries:['US'],method_id:'m1'}],methods:[{id:'m1',active:true}]});
 res=await run(req(),paid,{db:other});assert.equal(res.code,400);
});
test('Card checkout recognises the route without changing the other routes',()=>{
 const route={id:'m1',native_provider:'pure_gateway',kind:'hosted_link',provider_key:'custom',currency:'USD',countries:['US'],active:true,gateway_origin:'https://pay.example.test'};
 assert.equal(policy.kind(route),'card');
 const open=policy.publicMethod(route);
 assert.equal(open.label,'Credit/Debit');assert.equal(open.gateway,'pure_gateway');assert.equal(open.gateway_origin,'https://pay.example.test');assert.equal('rampex_provider' in open,false);
 const choice=policy.choices([route]).find(x=>x.key==='card');
 assert.equal(choice.status,'available');assert.equal(choice.name,'Credit/Debit');assert.equal(choice.description,'Pay securely by card on our encrypted payment page. Your order is confirmed once the payment clears.');
 assert.equal(policy.kind({native_provider:'rampex',rampex_provider:'hosted'}),'card');
 assert.equal(policy.choices([{id:'m3',native_provider:'rampex',rampex_provider:'hosted',kind:'hosted_link',currency:'USD',countries:['US'],active:true}]).find(x=>x.key==='card').name,'Card','the existing Card route keeps its title');
 assert.equal(policy.publicMethod({id:'m2',native_provider:'rampex',rampex_provider:'hosted',kind:'hosted_link',currency:'USD',countries:['US']}).rampex_provider,'hosted');
 assert.equal(policy.kind({native_provider:'pure_gateway',kind:'interac'}),null);
});

// ---- coexistence with the existing Card route (checkout method list)
const direct=require('../lib/direct-checkout'),rampex=require('../lib/rampex');
const bothEnv={...env,RAMPEX_API_KEY:'isolated-rampex-fixture',RAMPEX_WEBHOOK_SECRET:'isolated-rampex-webhook-secret',RAMPEX_ENABLED:'true',RAMPEX_MODE:'live'};
function listDb(methods,accounts){return{from:name=>{const rows=name==='commerce_payment_methods'?methods:accounts;const t={select:()=>t,order:()=>t,then:(ok,no)=>Promise.resolve({data:rows}).then(ok,no)};return t;}};}
const methodRow=(id,provider,scope,order)=>({id,kind:'hosted_link',provider_key:'custom',currency:'USD',active:true,native_provider:provider,sale_scope:scope,display_order:order,label:id});
test('the payment-page Card route takes goods and the existing Card route keeps memberships',async()=>{
 const stripeTag=gw.configuration(bothEnv).account_tag,rampexTag=rampex.configuration(bothEnv).account_tag;
 const methods=[methodRow('page','pure_gateway','goods',1),methodRow('rampex','rampex','both',1)];
 const accounts=[{method_id:'page',provider:'pure_gateway',mode:'live',account_tag:stripeTag,countries:['US','CA']},{method_id:'rampex',provider:'rampex',mode:'live',account_tag:rampexTag,countries:['US','CA'],rampex_provider:'hosted'}];
 const list=await direct.methods(listDb(methods,accounts),bothEnv);
 assert.deepEqual(list.map(m=>[m.id,m.sale_scope]),[['page','goods'],['rampex','membership']],'goods checkout sees one Card, membership checkout sees the other');
 assert.equal(list[0].gateway_origin,'https://pay.example.test');
 const goods=list.filter(m=>['both','goods'].includes(m.sale_scope)),membership=list.filter(m=>['both','membership'].includes(m.sale_scope));
 assert.deepEqual([goods.map(m=>m.id),membership.map(m=>m.id)],[['page'],['rampex']]);
 // the order of the rows must not matter
 assert.deepEqual((await direct.methods(listDb([...methods].reverse(),accounts),bothEnv)).map(m=>m.id),['page','rampex']);
});
test('where the payment page does not serve a destination, the existing Card route stays the Card route',async()=>{
 const stripeTag=gw.configuration(bothEnv).account_tag,rampexTag=rampex.configuration(bothEnv).account_tag;
 const methods=[methodRow('page','pure_gateway','goods',1),methodRow('rampex','rampex','both',2)];
 const accounts=[{method_id:'page',provider:'pure_gateway',mode:'live',account_tag:stripeTag,countries:['US']},{method_id:'rampex',provider:'rampex',mode:'live',account_tag:rampexTag,countries:['US','CA'],rampex_provider:'hosted'}];
 const ca=await direct.methods(listDb(methods,accounts),bothEnv,'CA');
 assert.deepEqual(ca.map(m=>[m.id,m.sale_scope]),[['rampex','both']],'a Canadian customer still gets the Card route they have today');
 const us=await direct.methods(listDb(methods,accounts),bothEnv,'US');
 assert.deepEqual(us.map(m=>m.id),['page','rampex']);
 assert.equal(us[1].sale_scope,'both','the payment page covers fewer destinations than the other route, so nothing is hidden');
});
test('an inactive, unconfigured or unverified payment-page route changes nothing about the existing Card route',async()=>{
 const rampexTag=rampex.configuration(bothEnv).account_tag;
 const rampexOnly=[methodRow('rampex','rampex','both',1)],acc=[{method_id:'rampex',provider:'rampex',mode:'live',account_tag:rampexTag,countries:['US','CA'],rampex_provider:'hosted'}];
 const before=await direct.methods(listDb(rampexOnly,acc),bothEnv);
 assert.deepEqual(before.map(m=>[m.id,m.sale_scope]),[['rampex','both']]);
 const page={...methodRow('page','pure_gateway','goods',1)};
 const accounts=[...acc,{method_id:'page',provider:'pure_gateway',mode:'live',account_tag:gw.configuration(bothEnv).account_tag,countries:['US','CA']}];
 for(const [name,rows,e]of [['inactive',[{...page,active:false},...rampexOnly],bothEnv],['gateway switched off',[page,...rampexOnly],{...bothEnv,PURE_GATEWAY_ENABLED:'false'}],
  ['other payment page address',[page,...rampexOnly],{...bothEnv,PURE_GATEWAY_URL:'https://other.example.test'}],['secret missing',[page,...rampexOnly],{...bothEnv,PURE_GATEWAY_API_SECRET:''}]])
  assert.deepEqual((await direct.methods(listDb(rows,accounts),e)).map(m=>[m.id,m.sale_scope]),[['rampex','both']],name);
});
