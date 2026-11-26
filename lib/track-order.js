'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { emailSender } = require('./brand-display');
const { enforceRateLimit, isAllowedOrigin, parseBody, rateKey } = require('./checkout-security');
const { trackingUrl } = require('./customer-order-email');
const { email, networkKey } = require('./guest-checkout');
const { emailLayout, escapeHtml, SUPPORT_EMAIL } = require('./order-email-layout');
const { sendEmail } = require('./resend-email');

const ORDER_NUMBER = /^[A-Z0-9-]{4,40}$/;
const CURRENT_REFERENCE = /^P\d{8}$/;
const OLD_INVOICE_REFERENCE = /^AP[0-9A-F]{10}$/;
const FIELDS = 'customer_email,tracking_carrier,tracking_number';
const RESULT = { message: 'If the order matches, we’ll email its current status and any tracking details to the address used at checkout.' };

const COMMERCE_STATES = {
  requested: 'Order received', issued: 'Awaiting payment', accepted: 'Awaiting payment',
  paid: 'Payment confirmed', processing: 'Preparing for shipment', shipped: 'Shipped',
  delivered: 'Delivered', void: 'Canceled', refunded: 'Refunded'
};
const LEGACY_STATES = {
  unfulfilled: 'Preparing for shipment', processing: 'Preparing for shipment',
  awaiting_supplier: 'Preparing for shipment', partially_shipped: 'Partially shipped',
  shipped: 'Shipped', delivered: 'Delivered', canceled: 'Canceled'
};

async function findOrder(db, reference, address) {
  const legacy = db.from('store_orders').select(`payment_status,fulfillment_status,${FIELDS}`)
    .eq('order_number', reference).limit(2);
  let invoice;
  if (CURRENT_REFERENCE.test(reference)) {
    invoice = db.from('commerce_invoices').select(`status,${FIELDS}`).eq('kind', 'goods')
      .eq('public_order_number', reference).limit(2);
  } else if (OLD_INVOICE_REFERENCE.test(reference)) {
    // Pre-numbering notifications used the first ten hexadecimal digits of the invoice UUID.
    const prefix = reference.slice(2, 10).toLowerCase() + '-' + reference.slice(10).toLowerCase();
    invoice = db.from('commerce_invoices').select(`status,${FIELDS}`).eq('kind', 'goods')
      .is('public_order_number', null).gte('id', prefix + '00-0000-0000-000000000000')
      .lte('id', prefix + 'ff-ffff-ffff-ffffffffffff').limit(2);
  }
  const [orders, invoices] = await Promise.all([legacy, invoice || { data: [] }]);
  if (orders.error || invoices.error) throw Error('Order lookup is unavailable.');
  const matches = [...(orders.data || []), ...(invoices.data || [])]
    .filter(row => typeof row.customer_email === 'string' && row.customer_email.trim().toLowerCase() === address);
  return matches.length === 1 ? matches[0] : null;
}

function orderStatus(order) {
  if (order.status) return COMMERCE_STATES[order.status] || 'Order received';
  if (order.fulfillment_status === 'canceled') return 'Canceled';
  if (order.payment_status === 'refunded') return 'Refunded';
  if (['failed', 'expired'].includes(order.payment_status)) return 'Payment ' + order.payment_status;
  if (order.payment_status === 'pending') return 'Awaiting payment';
  return LEGACY_STATES[order.fulfillment_status] || 'Order received';
}

function trackingEmail(order, reference, sender) {
  const status = orderStatus(order);
  const number = String(order.tracking_number || '').trim();
  const carrier = String(order.tracking_carrier || '').trim();
  const url = trackingUrl(carrier, number) || (number && /canada\s*post|postes\s*canada/i.test(carrier)
    ? 'https://www.canadapost-postescanada.ca/track-reperage/en/search' : null);
  const details = number ? [carrier && `Carrier: ${carrier}`, `Tracking number: ${number}`].filter(Boolean)
    : ['Carrier tracking is not available yet.'];
  const lines = [`Order number: ${reference}`, `Status: ${status}`, ...details];
  const body = '<h2 style="margin-top:0;color:#111111">Track your order</h2>'
    + lines.map(line => `<p>${escapeHtml(line)}</p>`).join('')
    + (url ? `<p><a href="${escapeHtml(url)}">Track with the carrier</a></p>` : '');
  return {
    from: emailSender(sender), to: [order.customer_email.trim()], reply_to: SUPPORT_EMAIL,
    subject: 'PURE order tracking update',
    text: [...lines, ...(url ? [url] : []), `Support: ${SUPPORT_EMAIL}`].join('\n\n'),
    html: emailLayout({ label: 'Order tracking', body, footer: 'This is a transactional order update.' })
  };
}

async function handle(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const env = deps.env || process.env;
  let reference, address;
  try {
    if (!isAllowedOrigin(req.headers?.origin, env.SITE_URL)) return res.status(403).json({ error: 'Please submit from the PURE tracking page.' });
    if (String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
      return res.status(415).json({ error: 'JSON required.' });
    }
    const body = parseBody(req.body);
    reference = typeof body.order_number === 'string' ? body.order_number.trim().toUpperCase() : '';
    if (!ORDER_NUMBER.test(reference)) return res.status(400).json({ error: 'Enter the order number from your PURE email.' });
    address = email(body.email);
  } catch (error) {
    const status = [400, 413].includes(error.status) ? error.status : 503;
    return res.status(status).json({ error: status === 503 ? 'Tracking is temporarily unavailable. Please contact support.' : error.message });
  }

  try {
    // Previews can use only the explicitly configured QA database and sender.
    const preview = env.VERCEL_ENV === 'preview';
    if (preview && env.SUPABASE_URL !== 'https://sjkctzhxytraaxeyfsea.supabase.co') throw Error('Preview email unavailable.');
    const sender = preview ? env.QA_ORDER_CONFIRMATION_FROM : env.ORDER_CONFIRMATION_FROM;
    const mailEnv = preview ? { ...env, RESEND_API_KEY: env.QA_RESEND_API_KEY } : env;
    const secret = env.CHECKOUT_RATE_LIMIT_SECRET;
    if (!mailEnv.RESEND_API_KEY || !sender || typeof secret !== 'string' || secret.length < 32) {
      throw Error('Tracking email is unavailable.');
    }
    const db = deps.db || require('./inventory-db').inventoryDb();
    const rateLimit = deps.rateLimit || enforceRateLimit;
    await rateLimit(db, 'track-order:network:' + networkKey(req, env), secret);
    await rateLimit(db, 'track-order:email:' + address, secret);
    await rateLimit(db, 'track-order:reference:' + reference, secret);
    const order = await (deps.findOrder || findOrder)(db, reference, address);

    // Deliver only to the stored checkout address. A fixed response window and a
    // shorter mail deadline keep match and miss responses indistinguishable in practice.
    const responseWindow = (deps.delay || delay)(2000);
    if (order) {
      const bucket = Math.floor(Date.now() / 300000);
      const idempotencyKey = 'pure-track-order/' + rateKey(`track-order:${reference}:${address}:${bucket}`, secret);
      const fetchImpl = (url, options) => (deps.fetchImpl || fetch)(url, {
        ...options, signal: AbortSignal.timeout(1700)
      });
      try {
        await (deps.send || sendEmail)(trackingEmail(order, reference, sender), { env: mailEnv, fetchImpl, idempotencyKey });
      } catch {
        // A mail-provider failure cannot reveal whether the order exists.
        console.warn('Tracking email delivery unavailable.');
      }
    }
    await responseWindow;
    return res.status(202).json(RESULT);
  } catch (error) {
    if (error.status === 429) return res.status(429).json({ error: 'Too many tracking requests. Please try again later.' });
    return res.status(503).json({ error: 'Tracking is temporarily unavailable. Please contact support.' });
  }
}

module.exports = { findOrder, handle };
