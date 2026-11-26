'use strict';
const { isAllowedOrigin, parseBody } = require('./checkout-security');
const { handleInquiry } = require('./site-inquiry');

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function line(value, max, label) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/u.test(value)) {
    throw invalid('Check ' + label + '.');
  }
  return value.trim();
}

function supportRequest(input, user) {
  const { amount_cents: cents, mode } = input;
  if (!Number.isInteger(cents) || cents < 2500 || cents > 100000) throw invalid('Enter $25 to $1,000 USD.');
  if (!['gift', 'self'].includes(mode)) throw invalid('Select a recipient option.');
  const lines = ['Gift card availability inquiry', 'Requested amount: USD ' + (cents / 100).toFixed(2),
    'For: ' + (mode === 'gift' ? 'a gift' : 'myself')];
  const date = line(input.send_date, 10, 'the preferred date');
  if (date) {
    const parsed = new Date(date + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) {
      throw invalid('Check the preferred date.');
    }
    lines.push('Preferred delivery date: ' + date);
  }
  if (mode === 'gift') {
    const recipient = line(input.recipient, 80, 'the recipient name');
    const email = line(input.recipient_email, 254, 'the recipient email');
    const confirmation = line(input.confirm_email, 254, 'the email confirmation');
    if (email.toLowerCase() !== confirmation.toLowerCase() || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw invalid('Check that the recipient emails match.');
    }
    if (typeof input.note !== 'string' || input.note.length > 250 || input.note.includes('\u0000')) throw invalid('Check the gift message.');
    if (recipient) lines.push('Recipient: ' + recipient);
    if (email) lines.push('Recipient email (for reference only): ' + email);
    if (input.note.trim()) lines.push('Gift message: ' + input.note.trim());
  }
  return { type: 'contact', request_id: input.request_id, name: 'Gift card inquiry', email: user.email, topic: 'Gift card availability',
    message: lines.join('\n'), consent: input.consent, website: input.website };
}

async function handle(req, res, deps = {}) {
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use the gift card request form.' });
  }
  try {
    const env = deps.env || process.env;
    if (!isAllowedOrigin(req.headers.origin, env.SITE_URL)) return res.status(403).json({ error: 'Origin not allowed.' });
    const bearer = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization || '');
    if (!bearer) return res.status(401).json({ error: 'Sign in to request availability.' });
    const db = deps.db || require('./inventory-db').inventoryDb();
    const { data, error } = await db.auth.getUser(bearer[1]);
    if (error || !data?.user?.email_confirmed_at || !data.user.email) {
      return res.status(401).json({ error: 'Sign in with a verified account.' });
    }
    const inquiry = supportRequest(parseBody(req.body), data.user);
    return handleInquiry({ headers: req.headers, socket: req.socket, body: inquiry }, res, { ...deps, db, catalog: [] });
  } catch (error) {
    const status = [400, 413].includes(error.status) ? error.status : 503;
    return res.status(status).json({ error: status === 503 ? 'Please try again or email support@getpurelabs.com.' : error.message });
  }
}

module.exports = { handle };
