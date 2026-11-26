'use strict';
// Payment flow for the pure_gateway card route. Mirrors rampex-payments: one persistent attempt per invoice,
// a session bound before the customer is redirected, and settlement only from a re-verified provider state.
const gw=require('./pure-gateway');
const membershipPayment=require('./membership-payment');
const error=(status,message)=>Object.assign(Error(message),{status});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function checked(result){if(result.error)throw error(503,'The card payment record could not be confirmed. Do not pay again.');return result.data;}
const bind=(db,attempt,session,config)=>db.rpc('commerce_bind_pure_gateway_session',{p_id:attempt.id,p_session:session.id,p_redirect:session.url,p_account_tag:config.account_tag});
function reversalChecked(result){
 if(result.error){
  if(['P0001','P0002','40001','22023','23505','23514'].includes(result.error.code))
   throw error(409,'Card payment state changed. Refresh the order and sync with Stripe.');
  throw error(503,'The Stripe result could not be recorded. Sync the order with Stripe before retrying.');
 }
 return result.data;
}
function assertInvoiceAttempt(invoice,attempt){
 if(!attempt||attempt.invoice_id!==invoice.id||!invoice.method_id||attempt.method_id!==invoice.method_id
    ||invoice.kind!=='goods'||attempt.amount_cents!==invoice.total_cents||attempt.currency!==invoice.currency)
  throw error(409,'The original card payment could not be matched to this order.');
}
function assertReversalsEnabled(env){
 if(!gw.configuration(env).reversals)throw error(409,'Stripe cancellation and refund sync are not enabled. Review the payment with the store before retrying.');
}
async function orderAttempts(db,invoice){
 return checked(await db.from('commerce_gateway_attempts').select('*').eq('invoice_id',invoice.id)
  .eq('provider','pure_gateway').eq('operation','sale').order('created_at',{ascending:false}).limit(10))||[];
}
async function applyTerminal(db,attempt,data,paymentState,actor,customerId){
 const common={p_invoice:attempt.invoice_id,p_attempt:attempt.id,p_account_tag:attempt.account_tag,p_evidence:data,p_actor:actor};
 const result=reversalChecked(await db.rpc(paymentState==='refunded'?'commerce_apply_pure_gateway_refund':'commerce_apply_pure_gateway_cancellation',
  paymentState==='refunded'?common:{...common,p_customer:customerId}));
 return {...result,state:paymentState==='refunded'?'refunded':'declined',pending:false};
}
async function notify(db,invoiceId,env,fetchImpl){
 try{await require('./invoice-notifications').dispatch(db,{invoiceId,env,limit:2,fetchImpl});}catch{}
}
function basicState(invoice,paymentState,attempt,providerStatus){
 return {id:invoice.id,status:invoice.status,payment_state:paymentState,
  pending:['awaiting_payment','refund_pending'].includes(paymentState),...(attempt?{state:attempt.state}:{}),
  ...(providerStatus?{provider_status:providerStatus}:{})};
}
async function confirmSale(db,attempt,data,env){
 const result=gw.result(data,attempt,env);
 const out=reversalChecked(await db.rpc('commerce_finish_gateway_attempt',{p_id:attempt.id,
  p_event:'pure-gateway-paid:'+attempt.provider_session_id,p_outcome:result.outcome,p_transaction:result.transaction,
  p_amount:result.amount,p_currency:result.currency,p_redirect:null,p_error:null}));
 return {id:attempt.invoice_id,status:out.invoice_status,payment_state:out.state==='paid'?'paid':'review',
  state:out.state,replayed:out.replayed===true};
}

async function cancelOrder(db,invoice,attempt,{customerId,actor,env,fetchImpl}){
 assertReversalsEnabled(env);
 assertInvoiceAttempt(invoice,attempt);
 if(invoice.customer_id!==customerId||invoice.status!=='accepted')throw error(409,'Only an unpaid order can be canceled.');
 if(attempt.state!=='redirected')throw error(409,'Card payment needs verification. Sync the order with Stripe before canceling.');
 const {data,paymentState}=await gw.operate('cancel',attempt,env,fetchImpl);
 if(paymentState==='canceled')return applyTerminal(db,attempt,data,paymentState,actor||'customer:'+customerId,customerId);
 if(paymentState==='paid'){
  await confirmSale(db,attempt,data,env);
  await notify(db,invoice.id,env,fetchImpl);
  throw error(409,'Stripe shows that the card payment was received. A paid order requires a refund.');
 }
 throw error(409,'Stripe has not confirmed cancellation. Sync the order before trying again.');
}

async function refundOrder(db,invoice,{env,fetchImpl}){
 assertReversalsEnabled(env);
 if(!['paid','processing','shipped','delivered','refunded'].includes(invoice.status))throw error(409,'A paid card order is required for a full refund.');
 const attempt=(await orderAttempts(db,invoice)).find(a=>['paid','refunded'].includes(a.state));
 assertInvoiceAttempt(invoice,attempt);
 gw.assertBoundAttempt(attempt,env);
 if(invoice.status==='refunded')return reconcileOrder(db,invoice,{attempt,env,fetchImpl});
 const prior=await gw.status(attempt,env,fetchImpl),priorState=gw.paymentState(prior,attempt,env);
 if(priorState==='refunded')return applyTerminal(db,attempt,prior,priorState,'admin:card-reconciliation');
 if(['refund_pending','refund_review'].includes(priorState))return basicState(invoice,priorState,attempt,prior.status);
 if(priorState!=='paid')throw error(409,'Stripe has not verified the original paid card charge.');
 const {data,paymentState}=await gw.operate('refund',attempt,env,fetchImpl);
 if(paymentState==='refunded')return applyTerminal(db,attempt,data,paymentState,'admin:card-refund');
 if(['refund_pending','refund_review'].includes(paymentState))return basicState(invoice,paymentState,attempt,data.status);
 throw error(409,'Stripe has not confirmed a full refund. Sync the order before trying again.');
}

async function reconcileOrder(db,invoice,{attempt,env,fetchImpl,recover=false}={}){
 assertReversalsEnabled(env);
 const attempts=attempt?[attempt]:await orderAttempts(db,invoice);
 let selected=attempts.find(a=>['paid','refunded'].includes(a.state))||attempts.find(a=>a.state!=='declined')||attempts[0];
 if(!selected)return basicState(invoice,invoice.status==='accepted'?'awaiting_payment':invoice.status==='void'?'canceled':'review');
 assertInvoiceAttempt(invoice,selected);
 if(!selected.provider_session_id){
  if(!recover||selected.state!=='unknown')return basicState(invoice,'review',selected,'unbound');
  const config=gw.configuration(env);
  if(config.missing.length||config.account_tag!==selected.account_tag||config.mode!==selected.mode)
   throw error(409,'The original card gateway account could not be verified.');
  const session=await gw.create(selected,invoice,env,fetchImpl);
  const bound=checked(await bind(db,selected,session,config));
  selected={...selected,provider_session_id:session.id,state:bound.state};
 }
 gw.assertBoundAttempt(selected,env);
 const data=await gw.status(selected,env,fetchImpl),paymentState=gw.paymentState(data,selected,env);
 if(paymentState==='refunded'||paymentState==='canceled')
  return applyTerminal(db,selected,data,paymentState,'admin:card-reconciliation',invoice.customer_id);
 if(paymentState==='paid'&&invoice.status==='accepted')return confirmSale(db,selected,data,env);
 return basicState(invoice,paymentState,selected,data.status);
}

async function start(db,invoice,account,config,body,user,env,fetchImpl,rateLimit){
 if(!config.ready)throw error(503,'Card collection is disabled.');
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
 if(config.missing.length)throw error(503,'Card payment verification is unavailable. Retry delivery.');
 const attempt=rows.find(row=>row.provider_session_id===ping.paymentIntentId);
 if(!attempt){
  if(rows.some(row=>!row.provider_session_id&&row.state!=='declined'))throw error(503,'The card payment session is not recorded yet. Retry delivery.');
  throw error(409,'The card payment does not match this order.');
 }
 if(attempt.account_tag!==config.account_tag||attempt.mode!=='live')throw error(503,'Card payment verification is unavailable. Retry delivery.');
 if(ping.eventType==='canceled'&&!config.reversals)throw error(503,'Stripe cancellation sync is not enabled. Retry delivery.');
 if(['refunded','canceled'].includes(ping.eventType)){
  const data=ping.payment??await gw.status(attempt,env,fetchImpl);
  // Legacy refund notifications carry enough data to flag review, but only the
  // new, fully bound Stripe evidence can change an order to refunded or void.
  if(ping.eventType==='canceled'||(config.reversals&&Object.hasOwn(data,'paymentIntentId'))){
   if(config.test_payments&&data.livemode===false)return{received:true,verified:true,ignored:true,live_payment_applied:false};
   const paymentState=gw.paymentState(data,attempt,env);
   if(paymentState==='refunded'){
    await applyTerminal(db,attempt,data,paymentState,'verified-gateway:pure_gateway');
    await notify(db,attempt.invoice_id,env,fetchImpl);
    return{received:true,verified:true,refunded:true,live_payment_applied:false};
   }
   if(ping.eventType==='canceled'&&paymentState==='canceled'){
    const order=checked(await db.from('commerce_invoices').select('id,customer_id,status').eq('id',attempt.invoice_id).maybeSingle());
    if(!order||!['accepted','void'].includes(order.status))return{received:true,verified:true,ignored:true,live_payment_applied:false};
    // A late notification for an earlier attempt must never stop a newer payment.
    if(rows.some(row=>row.id!==attempt.id&&row.state!=='declined'))return{received:true,verified:true,ignored:true,live_payment_applied:false};
    await applyTerminal(db,attempt,data,paymentState,'verified-gateway:pure_gateway',order.customer_id);
    await notify(db,attempt.invoice_id,env,fetchImpl);
    return{received:true,verified:true,canceled:true,live_payment_applied:false};
   }
   return{received:true,verified:true,payment_state:paymentState,review:paymentState!=='refund_pending',live_payment_applied:false};
  }
  const legacy=await settle(db,attempt,env,fetchImpl,{finish,payment:data});
  return{received:true,verified:true,live_payment_applied:legacy.state==='paid',review:legacy.state==='review'};
 }
 const done=await settle(db,attempt,env,fetchImpl,{finish,payment:ping.payment});
 if(done.pending)throw error(503,'The card payment is not confirmed yet. Retry delivery.');
 return{received:true,verified:true,live_payment_applied:done.state==='paid',review:done.state==='review'};
}
module.exports={start,settle,event,cancelOrder,refundOrder,reconcileOrder};
