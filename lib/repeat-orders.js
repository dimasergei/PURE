'use strict';

const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const commerce = require('./manual-commerce');
const checkout = require('./direct-checkout');
const delivery = require('./delivery-options');
const {orderThresholds} = require('./order-thresholds');
const {parseBody, isAllowedOrigin} = require('./checkout-security');
const terms = require('../config/launch-commercial-terms.json');
const checkoutConfig = require('../config/checkout.json');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const planTerms = 'pure-monthly-invoice-v1';
const fail = (status, message) => { throw Object.assign(Error(message), {status}); };

function pricedBasket(kind, input, catalog, country, options) {
  const rates = {product: 1000, builder: 4000};
  if (!Object.hasOwn(rates, kind)) fail(400, 'Choose a monthly order type.');
  if (!checkoutConfig.shipping_countries.includes(country)) fail(400, 'Choose an available destination.');
  const items = commerce.itemsFromCatalog(input, catalog);
  if (items.some(item => catalog.find(p => p.id === item.id)?.category !== 'injectables'))
    fail(400, 'This item is unavailable for monthly orders.');
  const units = items.reduce((sum, item) => sum + item.qty, 0);
  if (units > 60 || (kind === 'builder' ? units % 4 !== 0 : items.length !== 1))
    fail(400, 'Choose a single product or complete sets of four, up to 60 units.');
  const pricing = commerce.priceLines(items);
  const rate = rates[kind];
  for (const line of pricing.lines) {
    line.line_total_cents = Math.round(line.unit_price_cents * (10000 - rate) / 10000) * line.qty;
    line.discount_cents = line.gross_cents - line.line_total_cents;
    line.discount_bps = rate;
    line.discount_reason = 'monthly_invoice';
  }
  pricing.discount_cents = pricing.lines.reduce((sum, row) => sum + row.discount_cents, 0);
  const net = pricing.subtotal_cents - pricing.discount_cents;
  const shipping = kind === 'builder' ? 'express' : 'economy';
  pricing.delivery = delivery.price({shipping, extras: []}, orderThresholds(net).freeShipping, options, country);
  if (kind === 'builder' && ['US','CA'].includes(country)) {
    pricing.delivery.shipping_cents = pricing.delivery.total_cents = 0;
  }
  pricing.bundled_items = kind === 'builder' ? [{id:'gift-bac-3',name:'Reconstitution Solution',size:'3 mL',qty:units/4,unit_price_cents:0,line_total_cents:0}] : [];
  pricing.billing_mode = 'invoice_per_cycle';
  pricing.discount_source = 'monthly_invoice';
  pricing.usd_earned_points_basis_cents = 0;
  return {items, pricing, total_cents:net + pricing.delivery.shipping_cents, currency:'USD'};
}

function checked(result) {
  if (!result.error) return result.data;
  if (['22023','23505','23514','40001','P0001'].includes(result.error.code))
    fail(409, 'The plan, payment method or invoice changed. Refresh and review the current details.');
  if (result.error.code === 'P0002') fail(404, 'Plan not found.');
  fail(503, 'Monthly invoicing is temporarily unavailable.');
}
const hash = object => createHash('sha256').update(JSON.stringify(object)).digest('hex');
async function handle(req,res,deps={}) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Vary','Authorization');
  try {
    const db = deps.db || require('./inventory-db').inventoryDb();
    const params = new URL(req.url, 'https://getpurelabs.com').searchParams;
    const env = deps.env || process.env;
    if (req.method === 'GET' && params.get('repeat_orders') === 'status') {
      const r = await db.rpc('pure_repeat_ready');
      const available = !r.error && r.data === true && (await checkout.methods(db,env)).some(m => m.currency === 'USD' && ['goods','both'].includes(m.sale_scope));
      return res.status(200).json({available});
    }
    const match = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization || '');
    const auth = match && await db.auth.getUser(match[1]);
    const user = auth?.data?.user;
    if (auth?.error || !user?.email_confirmed_at || !user.email) fail(401, 'Sign in with a verified PURE account.');
    if (req.method === 'GET') {
      const methods = checkout.publicMethods(await checkout.methods(db,env))
        .filter(m => m.currency === 'USD' && ['goods','both'].includes(m.sale_scope));
      const plans = checked(await db.rpc('pure_repeat_list',{p_owner:user.id}));
      const catalog = deps.catalog || JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
      return res.json({methods,plans,terms:planTerms,catalog:catalog.filter(p=>p.category==='injectables').map(({id,name,category,variants})=>({id,name,category,variants:variants.map(({size})=>({size}))}))});
    }
    if (req.method !== 'POST') {res.setHeader('Allow','GET, POST');fail(405,'Use GET or POST.');}
    if (!isAllowedOrigin(req.headers.origin,env.SITE_URL)) fail(403,'Origin not allowed.');
    if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') fail(415,'JSON required.');
    const body = parseBody(req.body);
    if (!uuid.test(body.id || '')) fail(400,'A valid plan reference is required.');
    if (['pause','resume','cancel','skip'].includes(body.action)) {
      if (!Number.isSafeInteger(body.version)) fail(400,'Refresh the plan before changing it.');
      return res.json(checked(await db.rpc('pure_repeat_manage',{p_owner:user.id,p_id:body.id,p_action:body.action,p_version:body.version})));
    }
    if (!['quote','enroll','change'].includes(body.action)) fail(400,'Choose a valid monthly order action.');
    const catalog = deps.catalog || JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
    const country = String(body.address?.country || '').toUpperCase();
    const methods = (await checkout.methods(db,env,country)).filter(m => m.currency === 'USD' && ['goods','both'].includes(m.sale_scope));
    const method = methods.find(m => m.id === body.method_id);
    if (!method) fail(409,'Choose an available USD payment method for this destination.');
    const result = pricedBasket(body.kind,body.items,catalog,country,await delivery.load(db));
    let record;
    await commerce.requestInvoice({rpc:async (_name,args) => {record=args.p_data;return {data:{}};}},user,{
      ...body, kind:'goods', consent:body.action==='quote' || body.consent===true,
      research_use:body.action==='quote' || body.research_use===true,terms_version:terms.version,
    },catalog);
    const snapshot = {kind:body.kind,terms:planTerms,request:record.request,pricing:result.pricing,
      total_cents:result.total_cents, method_id:method.id,method_version:method.version};
    const quote = hash({owner:user.id,id:body.id,snapshot});
    if (body.action === 'quote') return res.json({...result,quote,terms:planTerms});
    if (body.quote !== quote || body.terms !== planTerms || body.consent !== true || body.research_use !== true)
      fail(409,'Review and agree to the current monthly invoice total.');
    if (body.action === 'change' && !Number.isSafeInteger(body.version)) fail(400,'Refresh your plan.');
    return res.json(checked(await db.rpc('pure_repeat_save',{p_id:body.id,p_owner:user.id,p_email:user.email.toLowerCase().trim(),
      p_snapshot:snapshot,p_digest:quote,p_version:body.action==='change'?body.version:null})));
  } catch (error) {
    const status=[400,401,403,404,405,409,413,415,429].includes(error.status)?error.status:503;
    return res.status(status).json({error:status===503?'Monthly invoicing is temporarily unavailable.':error.message});
  }
}

module.exports = {handle, pricedBasket};
