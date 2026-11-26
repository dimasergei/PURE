'use strict';

const { createHmac } = require('node:crypto');
const { isAllowedOrigin } = require('./checkout-security');
const { escapeHtml } = require('./order-email-layout');

const routes = {contact: '/contact', bulk: '/bulk-orders#request-quote', tracking: '/track-order'};
const fields = ['name', 'email', 'organization', 'country', 'topic', 'message', 'website'];

function nativeInquiry(input, kind, secret, now) {
  const values = Object.fromEntries(fields.map(key => [key, String(input[key] || '').trim()]));
  let items = [];
  if (kind === 'bulk') {
    const [id, size] = String(input.variant || '').split('|');
    items = [{id, size, qty: Number(input.quantity)}];
    if (!values.organization) throw Error('Enter your organization.');
  }
  const body = {...values, type: kind, consent: input.consent === 'on', items};
  // Identical browser retries reuse the durable inquiry reference within this window.
  const hex = createHmac('sha256', secret).update(JSON.stringify([Math.floor(now / 1800000), body])).digest('hex');
  body.request_id = [hex.slice(0,8), hex.slice(8,12), '4'+hex.slice(13,16), '8'+hex.slice(17,20), hex.slice(20,32)].join('-');
  return body;
}

async function handle(req, res, kind, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const reply = (status, message) => {
    const title = status === 202 ? 'Request received' : 'Check your request';
    return res.status(status).send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' | PURE</title><link rel="stylesheet" href="/storefront-v2.css"></head><body><main class="ap-container"><a href="/">PURE</a><h1>'+title+'</h1><p>'+escapeHtml(message)+'</p><a href="'+(Object.hasOwn(routes,kind)?routes[kind]:'/contact')+'">Return to '+(kind==='bulk'?'bulk orders':kind==='tracking'?'order tracking':'contact')+'</a></main></body></html>');
  };
  if (!Object.hasOwn(routes, kind)) return reply(404,'This form is unavailable.');
  if (req.method !== 'POST') {res.setHeader('Allow','POST'); return reply(405,'Submit this form from the PURE website.');}
  const env = deps.env || process.env;
  if (!isAllowedOrigin(req.headers?.origin, env.SITE_URL)) return reply(403,'Submit the form from the PURE website.');
  if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return reply(415,'Use the form on the PURE website.');
  const raw = req.body;
  if (Number(req.headers['content-length']) > 16384 || Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw || {})) > 16384) return reply(413,'Use a shorter message.');
  const values = typeof raw === 'string' ? Object.fromEntries(new URLSearchParams(raw)) : raw;
  if (!values || Array.isArray(values) || Object.values(values).some(v=>typeof v!=='string')) return reply(400,'Check the form fields.');
  if (kind!=='tracking' && !env.CHECKOUT_RATE_LIMIT_SECRET) return reply(503,'Messaging is temporarily unavailable. Please try again later.');
  let body;
  try {
    body = kind === 'tracking' ? {order_number: values.order_number, email: values.email} : nativeInquiry(values,kind,env.CHECKOUT_RATE_LIMIT_SECRET,Date.now());
  } catch(error) {return reply(400,error.message);}
  const jsonRequest = {method:req.method, socket:req.socket, headers:{...req.headers, 'content-type':'application/json'},body};
  const response = {code:200,setHeader:(key,value)=>res.setHeader(key,value),status(code){this.code=code;return this;},json(result){
    const message = result.error || result.message || (result.saved ? 'Your inquiry was saved. Reference '+result.reference+'.' : 'Please try again.');
    return reply(this.code,message);
  }};
  const handler = kind === 'tracking' ? require('./track-order').handle : require('./site-inquiry').handleInquiry;
  return handler(jsonRequest, response, deps);
}

module.exports = {handle, nativeInquiry};
