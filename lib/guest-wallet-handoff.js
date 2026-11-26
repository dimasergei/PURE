'use strict';

const {createHmac,timingSafeEqual}=require('node:crypto');
const guestCheckout=require('./guest-checkout');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const lifetimeSeconds=300;

function signature(invoice,identity,expires,env){
 return createHmac('sha256',env.CHECKOUT_RATE_LIMIT_SECRET)
  .update(`pure-guest-wallet-v1\n${invoice.toLowerCase()}\n${identity}\n${expires}`)
  .digest('base64url');
}

function issue(invoice,identity,env){
 if(!guestCheckout.enabled(env)||!UUID.test(invoice)||!UUID.test(identity))throw Error('Guest wallet handoff unavailable.');
 const expires=Math.floor(Date.now()/1000)+lifetimeSeconds;
 return `${identity}.${expires}.${signature(invoice,identity,expires,env)}`;
}

function verify(invoice,ticket,env){
 if(!guestCheckout.enabled(env)||!UUID.test(invoice)||typeof ticket!=='string'||ticket.length!==91)return null;
 const [identity,expires,provided]=ticket.split('.');
 const now=Math.floor(Date.now()/1000);
 if(!UUID.test(identity)||!/^\d{10}$/.test(expires)||!/^[A-Za-z0-9_-]{43}$/.test(provided)||
    Number(expires)<=now||Number(expires)>now+lifetimeSeconds)return null;
 const expected=signature(invoice,identity,expires,env);
 return timingSafeEqual(Buffer.from(expected),Buffer.from(provided))?identity:null;
}

module.exports={issue,verify};
