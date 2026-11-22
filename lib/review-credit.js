'use strict';

const { isAllowedOrigin, parseBody } = require('./checkout-security');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

async function handle(req, res, deps = {}) {
  const env = deps.env || process.env;
  if (!isAllowedOrigin(req.headers.origin, env.SITE_URL)) return res.status(403).json({ error: 'Origin not allowed.' });
  if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') {
    return res.status(415).json({ error: 'JSON required.' });
  }
  const token = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization || '');
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

  try {
    const db = deps.db || require('./inventory-db').inventoryDb();
    const { data, error } = await db.auth.getUser(token[1]);
    if (error || !data?.user?.email_confirmed_at) return res.status(401).json({ error: 'Sign in with a verified email.' });
    const body = parseBody(req.body);
    const customer = data.user.id;
    let result;
    if (body.action === 'submit' && UUID.test(body.invoice_id || '') && [1, 2, 3, 4, 5].includes(body.rating)) {
      result = await db.rpc('commerce_submit_review', { p_customer: customer, p_invoice: body.invoice_id, p_rating: body.rating });
    } else if (body.action === 'redeem' && UUID.test(body.code || '')) {
      result = await db.rpc('commerce_redeem_review_credit', { p_customer: customer, p_code: body.code });
    } else {
      return res.status(400).json({ error: 'Enter a valid review or credit code.' });
    }
    if (result.error?.code === '22023') return res.status(409).json({ error: 'This review or credit is unavailable.' });
    if (result.error) throw Error('Review storage unavailable.');
    return res.status(200).json(result.data);
  } catch (error) {
    const status = [400, 413].includes(error.status) ? error.status : 503;
    return res.status(status).json({ error: status === 503 ? 'Reviews are temporarily unavailable.' : error.message });
  }
}

module.exports = { handle };
