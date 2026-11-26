'use strict';

const {createHmac,randomUUID,timingSafeEqual}=require('node:crypto');
const {isIP}=require('node:net');

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TTL=2*60*60;
const enabled=env=>typeof env.CHECKOUT_RATE_LIMIT_SECRET==='string'&&env.CHECKOUT_RATE_LIMIT_SECRET.length>=32;
const methodAllowed=method=>method?.native_provider==='pure_gateway'&&method.currency==='USD'&&['goods','both'].includes(method.sale_scope);
const isGuestInvoice=invoice=>invoice.kind==='goods'&&invoice.request_data?.checkout?.guest===true;
const cookieName=id=>'__Host-pure-order-'+id.toLowerCase();
const hmac=(id,identity,expires,env)=>createHmac('sha256',env.CHECKOUT_RATE_LIMIT_SECRET)
 .update(`pure-guest-invoice-v1\n${id.toLowerCase()}\n${identity}\n${expires}`).digest();
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};

function createCredential(id,res,env){
 if(!enabled(env)||typeof id!=='string'||!UUID.test(id))throw Error('Guest checkout credential unavailable.');
 const identity=randomUUID(),expires=Math.floor(Date.now()/1000)+TTL;
 const signature=hmac(id,identity,expires,env).toString('base64url');
 const cookie=`${cookieName(id)}=${identity}.${expires}.${signature}; Max-Age=${TTL}; Path=/; Secure; HttpOnly; SameSite=Lax`;
 return {id:identity,issue:()=>res.setHeader('Set-Cookie',cookie)};
}

function readCredential(req,id,env){
 if(!enabled(env)||typeof id!=='string'||!UUID.test(id)||typeof req.headers.cookie!=='string')return null;
 const prefix=cookieName(id)+'=';
 const cookies=req.headers.cookie.split(';').map(part=>part.trim()).filter(part=>part.startsWith(prefix));
 if(cookies.length!==1)return null;
 const [identity,expires,signature,...rest]=cookies[0].slice(prefix.length).split('.');
 if(rest.length||!UUID.test(identity)||!/^\d{10}$/.test(expires)||! /^[A-Za-z0-9_-]{43}$/.test(signature)||Number(expires)<=Math.floor(Date.now()/1000))return null;
 const expected=hmac(id,identity,expires,env).toString('base64url');
 if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))return null;
 return {id:identity};
}

function email(value){
 const valid=typeof value==='string'?value.trim().toLowerCase():'';
 if(valid.length>254||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(valid)||valid.indexOf('@')>64)
  fail(400,'Enter a valid email address for your order updates.');
 return valid;
}

function validatePurchase(body,coupon){
 if(body.kind&&body.kind!=='goods'||body.membership_addon!==undefined||body.bulk_order===true||body.research_builder_mode!==undefined||
    body.plan!==undefined||body.billing_period!==undefined||body.points||body.credit_cents)
  fail(403,'Sign in for memberships, bulk orders, Member Stack, points or store credit.');
 if(coupon.affiliate_code||coupon.coupon==='CARDTEST')fail(403,'Sign in to use this code.');
}

function networkKey(req,env){
 // Vercel overwrites X-Forwarded-For. Use the socket on direct server adapters.
 const ip=env.VERCEL==='1'?req.headers['x-forwarded-for']:req.socket?.remoteAddress;
 return isIP(typeof ip==='string'?ip:'')?ip:'unknown';
}

module.exports={createCredential,readCredential,enabled,methodAllowed,isGuestInvoice,email,validatePurchase,networkKey};
