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

function pricedBasket(kind, input, catalog, country, options, protection = false) {
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
  pricing.delivery = delivery.price({shipping, extras: protection ? ['protection'] : []}, orderThresholds(net).freeShipping, options, country);
  if (kind === 'builder' && ['US','CA'].includes(country)) {
    pricing.delivery.shipping_cents = 0;
    pricing.delivery.total_cents = pricing.delivery.extras_cents;
  }
  pricing.bundled_items = kind === 'builder' ? [{id:'gift-bac-3',name:'Reconstitution Solution',size:'3 mL',qty:units/4,unit_price_cents:0,line_total_cents:0}] : [];
  pricing.billing_mode = 'invoice_per_cycle';
  pricing.discount_source = 'monthly_invoice';
  pricing.usd_earned_points_basis_cents = 0;
  return {items, pricing, total_cents:net + pricing.delivery.total_cents, currency:'USD'};
}

function checked(result) {
  if (!result.error) return result.data;
  if (['22023','23505','23514','40001','P0001'].includes(result.error.code))
    fail(409, 'The plan, payment method or invoice changed. Refresh and review the current details.');
  if (result.error.code === 'P0002') fail(404, 'Plan not found.');
  fail(503, 'Monthly invoicing is temporarily unavailable.');
}
const hash = object => createHash('sha256').update(JSON.stringify(object)).digest('hex');
const goodsMethods = async (db,env,country) => (await checkout.methods(db,env,country)).filter(m=>['goods','both'].includes(m.sale_scope));
const readCatalog = deps => deps.catalog || JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));

async function invoicePayment(db,env,user,body,deps) {
  const row = checked(await db.from('commerce_invoices').select('id,status,public_order_number,total_cents,currency,customer_id,request_data,expires_at,cancellation_requested_at,method_id,payment_snapshot')
    .eq('id',body.id).eq('customer_id',user.id).maybeSingle());
  if (!row || row.request_data?.payment_choice !== 'per_invoice') fail(404,'Monthly invoice not found.');
  const result = {id:row.id,reference:row.public_order_number,total_cents:row.total_cents,currency:row.currency,status:row.status};
  if (row.status !== 'accepted' || row.cancellation_requested_at || !(Date.parse(row.expires_at)>Date.now())) {
    if (body.action==='select_payment') fail(409,'This invoice is closed for payment.');
    return {...result,closed:true};
  }
  const methods = await goodsMethods(db,env,row.request_data.address.country);
  if (row.method_id) {
    const m=methods.find(m=>m.id===row.method_id);
    if (!m || (body.action==='select_payment' && body.method_id!==m.id)) fail(409,'Review the payment method already selected for this invoice.');
    const snapshot=row.payment_snapshot;
    if (m.kind==='interac') {
      if (m.version!==snapshot.method_version) fail(409,'Contact PURE for current transfer instructions.');
      return {...result,transfer:{amount_cents:snapshot.settlement_cents,currency:'CAD',payee:snapshot.payee,instructions:snapshot.instructions,reference:snapshot.payment_reference}};
    }
    return {...result,payment_path:'/pay.html?invoice='+row.id};
  }
  if (body.action==='payment_options') return {...result,methods:checkout.publicMethods(methods)};
  const method = methods.find(m=>m.id===body.method_id);
  if (!method || body.total_cents!==row.total_cents) fail(409,'Review the current invoice total and payment methods.');
  let fx=null;
  if (method.kind==='interac') {
    const {token,...rate}=await (deps.interacFx||require('./interac-fx')).resolve({env,fetchImpl:deps.fetchImpl,now:deps.now});
    fx=rate;
  }
  checked(await db.rpc('pure_repeat_choose_payment',{p_owner:user.id,p_invoice:row.id,p_method:method.id,p_version:method.version,p_total:row.total_cents,p_fx:fx}));
  return invoicePayment(db,env,user,{...body,action:'payment_options'},deps);
}
async function handle(req,res,deps={}) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Vary','Authorization');
  try {
    const db = deps.db || require('./inventory-db').inventoryDb();
    const params = new URL(req.url, 'https://getpurelabs.com').searchParams;
    const env = deps.env || process.env;
    if (req.method === 'GET' && params.get('repeat_orders') === 'status') {
      const r = await db.rpc('pure_repeat_ready');
      const available = !r.error && r.data === true && (await goodsMethods(db,env)).length>0;
      return res.status(200).json({available});
    }
    let body;
    if (req.method==='POST') {
      if (!isAllowedOrigin(req.headers.origin,env.SITE_URL)) fail(403,'Origin not allowed.');
      if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') fail(415,'JSON required.');
      body=parseBody(req.body);
      if (body.action==='preview') {
        return res.json(pricedBasket(body.kind,body.items,readCatalog(deps),String(body.country||'').toUpperCase(),await delivery.load(db),body.protection===true));
      }
    }
    const publicCheckout=req.method==='GET' && params.get('repeat_orders')==='checkout';
    const match=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization || '');
    const auth=match && await db.auth.getUser(match[1]);
    const user=auth?.data?.user;
    if (!publicCheckout && (auth?.error || !user?.email_confirmed_at || !user.email)) fail(401,'Sign in with a verified PURE account.');
    if (req.method==='GET') {
      const methods=checkout.publicMethods(await goodsMethods(db,env));
      const plans=publicCheckout?[]:checked(await db.rpc('pure_repeat_list',{p_owner:user.id}));
      const protection=(await delivery.load(db)).find(x=>x.id==='protection'&&x.enabled);
      return res.json({methods,plans,terms:planTerms,protection_cents:protection?.price_cents??null,catalog:readCatalog(deps).filter(p=>p.category==='injectables').map(({id,name,category,variants})=>({id,name,category,variants:variants.map(({size})=>({size}))}))});
    }
    if (req.method!=='POST') {res.setHeader('Allow','GET, POST');fail(405,'Use GET or POST.');}
    if (!uuid.test(body.id || '')) fail(400,'A valid reference is required.');
    if (['payment_options','select_payment'].includes(body.action)) return res.json(await invoicePayment(db,env,user,body,deps));
    if (['pause','resume','cancel','skip'].includes(body.action)) {
      if (!Number.isSafeInteger(body.version)) fail(400,'Refresh the plan before changing it.');
      return res.json(checked(await db.rpc('pure_repeat_manage',{p_owner:user.id,p_id:body.id,p_action:body.action,p_version:body.version})));
    }
    if (!['quote','enroll','change'].includes(body.action)) fail(400,'Choose a valid monthly order action.');
    const catalog = readCatalog(deps);
    const country = String(body.address?.country || '').toUpperCase();
    const methods = await goodsMethods(db,env,country);
    const method = methods.find(m => m.id === body.method_id);
    if (!method) fail(409,'Choose an available payment method for this destination.');
    const result = pricedBasket(body.kind,body.items,catalog,country,await delivery.load(db),body.protection===true);
    let record;
    await commerce.requestInvoice({rpc:async (_name,args) => {record=args.p_data;return {data:{}};}},user,{
      ...body, kind:'goods', consent:body.action==='quote' || body.consent===true,
      research_use:body.action==='quote' || body.research_use===true,terms_version:terms.version,
    },catalog);
    if (body.billing) {
      const billing=commerce.invoiceAddress(body.billing.address);
      if (!checkoutConfig.shipping_countries.includes(billing.country)) fail(400,'Choose an available billing country.');
      const name=String(body.billing.name||'').trim();
      if (!name || name.length>120) fail(400,'Enter your billing name.');
      record.request.billing={name,address:billing};
    }
    const snapshot = {payment_choice:'per_invoice',kind:body.kind,terms:planTerms,request:record.request,pricing:result.pricing,
      total_cents:result.total_cents};
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
