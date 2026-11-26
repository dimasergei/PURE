'use strict';

const { isAllowedOrigin, parseBody } = require('./checkout-security');

const CAMPAIGN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

async function handle(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const env = deps.env || process.env;
  const campaign = env.PURE_SPIN_CAMPAIGN || '';
  if (!CAMPAIGN.test(campaign)) {
    return req.method === 'GET'
      ? res.status(200).json({ active: false })
      : res.status(404).json({ error: 'Spin & Save is currently closed.' });
  }

  try {
    if (req.method === 'GET') {
      const db = deps.db || require('./inventory-db').inventoryDb();
      const { data, error } = await db.rpc('commerce_spin_campaign', { p_campaign: campaign });
      if (error) throw error;
      return res.status(200).json(data || { active: false });
    }

    const headers = req.headers || {};
    if (!isAllowedOrigin(headers.origin, env.SITE_URL)) {
      return res.status(403).json({ error: 'Origin not allowed.' });
    }
    if (String(headers['content-type'] || '').split(';')[0] !== 'application/json') {
      return res.status(415).json({ error: 'JSON required.' });
    }
    const token = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(headers.authorization || '');
    if (!token) return res.status(401).json({ error: 'Sign in to enter.' });

    const body = parseBody(req.body);
    if (body.eligible !== true || typeof body.terms_version !== 'string' || !VERSION.test(body.terms_version) ||
        !Number.isSafeInteger(body.answer) || Math.abs(body.answer) > 1000000) {
      return res.status(400).json({ error: 'Confirm your eligibility and answer the skill question.' });
    }

    const db = deps.db || require('./inventory-db').inventoryDb();
    const { data: auth, error: authError } = await db.auth.getUser(token[1]);
    if (authError || !auth?.user?.id || !auth.user.email_confirmed_at) {
      return res.status(401).json({ error: 'Sign in with a verified email to enter.' });
    }
    const { data, error } = await db.rpc('commerce_submit_spin', {
      p_campaign: campaign,
      p_customer: auth.user.id,
      p_version: body.terms_version,
      p_answer: body.answer
    });
    if (error?.code === '22023') {
      return res.status(409).json({ error: 'The entry period or rules may have changed. Reload this page and check again.' });
    }
    if (error || !data) throw error || new Error('Missing entry result.');
    return res.status(200).json(data);
  } catch (error) {
    const status = [400, 413].includes(error.status) ? error.status : 503;
    return res.status(status).json({
      error: status === 503 ? 'Spin & Save is temporarily unavailable.' : error.message
    });
  }
}

module.exports = { handle };
