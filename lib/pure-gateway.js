'use strict';
// Card payments collected on the owner-operated Get Pure Skin payment page (Stripe PaymentIntents).
// PURE never sees card data and never talks to Stripe. It asks the payment page to open a PaymentIntent for
// one accepted invoice and sends the customer there. The payment page is responsible for the confirmation: it
// reads the real state from Stripe and sends PURE a signed message (verifyPing) with the facts. PURE records a
// payment only from such a signed message, or from the page's status answer when PURE asks for it (customer
// return, admin reconcile). A redirect or a browser query string proves nothing.
const {createHmac,createHash,timingSafeEqual}=require('node:crypto');
const error=(status,message)=>Object.assign(Error(message),{status});
const PAYMENT=/^pi_[A-Za-z0-9_]{6,120}$/,CHARGE=/^(?:ch|py)_[A-Za-z0-9]{6,100}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LOCAL_HOSTS=new Set(['localhost','127.0.0.1']);
const SITE_FALLBACK='https://getpurelabs.com';
const PING_EVENTS=['succeeded','failed','refunded'];
const production=env=>env.VERCEL_ENV==='production';

// The payment page origin. https everywhere; plain http only for a loopback host outside production.
function gatewayOrigin(env=process.env){
 let url;try{url=new URL(env.PURE_GATEWAY_URL||'');}catch{return null;}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')return null;
 if(url.protocol==='https:')return url.origin;
 return url.protocol==='http:'&&LOCAL_HOSTS.has(url.hostname)&&!production(env)?url.origin:null;
}
function siteOrigin(env=process.env){
 let url;try{url=new URL(env.SITE_URL||SITE_FALLBACK);}catch{throw error(503,'The store address is not configured.');}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['https:','http:'].includes(url.protocol))throw error(503,'The store address is not configured.');
 return url.origin;
}
function configuration(env=process.env){
 const missing=[],origin=gatewayOrigin(env);
 if(!origin)missing.push('PURE_GATEWAY_URL (https origin of the payment page; http only for localhost outside production)');
 for(const key of ['PURE_GATEWAY_API_SECRET','PURE_GATEWAY_WEBHOOK_SECRET'])if(!env[key]||env[key].length<32)missing.push(key+' (32+ characters)');
 if(env.PURE_GATEWAY_API_SECRET&&env.PURE_GATEWAY_API_SECRET===env.PURE_GATEWAY_WEBHOOK_SECRET)missing.push('distinct PURE_GATEWAY_API_SECRET and PURE_GATEWAY_WEBHOOK_SECRET');
 const currencies=(env.PURE_GATEWAY_CURRENCIES||'').split(',').filter(x=>x==='USD');
 if(!currencies.length)missing.push('PURE_GATEWAY_CURRENCIES=USD');
 const requestedTest=env.PURE_GATEWAY_ALLOW_TEST_PAYMENTS==='true';
 if(requestedTest&&production(env))missing.push('PURE_GATEWAY_ALLOW_TEST_PAYMENTS must be off in production');
 const enabled=env.PURE_GATEWAY_ENABLED==='true';
 // The route's identity (mode live + account tag) does not depend on the switch, so an administrator can register it while the
 // switch is off. PURE_GATEWAY_ENABLED alone then shows or hides Credit/Debit at checkout (see ready).
 return{provider:'pure_gateway',mode:'live',enabled,ready:enabled&&!missing.length,missing,currencies,origin,
  // Stripe test-mode payments may settle a development database. Never in production.
  test_payments:requestedTest&&!production(env),
  account_tag:origin?createHash('sha256').update('pure_gateway:live:'+origin).digest('hex'):null,
  three_ds:false,wallets:{apple:false,google:false}};
}
async function request(path,body,env,fetchImpl=fetch){
 const origin=gatewayOrigin(env);
 if(!origin||!env.PURE_GATEWAY_API_SECRET)throw error(503,'The card payment page is not configured.');
 let response;
 try{
  response=await fetchImpl(origin+path,{method:'POST',headers:{Authorization:'Bearer '+env.PURE_GATEWAY_API_SECRET,'Content-Type':'application/json'},
   body:JSON.stringify(body),signal:AbortSignal.timeout(path==='/api/payments/create'?18000:6000),redirect:'error'});
 }catch{throw error(502,'The card payment page could not be reached. Do not submit another payment.');}
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data||typeof data!=='object'||Array.isArray(data))throw error(502,'The card payment page could not confirm this payment. Do not submit another payment.');
 return data;
}
// The payment page must hand back exactly its own /pay?pi=<id> address for this PaymentIntent.
function payUrl(value,id,origin){
 let url;try{url=new URL(value);}catch{throw error(502,'Invalid card payment destination.');}
 if(url.origin!==origin||url.pathname!=='/pay'||url.search!=='?pi='+id||url.hash||url.username||url.password)throw error(502,'Invalid card payment destination.');
 return url.href;
}
async function create(attempt,invoice,env,fetchImpl){
 if(attempt.currency!=='USD'||!Number.isSafeInteger(attempt.amount_cents)||attempt.amount_cents<50||attempt.amount_cents>99999999)throw error(400,'Order amount is outside the card route limits.');
 if(!UUID.test(attempt.id||'')||!UUID.test(attempt.invoice_id||''))throw error(400,'Invalid payment attempt.');
 const origin=gatewayOrigin(env);
 const order=typeof invoice?.public_order_number==='string'&&/^P[0-9]{8}$/.test(invoice.public_order_number)?invoice.public_order_number:undefined;
 const data=await request('/api/payments/create',{orderId:attempt.invoice_id,...(order?{orderNumber:order}:{}),amountCents:attempt.amount_cents,currency:'usd',
  returnUrl:siteOrigin(env)+'/pay.html?invoice='+attempt.invoice_id},env,fetchImpl);
 if(typeof data.paymentIntentId!=='string'||!PAYMENT.test(data.paymentIntentId))throw error(502,'Invalid card payment reference.');
 return{id:data.paymentIntentId,url:payUrl(data.payUrl,data.paymentIntentId,origin)};
}
async function status(attempt,env,fetchImpl){
 if(!PAYMENT.test(attempt.provider_session_id||''))throw error(409,'The original card payment was not recorded. Reconcile the original attempt; do not create another charge.');
 return request('/api/payments/status',{paymentIntentId:attempt.provider_session_id},env,fetchImpl);
}
// The payment page's messages are signed t=<unix>,v1=<hmac-sha256 of "t.<raw body>"> with the shared webhook secret.
// A message carries the facts the page read from Stripe (payment), in the same shape as its status answer.
function verifyPing(raw,header,env,now=Date.now()){
 const secret=env.PURE_GATEWAY_WEBHOOK_SECRET;
 if(!secret||secret.length<32)throw error(503,'The card payment webhook secret is not configured.');
 const match=typeof header==='string'&&header.length<=256?/^t=(\d{10}),v1=([a-f0-9]{64})$/.exec(header):null;
 if(!match||Math.abs(now/1000-Number(match[1]))>300)throw error(401,'Invalid or stale card payment signature.');
 const expected=createHmac('sha256',secret).update(match[1]+'.').update(raw).digest();
 if(!timingSafeEqual(expected,Buffer.from(match[2],'hex')))throw error(401,'Invalid or stale card payment signature.');
 let ping;try{ping=JSON.parse(raw.toString('utf8'));}catch{throw error(400,'Invalid card payment event.');}
 if(!ping||typeof ping!=='object'||Array.isArray(ping)||!UUID.test(ping.orderId||'')||!PAYMENT.test(ping.paymentIntentId||'')||!PING_EVENTS.includes(ping.eventType))throw error(400,'Invalid card payment event.');
 if(ping.payment!==undefined&&(!ping.payment||typeof ping.payment!=='object'||Array.isArray(ping.payment)))throw error(400,'Invalid card payment event.');
 return{orderId:ping.orderId.toLowerCase(),paymentIntentId:ping.paymentIntentId,eventType:ping.eventType,...(ping.payment!==undefined?{payment:ping.payment}:{})};
}
// Turn the payment page's report into a PURE gateway outcome. 'unknown' with error pure_gateway_pending means
// "nothing final yet": callers must not write it.
function result(data,attempt,env=process.env){
 const review=reason=>({outcome:'review',error:'pure_gateway_'+reason});
 if(!PAYMENT.test(attempt.provider_session_id||''))return review('session_missing');
 const meta=data?.metadata;
 if(!meta||typeof meta.orderId!=='string'||meta.orderId.toLowerCase()!==attempt.invoice_id)return review('order_mismatch');
 if(data.amount!==attempt.amount_cents||typeof data.currency!=='string'||data.currency.toUpperCase()!==attempt.currency)return review('amount_currency_mismatch');
 if(typeof data.livemode!=='boolean')return review('mode_unknown');
 if(data.livemode===false&&!configuration(env).test_payments)return review('test_payment');
 if(!Number.isSafeInteger(data.amountRefunded)||data.amountRefunded<0)return review('refund_unknown');
 if(data.amountRefunded>0)return review('refund_review');
 switch(data.status){
  case 'succeeded':
   if(!CHARGE.test(data.chargeId||'')||!Number.isFinite(Date.parse(data.paidAt)))return review('settlement_unconfirmed');
   return{outcome:'approved',transaction:data.chargeId,amount:attempt.amount_cents,currency:attempt.currency};
  case 'canceled':
   return{outcome:'declined',error:'pure_gateway_canceled'};
  case 'requires_payment_method':case 'requires_confirmation':case 'requires_action':case 'processing':
   return{outcome:'unknown',error:'pure_gateway_pending'};
  default:
   return review('status_unrecognised');
 }
}
module.exports={configuration,gatewayOrigin,create,status,verifyPing,result,payUrl};
