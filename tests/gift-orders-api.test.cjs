'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHmac}=require('node:crypto');
const {handle}=require('../lib/gift-orders');
const origin='https://getpurelabs.com';
const buyer={id:randomUUID(),email:'buyer@example.test',email_confirmed_at:'2026-01-01'};
const headers={origin,authorization:'Bearer '+ 't'.repeat(30),'content-type':'application/json'};
const env={SITE_URL:origin,ORDER_CONFIRMATION_FROM:'PURE <info@example.test>',RESEND_API_KEY:'test',COMMERCE_NOTIFICATION_JOB_SECRET:'x'.repeat(32)};
const order={id:randomUUID(),method_id:randomUUID(),purchaser_id:buyer.id,purchaser_email:buyer.email,recipient_email:'friend@example.test',
  amount_cents:2599,send_date:new Date().toISOString().slice(0,10),status:'pending',payment:{version:1,label:'USD wire',payee:'Test',instructions:'For isolated tests'},notification_round:0,notification_status:'waiting'};

function setup() {
  const calls=[],mail=[];
  let ready=true;
  const db={auth:{getUser:async()=>({data:{user:buyer}})},from(table){
    const query={};
    for(const key of ['select','eq','is','neq','in','lte','order','or'])query[key]=()=>query;
    query.limit=async()=>({data:table==='commerce_payment_methods'?[{id:order.method_id,label:'USD wire',version:1}]:[]});
    query.single=query.maybeSingle=async()=>({data:{...order,status:'funded'}});
    return query;
  },async rpc(fn,args){
    calls.push([fn,args]);
    if(fn==='pure_gift_delivery_ready')return {data:ready};
    if(fn==='pure_gift_create')return {data:order.id};
    if(fn==='commerce_consume_notification_job')return {data:true};
    const result={fund:'funded',notify_claim:'send',notify_accepted:'funded',notify_failed:'funded',claim:'claimed',cancel:'cancelled'};
    return {data:result[args.p_action]};
  }};
  async function hit(action,method,body={},extra={}) {
    const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
    await handle({url:'/api/customer-config?gift_order='+action,method,headers,body,...extra},res,action,{db,env,
      assertAdmin:async req=>{if(req.headers.approved!=='test')throw Object.assign(Error('Unauthorized'),{status:401});},
      sendEmail:async (msg,opts)=>{mail.push({msg,opts});return {id:'mail-fixture'};}});
    return res;
  }
  return {calls,mail,hit,disable:()=>{ready=false;}};
}
test('gift API checks operational readiness and derives identities from verified accounts',async()=>{
  const t=setup();
  assert.equal((await t.hit('availability','GET')).body.available,true);
  const payload={request_id:order.id,mode:'gift',amount_cents:2599,recipient_email:'friend@example.test',confirm_email:'friend@example.test',
    note:'Hello',consent:true,purchaser_id:randomUUID(),purchaser_email:'spoof@example.test'};
  assert.equal((await t.hit('create','POST',{...payload,confirm_email:'wrong@example.test'})).code,400);
  assert.equal((await t.hit('create','POST',payload)).code,200);
  const data=t.calls.find(([fn])=>fn==='pure_gift_create')[1].p_data;
  assert.equal(data.purchaser_id,buyer.id);assert.equal(data.purchaser_email,buyer.email);
  assert.equal(data.method_id,order.method_id);assert.equal(data.amount_cents,2599);
  assert.equal((await t.hit('claim','POST',{id:order.id,email:'spoof@example.test'})).body.status,'claimed');
  assert.equal(t.calls.find(([fn,args])=>fn==='pure_gift_transition'&&args.p_action==='claim')[1].p_data.email,buyer.email);
  t.disable();assert.equal((await t.hit('availability','GET')).body.available,false);
  assert.equal((await t.hit('create','POST',payload)).code,409);
});
test('only staff can confirm funding and the email targets the recorded recipient',async()=>{
  const t=setup(),body={action:'fund',id:order.id,amount_cents:2599,currency:'USD',reference:'fixture-bank',confirmed:true};
  assert.equal((await t.hit('admin','POST',body)).code,401);
  const authorized=await t.hit('admin','POST',body,{headers:{...headers,approved:'test'}});
  assert.equal(authorized.body.status,'funded');assert.equal(authorized.body.notification_status,'accepted');
  assert.deepEqual(t.mail[0].msg.to,[order.recipient_email]);
  assert.match(t.mail[0].msg.text,/25\.99/);
  assert.equal(t.mail[0].opts.idempotencyKey,'pure-gift/'+order.id+'/0');
  assert.equal(t.mail[0].msg.scheduled_at,undefined);
  assert.ok(t.calls.find(([fn,args])=>fn==='pure_gift_transition'&&args.p_action==='notify_accepted'));
});
test('gift worker verifies a scoped signature and consumes a nonce before looking for due orders',async()=>{
  const t=setup(),nonce=randomUUID(),time=String(Math.floor(Date.now()/1000));
  const signed=scope=>({'x-commerce-job-time':time,'x-commerce-job-nonce':nonce,'x-commerce-job-signature':createHmac('sha256',env.COMMERCE_NOTIFICATION_JOB_SECRET).update([scope,time,nonce].join('\n')).digest('hex')});
  assert.equal((await t.hit('worker','POST',{}, {headers:signed('invoice-email-retry')})).code,401);
  const valid=await t.hit('worker','POST',{}, {headers:signed('gift-email-retry')});
  assert.equal(valid.code,200);assert.deepEqual(valid.body,{attempted:0,accepted:0});
  assert.ok(t.calls.find(([fn])=>fn==='commerce_consume_notification_job'));
});
