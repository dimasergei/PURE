'use strict';
// Payment flow for the pure_gateway card route. Mirrors rampex-payments: one persistent attempt per invoice,
// a session bound before the customer is redirected, and settlement only from a re-verified provider state.
const gw=require('./pure-gateway');
const {CARD_TEST_COUPON}=require('./checkout-promotions');
const membershipPayment=require('./membership-payment');
const error=(status,message)=>Object.assign(Error(message),{status});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function checked(result){if(result.error)throw error(503,'The card payment record could not be confirmed. Do not pay again.');return result.data;}
const bind=(db,attempt,session,config)=>db.rpc('commerce_bind_pure_gateway_session',{p_id:attempt.id,p_session:session.id,p_redirect:session.url,p_account_tag:config.account_tag});

async function start(db,invoice,account,config,body,user,env,fetchImpl,rateLimit){
 if(!config.ready)throw error(503,'Card collection is disabled.');
 if(invoice.pricing?.coupon_code===CARD_TEST_COUPON&&!config.test_payments)throw error(409,'This order requires the Stripe sandbox.');
 if(invoice.kind!=='goods'||invoice.currency!=='USD'||!membershipPayment.allowsPayment(invoice,account))throw error(409,'This order cannot be paid on the card payment page.');
 if(body.redirect_notice_ack!==true)throw error(400,'Confirm that you will be taken to the secure card payment page to pay for this order.');
 if(typeof body.attempt_id!=='string'||!UUID.test(body.attempt_id))throw error(400,'Invalid invoice or attempt reference.');
 await rateLimit(db,'native-payment:'+user.id,env.CHECKOUT_RATE_LIMIT_SECRET);
 const attempt=checked(await db.rpc('commerce_begin_gateway_attempt',{p_id:body.attempt_id,p_invoice:invoice.id,p_customer:user.id,p_operation:'sale',p_account_tag:config.account_tag}));
 if(!attempt.claimed)return{attempt_id:attempt.id,state:attempt.state,already_started:true,redirect_url:attempt.state==='redirected'?attempt.redirect_url:null};
 try{
  const session=await gw.create(attempt,invoice,env,fetchImpl);
  const done=checked(await bind(db,attempt,session,config));
  return{...done,attempt_id:attempt.id,redirect_url:done.state==='redirected'?session.url:null};
 }catch{
  // A timeout may mean the payment page opened a PaymentIntent. Keep one unknown attempt instead of a second charge path;
  // an administrator's reconcile re-asks for the same (idempotent) PaymentIntent and re-binds it.
  checked(await db.rpc('commerce_finish_gateway_attempt',{p_id:attempt.id,p_event:'pure-gateway-create:'+attempt.id,p_outcome:'unknown',p_transaction:null,p_amount:null,p_currency:null,p_redirect:null,p_error:'pure_gateway_session_uncertain'}));
  return{attempt_id:attempt.id,state:'unknown',redirect_url:null};
 }
}

// Record the outcome. `payment` is what the payment page itself reported (its signed confirmation); without it, PURE asks the
// payment page for the facts. `finish` is the shared recorder from native-gateway.
async function settle(db,attempt,env,fetchImpl,{finish,invoice,recover=false,payment}={}){
 const config=gw.configuration(env);
 if(attempt.provider!=='pure_gateway'||attempt.operation!=='sale'||!config.ready||attempt.account_tag!==config.account_tag||attempt.mode!=='live')throw error(503,'Card payment verification is unavailable.');
 if(!attempt.provider_session_id){
  if(!recover||attempt.state!=='unknown')return{state:attempt.state,confirmed:false,pending:true,provider_status:'unbound'};
  // Same attempt, same order, same amount: the payment page answers with the PaymentIntent it already opened.
  const session=await gw.create(attempt,invoice,env,fetchImpl);
  const bound=checked(await bind(db,attempt,session,config));
  attempt={...attempt,provider_session_id:session.id,redirect_url:session.url,state:bound.state||attempt.state};
 }
 const data=payment??await gw.status(attempt,env,fetchImpl),result=gw.result(data,attempt,env);
 if(result.outcome==='unknown')return{state:attempt.state,confirmed:false,pending:true,provider_status:data.status};
 const key=result.outcome==='approved'?'pure-gateway-paid:'+attempt.provider_session_id
  :'pure-gateway-'+(result.outcome==='declined'?'canceled':'review')+':'+attempt.provider_session_id+(result.outcome==='review'?':'+result.error:'');
 const done=await finish(db,attempt,key,result,env);
 return{state:done.state,confirmed:done.state==='paid',pending:false,provider_status:data.status};
}

// Signed confirmation from the payment page: it read the payment from Stripe and tells PURE what happened. The message is
// checked against PURE's own record (this invoice, the payment bound to the attempt, exact amount and currency) before anything
// is recorded. A message without facts makes PURE ask the payment page instead.
async function event(db,raw,req,env,fetchImpl,{finish}={}){
 const ping=gw.verifyPing(raw,req.headers['x-pure-gateway-signature'],env);
 if(ping.eventType==='failed')return{received:true,verified:true,ignored:true,live_payment_applied:false};
 const rows=checked(await db.from('commerce_gateway_attempts').select('*').eq('invoice_id',ping.orderId).eq('provider','pure_gateway').eq('operation','sale').order('created_at',{ascending:false}).limit(10))||[];
 if(!rows.length)return{received:true,verified:true,unmatched:true,live_payment_applied:false};
 const config=gw.configuration(env);
 if(!config.ready)throw error(503,'Card payment verification is unavailable. Retry delivery.');
 const attempt=rows.find(row=>row.provider_session_id===ping.paymentIntentId);
 if(!attempt){
  if(rows.some(row=>!row.provider_session_id&&row.state!=='declined'))throw error(503,'The card payment session is not recorded yet. Retry delivery.');
  throw error(409,'The card payment does not match this order.');
 }
 if(attempt.account_tag!==config.account_tag||attempt.mode!=='live')throw error(503,'Card payment verification is unavailable. Retry delivery.');
 const done=await settle(db,attempt,env,fetchImpl,{finish,payment:ping.payment});
 if(done.pending)throw error(503,'The card payment is not confirmed yet. Retry delivery.');
 return{received:true,verified:true,live_payment_applied:done.state==='paid',review:done.state==='review'};
}
module.exports={start,settle,event};
