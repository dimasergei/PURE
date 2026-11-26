'use strict';

const { enforceRateLimit, isAllowedOrigin } = require('./checkout-security');
const { networkKey } = require('./guest-checkout');
const { requireAdmin } = require('./admin-auth');

const excludedClient = /Instagram|FBAN|FBAV|FB_IAB|Threads\/|TikTok|Twitter|LinkedInApp|MicroMessenger|Snapchat|Pinterest/i;
const excludedIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\/|YaBrowser|Brave/i;
const excludedAndroidBrowser = /SamsungBrowser|EdgA\/|OPR\/|Firefox\/|DuckDuckGo|Vivaldi|YaBrowser|Brave|UCBrowser|MiuiBrowser|HuaweiBrowser|; wv\)|Version\/4\.0/i;
const optedOut = headers => headers['sec-gpc'] === '1' || headers.dnt === '1';

function browserGroup(headers = {}) {
  const ua = headers['user-agent'];
  if (optedOut(headers) || typeof ua !== 'string' || ua.length > 1024 || excludedClient.test(ua)) return null;
  if (/\biPhone\b/.test(ua) && /Version\/[\d.]+.*Safari\//.test(ua) && !excludedIosBrowser.test(ua)) {
    return 'iphone_safari';
  }
  if (/\bAndroid\b/.test(ua) && /Chrome\/[\d.]+.*Mobile Safari\//.test(ua) && !excludedAndroidBrowser.test(ua)) {
    const brands = headers['sec-ch-ua'];
    if (typeof brands === 'string' && !brands.includes('"Google Chrome"')) return null;
    return 'android_chrome';
  }
  return null;
}

function checkoutAttribution(req, body, record, now = new Date()) {
  if (record.kind !== 'goods' || record.request.bulk_order || record.request.research_builder_mode ||
      record.request.checkout.coupon === 'CARDTEST' || body.funnel_day !== now.toISOString().slice(0, 10)) return null;
  const browser = browserGroup(req.headers);
  return browser ? { browser, day: body.funnel_day } : null;
}

async function handle(req, res, mode, deps = {}) {
  const env = deps.env || process.env;
  if (mode === 'report') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
    if (!(await requireAdmin(req, res, { ...deps, env }))) return;
    try {
      const db = deps.db || require('./inventory-db').inventoryDb();
      const { data, error } = await db.rpc('pure_mobile_funnel_report');
      if (error || !Array.isArray(data)) throw Error('Mobile checkout report unavailable.');
      return res.status(200).json({ rows: data });
    } catch {
      return res.status(503).json({ error: 'Mobile checkout report unavailable.' });
    }
  }
  if (mode !== 'event') return res.status(404).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    if (!isAllowedOrigin(req.headers.origin, env.SITE_URL)) return res.status(403).end();
    if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') return res.status(415).end();
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 128) return res.status(400).end();
    const event = JSON.parse(raw);
    if (!event || !['cart', 'checkout'].includes(event.stage) || Object.keys(event).length !== 1) return res.status(400).end();
    const browser = browserGroup(req.headers);
    if (!browser) return res.status(204).end();
    const db = deps.db || require('./inventory-db').inventoryDb();
    await (deps.rateLimit || enforceRateLimit)(db, 'mobile-funnel:' + networkKey(req, env), env.CHECKOUT_RATE_LIMIT_SECRET);
    const { error } = await db.rpc('pure_record_mobile_funnel', { p_browser: browser, p_stage: event.stage });
    if (error) throw Error('Measurement unavailable.');
    return res.status(204).end();
  } catch (error) {
    return res.status(error instanceof SyntaxError ? 400 : error.status === 429 ? 429 : 503).end();
  }
}

module.exports = { browserGroup, checkoutAttribution, handle };
