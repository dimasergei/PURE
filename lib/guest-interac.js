'use strict';

const guest = require('./guest-checkout');
const { shortOrder } = require('./order-display');
const paymentPolicy = require('./pure-payment-policy');
const { allowedFor } = require('./payment-provider-options');

async function handle(req, res, id, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET for order status.' });
  }
  const credential = guest.readCredential(req, id, deps.env || process.env);
  if (!credential) return res.status(401).json({ error: 'Open this order in the browser used at checkout, or contact support.' });

  try {
    const db = deps.db || require('./inventory-db').inventoryDb();
    const result = await db.from('commerce_invoices')
      .select('id,public_order_number,kind,status,currency,total_cents,expires_at,cancellation_requested_at,cancellation_status,method_id,request_data,payment_snapshot')
      .eq('id', id).eq('customer_id', credential.id).maybeSingle();
    if (result.error) throw result.error;
    const invoice = result.data;
    if (!invoice || !guest.isGuestInvoice(invoice) || invoice.currency !== 'CAD' ||
      invoice.request_data?.address?.country !== 'CA' ||
      invoice.request_data?.preferred_payment?.provider_key !== 'interac' ||
      !Number.isSafeInteger(invoice.total_cents) || invoice.total_cents <= 0) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    const deadline = Date.parse(invoice.expires_at);
    const isPending = invoice.status === 'accepted' && !invoice.cancellation_requested_at && !invoice.cancellation_status;
    let payment = null;
    let status = invoice.status;
    if (invoice.status === 'accepted' && !isPending) status = 'under_review';
    if (isPending && (!Number.isFinite(deadline) || deadline <= (deps.now || Date.now)())) status = 'expired';
    const snapshot = invoice.payment_snapshot;
    if (status === 'accepted' && snapshot?.kind === 'interac' && snapshot.currency === 'CAD' &&
      typeof snapshot.payee === 'string' && snapshot.payee.trim() &&
      typeof snapshot.instructions === 'string' && snapshot.instructions.trim() &&
      typeof snapshot.payment_reference === 'string' && snapshot.payment_reference.trim()) {
      const method = await db.from('commerce_payment_methods')
        .select('active,kind,currency,provider_key,native_provider,sale_scope,version').eq('id', invoice.method_id).maybeSingle();
      if (method.error) throw method.error;
      if (method.data?.active && allowedFor(method.data, 'goods') && paymentPolicy.kind(method.data) === 'interac' &&
        method.data.version === snapshot.method_version) {
        payment = { payee: snapshot.payee, instructions: snapshot.instructions, reference: snapshot.payment_reference };
      }
    }
    return res.status(200).json({
      order_number: shortOrder(invoice.id, invoice.public_order_number),
      status,
      currency: 'CAD',
      total_cents: invoice.total_cents,
      expires_at: invoice.expires_at,
      payment
    });
  } catch {
    return res.status(503).json({ error: 'Order status is temporarily unavailable. Check again before sending a transfer.' });
  }
}

module.exports = { handle };
