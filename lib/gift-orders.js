'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { isAllowedOrigin, parseBody, configuredOrigin } = require('./checkout-security');
const { emailSender } = require('./brand-display');
const { sendEmail } = require('./resend-email');

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const store = 'pure_gift_orders';
const columns = 'id,purchaser_id,purchaser_email,recipient_email,recipient_name,note,amount_cents,send_date,status,method_id,payment,payment_reference,refund_reference,notification_status,notification_round,created_at';
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function checked(reply) {
  if (!reply.error) return reply.data;
  const code = reply.error.code;
  if (code === 'P0002') fail(404, 'Gift card unavailable.');
  if (code === '23505') fail(409, 'That reference is already used. Check the existing order.');
  if (code === 'P0001') fail(409, reply.error.message);
  if (['22023','22P02','22007','23514','23502'].includes(code)) fail(400, 'Check the submitted gift card details.');
  fail(503, 'Gift cards are temporarily unavailable. Please try again.');
}
function today() { return new Date().toISOString().slice(0, 10); }
function ref(id) { return 'G-' + id.replace(/-/g,'').toUpperCase(); }
function view(row, purchase = false) {
  return {
    id: row.id, reference: ref(row.id), status: row.status, amount_cents: row.amount_cents,
    recipient_email: row.recipient_email, purchaser_email: row.purchaser_email, send_date: row.send_date,
    note: row.note, recipient_name: row.recipient_name,
    ...(purchase ? { payment: row.status === 'pending' ? row.payment : null } : {})
  };
}
function textField(raw, max, multiline = false) {
  if (raw == null) return '';
  if (typeof raw !== 'string' || raw.length>max || (multiline ? /[\u0000]/ : /[\u0000-\u001f]/).test(raw)) {
    fail(400,'Check your recipient and message.');
  }
  return raw.trim();
}
function normalize(input, user) {
  if (!uuid.test(input.request_id) || input.consent !== true || !['self','gift'].includes(input.mode)) fail(400,'Confirm your gift card details.');
  if (!Number.isInteger(input.amount_cents) || input.amount_cents<2500 || input.amount_cents>100000) fail(400,'Enter $25 to $1,000 USD.');
  const self = input.mode === 'self';
  const purchaser = user.email.trim().toLowerCase();
  const recipient = self ? purchaser : textField(input.recipient_email,254).toLowerCase();
  if (!email.test(recipient) || (!self && recipient !== textField(input.confirm_email,254).toLowerCase())) fail(400,'Enter and confirm the recipient email.');
  const rawDate = textField(input.send_date,10);
  if (rawDate) {
    const d = new Date(rawDate + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || !Number.isFinite(+d) || d.toISOString().slice(0,10)!==rawDate) fail(400,'Enter a valid delivery date.');
  }
  const data = { id: input.request_id.toLowerCase(), purchaser_id: user.id, purchaser_email: purchaser,
    recipient_email: recipient, recipient_name: self ? '' : textField(input.recipient,80), note: self ? '' : textField(input.note,250,true),
    amount_cents: input.amount_cents, send_date: rawDate, consent: true };
  const digest=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return { ...data, digest, send_date: rawDate || today() };
}

function wires(db) {
  return db.from('commerce_payment_methods').select('id,label,version').eq('active',true).eq('kind','bank_transfer')
    .eq('provider_key','bank_transfer').eq('currency','USD').eq('sale_scope','both').is('native_provider',null);
}
async function receivingMethod(db, env) {
  const terms=require('../config/launch-commercial-terms.json');
  if (!terms.gift_cards_enabled || !env.RESEND_API_KEY || !env.ORDER_CONFIRMATION_FROM || !env.SITE_URL || (env.COMMERCE_NOTIFICATION_JOB_SECRET || '').length<32) return null;
  let q = wires(db);
  if (env.PURE_GIFT_WIRE_METHOD_ID) q=q.eq('id',env.PURE_GIFT_WIRE_METHOD_ID);
  const [method, readiness] = await Promise.all([q.limit(2),db.rpc('pure_gift_delivery_ready')]);
  const methods = checked(method);
  return checked(readiness)===true && methods.length===1 ? methods[0] : null;
}
function pageOffset(req) {
  const value=new URL(req.url,'https://account.internal').searchParams.get('offset') || '0';
  if (!/^\d{1,6}$/.test(value)||Number(value)>100000) fail(400,'Invalid page.');
  return Number(value);
}
async function userFor(db, req) {
  const bearer=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization||'');
  if (!bearer) fail(401,'Sign in to manage gift cards.');
  const {data,error}=await db.auth.getUser(bearer[1]);
  if (error || !data?.user?.id || !data.user.email || !data.user.email_confirmed_at) fail(401,'Sign in with a verified account.');
  return data.user;
}
async function transition(db,id,action,data) {
  return checked(await db.rpc('pure_gift_transition',{p_id:id,p_action:action,p_data:data}));
}
async function notify(db,id,env,deps) {
  const row=checked(await db.from(store).select(columns).eq('id',id).maybeSingle());
  if (!row || !['funded','claimed'].includes(row.status) || row.notification_status==='accepted') return row?.notification_status;
  const lease=randomUUID();
  const attempt=await transition(db,id,'notify_claim',{lease});
  if (attempt!=='send') return attempt==='review' ? 'review' : row.notification_status;
  const link=configuredOrigin(env.SITE_URL)+'/gift-cards';
  try {
    const sent=await (deps.sendEmail || sendEmail)({
      from:emailSender(env.ORDER_CONFIRMATION_FROM),to:[row.recipient_email],subject:'Your PURE gift card',
      text:[row.recipient_name ? 'Hello '+row.recipient_name+',' : 'Hello,','',
        'A USD '+(row.amount_cents/100).toFixed(2)+' PURE gift card was purchased for this email address.',
        row.note ? '\nGift message: '+row.note+'\n' : '',
        'Sign in with this email to see the current status and claim available credit: '+link,
        'Gift reference: '+ref(row.id)].filter(Boolean).join('\n')
    },{env,idempotencyKey:'pure-gift/'+id+'/'+row.notification_round});
    await transition(db,id,'notify_accepted',{provider_id:sent.id,lease});
    return 'accepted';
  } catch {
    await transition(db,id,'notify_failed',{lease});
    return 'failed';
  }
}
async function handle(req,res,action,deps={}) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Vary','Authorization, Cookie');
  const env=deps.env || process.env;
  try {
    const methods={availability:['GET'],account:['GET'],create:['POST'],claim:['POST'],cancel:['POST'],worker:['POST'],admin:['GET','POST']};
    if (!Object.hasOwn(methods,action)) fail(404,'Gift card action unavailable.');
    if (!methods[action].includes(req.method)) {res.setHeader('Allow',methods[action].join(', '));fail(405,'Method not allowed.');}
    const db=deps.db || require('./inventory-db').inventoryDb();
    if (action==='availability') {
      let method;
      try { method=await receivingMethod(db,env); } catch { method=null; }
      return res.status(200).json({available:!!method,currency:'USD',payment_label:method?.label || null});
    }
    if (action==='worker') {
      const proof=require('./invoice-worker-auth').verify(req.headers,env.COMMERCE_NOTIFICATION_JOB_SECRET,Date.now(),'gift-email-retry');
      if (!proof) fail(401,'Unauthorized.');
      if (checked(await db.rpc('commerce_consume_notification_job',{p_nonce:proof.nonce,p_issued_at:proof.issued_at}))!==true) fail(409,'Job already consumed.');
      const due=checked(await db.from(store).select('id').in('status',['funded','claimed']).in('notification_status',['waiting','failed'])
        .lte('send_date',today()).lte('notify_after',new Date().toISOString()).order('notify_after').limit(5));
      const results=await Promise.allSettled(due.map(row=>notify(db,row.id,env,deps)));
      return res.status(200).json({attempted:due.length,accepted:results.filter(r=>r.status==='fulfilled'&&r.value==='accepted').length});
    }
    let body;
    if (req.method==='POST') {
      if (!isAllowedOrigin(req.headers.origin,env.SITE_URL)) fail(403,'Origin not allowed.');
      if (String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json') fail(415,'JSON required.');
      body=parseBody(req.body);
    }
    if (action==='admin') {
      await (deps.assertAdmin || require('./admin-auth').assertAdmin)(req,deps);
      if (req.method==='GET') {
        const offset=pageOffset(req);
        const rows=checked(await db.from(store).select(columns).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+100));
        return res.status(200).json({orders:rows.slice(0,100).map(row=>({...view(row),notification_status:row.notification_status,
          payment_reference:row.payment_reference,refund_reference:row.refund_reference})),has_more:rows.length>100,offset});
      }
      if (!uuid.test(body.id) || !['fund','refund_finish','refund_start','notify'].includes(body.action)) fail(400,'Invalid admin gift card action.');
      if (body.action==='notify') {
        if (body.confirmed===true) await transition(db,body.id,'notify_reset',{confirmed:true});
        return res.status(200).json({notification_status:await notify(db,body.id,env,deps)});
      }
      const status=await transition(db,body.id,body.action,{reference:textField(body.reference,150),amount_cents:body.amount_cents,
        confirmed:body.confirmed===true,currency:body.currency});
      let notification_status;
      if (body.action==='fund') {
        try { notification_status=await notify(db,body.id,env,deps); }
        catch { notification_status='waiting'; } // Funding has already committed. The worker will retry delivery.
      }
      return res.status(200).json({status,notification_status});
    }
    const user=await userFor(db,req);
    if (action==='account') {
      const offset=pageOffset(req);
      const ordered=q=>q.order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+100);
      const [purchases,received]=await Promise.all([ordered(db.from(store).select(columns).eq('purchaser_id',user.id)),
        ordered(db.from(store).select(columns).eq('recipient_email',user.email.trim().toLowerCase()).lte('send_date',today())
          .or('status.eq.funded,and(status.eq.claimed,claimed_by.eq.'+user.id+')'))]);
      const buying=checked(purchases),gifts=checked(received);
      const ids=[...new Set(buying.filter(row=>row.status==='pending').map(row=>row.method_id))];
      const valid=ids.length ? checked(await wires(db).in('id',ids)) : [];
      return res.status(200).json({purchases:buying.slice(0,100).map(row=>{
        const data=view(row,true);
        if (data.payment && !valid.some(method=>method.id===row.method_id && method.version===row.payment.version)) data.payment=null;
        return data;
      }),received:gifts.slice(0,100).map(row=>view(row)),offset,has_more:buying.length>100||gifts.length>100});
    }
    if (action==='cancel') {
      if (!uuid.test(body.id) || body.confirmed!==true) fail(400,'Confirm cancellation of the unpaid order.');
      const status=await transition(db,body.id,'cancel',{customer_id:user.id,confirmed:true});
      return res.status(200).json({status});
    }
    if (action==='claim') {
      if (!uuid.test(body.id)) fail(400,'Invalid gift card.');
      const status=await transition(db,body.id,'claim',{customer_id:user.id,email:user.email});
      const order=checked(await db.from(store).select('amount_cents').eq('id',body.id).single());
      return res.status(200).json({status,amount_cents:order.amount_cents});
    }
    const data=normalize(body,user);
    const method=await receivingMethod(db,env);
    if (!method) fail(409,'Gift card purchases are currently unavailable.');
    const id=checked(await db.rpc('pure_gift_create',{p_data:{...data,method_id:method.id}}));
    const row=checked(await db.from(store).select(columns).eq('id',id).eq('purchaser_id',user.id).single());
    const order=view(row,true);
    if (order.payment && (row.method_id!==method.id || row.payment.version!==method.version)) order.payment=null;
    return res.status(200).json({order});
  } catch(error) {
    const status=[400,401,403,404,405,409,413,415,429,503].includes(error.status) ? error.status : 503;
    return res.status(status).json({error:status===503 ? 'Gift cards are temporarily unavailable. Please try again or contact support.' : error.message});
  }
}
module.exports={handle};
