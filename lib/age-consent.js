'use strict';
const cookieKey = 'pure_age';
const consentDays = 30;
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function returnPath(value, origin) {
  if (typeof value !== 'string' || !/^\/(?!\/)/.test(value) || /[\\\r\n]/.test(value)) return '/';
  const url = new URL(value, origin);
  return url.origin === origin && !url.pathname.startsWith('/api/') ? url.pathname + url.search + url.hash : '/';
}
function consentForm(site, path = '/') {
  return `<form action="/api/customer-config?age_gate=confirm" method="post" target="_top" data-pure-consent>
    <input type="hidden" name="returnTo" value="${esc(path)}">
    <p data-age-rules>I confirm that I am ${site.minimumAge} or older and meet any higher local age requirement.</p>
    <p data-age-research>${esc(site.ruo)}</p>
    <div class="pure-age-actions"><button type="submit" class="ap-button" name="consent" value="yes" data-action="age-confirm">Confirm and enter</button>
    <a class="ap-text-button" target="_top" href="/api/customer-config?age_gate=exit" data-action="age-exit">Exit</a></div>
  </form>`;
}
function gateDialog(site, path) {
  return `<dialog id="ap-age-dialog" class="ap-dialog ap-age-dialog" data-cookie="${cookieKey}=${site.minimumAge}-v1" data-days="${consentDays}" aria-labelledby="ap-age-title">
    <span class="ap-eyebrow">PURE · Research materials</span>
    <h2 id="ap-age-title">You must be ${site.minimumAge}+ to enter</h2>
    ${consentForm(site,path)}
    <p><a href="/research-use-policy">Research-use policy</a> · <a href="/terms-and-conditions">Terms and conditions</a></p></dialog>`;
}
function handle(req, res, params) {
  const { site } = require('../config/site.ts');
  const action = params.get('age_gate');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  const value = site.minimumAge + '-v1';
  if (req.method === 'POST' && action === 'confirm') {
    if (req.headers.origin !== site.origin && req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).end();
    const body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body;
    if (body?.consent !== 'yes') return res.status(400).end();
    res.setHeader('Set-Cookie',cookieKey+'='+value+'; Max-Age='+consentDays*86400+'; Path=/; Secure; SameSite=Lax');
    res.setHeader('Location',returnPath(body.returnTo, site.origin));
    return res.status(303).end();
  }
  if (req.method !== 'GET' || !['prompt','exit'].includes(action)) return res.status(405).end();
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'");
  const accepted = (req.headers.cookie || '').split(';').some(entry => entry.trim() === cookieKey+'='+value);
  const message = action === 'exit' ? '<h1>You have left the PURE store.</h1><p>You must meet the entry requirements to continue.</p>' : accepted ? '<p>Age confirmed. You may browse the research catalog.</p>' : '<h2>You must be '+site.minimumAge+'+ to enter</h2>'+consentForm(site,returnPath(params.get('returnTo'),site.origin));
  return res.status(200).send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PURE age verification</title><style>body{font:16px/1.45 system-ui;color:#111;background:#f5f5f5;padding:8px 16px;margin:0}h2,p{margin:6px 0}button,a{display:inline-flex;align-items:center;min-height:44px;padding:0 20px}button{background:#111;color:#fff;border:0;border-radius:28px;font:inherit}a{color:#111}:focus-visible{outline:3px solid #3266a7}</style><main>'+message+'</main></html>');
}
module.exports = { handle, gateDialog, returnPath };
