'use strict';

const { enforceRateLimit, isAllowedOrigin, parseBody, rateKey } = require('./checkout-security');
const { sendEmail } = require('./resend-email');
const { promotions } = require('../config/checkout.json');

async function emailCoupon(email, origin, env, fetchImpl) {
  const from = env.ORDER_CONFIRMATION_FROM?.trim();
  if (!env.RESEND_API_KEY || !from || env.VERCEL_ENV === 'preview') return false;
  const { coupon, coupon_discount_bps } = promotions;
  const discount = coupon_discount_bps / 100;
  try {
    await sendEmail({
      from,
      to: [email],
      subject: `Your PURE CLUB ${discount}% off code`,
      text: `Thanks for joining PURE CLUB. Use ${coupon} at checkout for ${discount}% off eligible merchandise.\n\nShop all compounds\n${origin}/shop`
    }, {
      env,
      fetchImpl,
      idempotencyKey: 'pure-club/' + rateKey(coupon + ':' + email, env.CHECKOUT_RATE_LIMIT_SECRET)
    });
    return true;
  } catch {
    return false;
  }
}

async function handle(req, res, deps = {}) {
  const env = deps.env || process.env;
  if (!isAllowedOrigin(req.headers.origin, env.SITE_URL)) return res.status(403).json({ error: 'Origin not allowed.' });
  if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') {
    return res.status(415).json({ error: 'JSON required.' });
  }
  try {
    const body = parseBody(req.body);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (body.consent !== true || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter an email address and confirm consent.' });
    }
    const db = deps.db || require('./inventory-db').inventoryDb();
    const address = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].slice(0, 100);
    await (deps.rateLimit || enforceRateLimit)(db, 'campaign-signup:' + address, env.CHECKOUT_RATE_LIMIT_SECRET);
    const { error } = await db.from('commerce_campaign_signups').insert({ email });
    if (error && error.code !== '23505') throw Error('Signup storage unavailable.');
    const result = { code: promotions.coupon };
    if (body.source === 'pure-club') {
      result.email_sent = await emailCoupon(email, req.headers.origin, env, deps.fetchImpl);
    }
    return res.status(200).json(result);
  } catch (error) {
    const status = [400, 413, 429].includes(error.status) ? error.status : 503;
    return res.status(status).json({ error: status === 503 ? 'Signup is temporarily unavailable.' : error.message });
  }
}

module.exports = { handle };
