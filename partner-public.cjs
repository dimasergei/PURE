'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {partner} = require('./config/conversion.json');
const {affiliateMinimum} = require('./lib/order-thresholds');

const percent = bps => (bps / 100) + '%';
const dollars = cents => '$' + (cents / 100).toLocaleString('en-US');
const firstRate = percent(partner.first_order_bps);
const repeatRate = percent(partner.repeat_order_bps);
const customerRate = percent(partner.customer_discount_bps);
const codeMinimum = dollars(affiliateMinimum);
const payoutMinimum = dollars(partner.minimum_payout_cents);
const description = `Refer laboratory research organizations to PURE. Earn ${firstRate} on a new customer’s first qualifying merchandise order and ${repeatRate} on later qualifying orders.`;
const markup = `<section class="nl-wide-hero nl-partner-hero"><div class="ap-container">
  <span class="nl-capsule">PURE PARTNER PROGRAM</span>
  <h1>GOOD RESEARCH GROWS<br><em>THROUGH GOOD CONNECTIONS.</em></h1>
  <p>Introduce new research teams to PURE. Earn a commission on their first qualifying order and each qualifying order that follows.</p>
  <div class="nl-partner-actions"><a class="ap-button nl-primary" href="/account/partner">Join the partner program</a><a class="ap-button ap-button-secondary" href="/partner-terms.html">Read partner terms</a></div>
</div></section>
<section class="ap-container nl-partner-rates">
  <article><span>FIRST ELIGIBLE ORDER</span><strong>${firstRate}</strong><small>Partner commission</small></article>
  <article><span>FUTURE ELIGIBLE ORDERS</span><strong>${repeatRate}</strong><small>Partner commission</small></article>
</section>
<section class="ap-container nl-partner-steps">
  <div class="nl-partner-section-head"><span class="ap-eyebrow">HOW IT WORKS</span><h2>From referral to payout.</h2></div>
  <div class="nl-partner-step-grid">
    <article><span>01</span><h3>Join</h3><p>Sign in with a verified PURE account, accept the terms and choose your referral code. Enrollment is free.</p></article>
    <article><span>02</span><h3>Refer a research team</h3><p>Share your link with laboratory research organizations and disclose that you earn a commission. The first valid referral link is remembered for ${partner.cookie_days} days.</p></article>
    <article><span>03</span><h3>Track orders</h3><p>A new customer’s first qualifying paid order links them to your account. Follow each commission from pending to eligible to paid in your dashboard.</p></article>
    <article><span>04</span><h3>Receive payouts</h3><p>Delivered orders become eligible on the first day of the following month (UTC). PURE processes monthly payouts manually once your eligible balance reaches ${payoutMinimum} USD.</p></article>
  </div>
</section>
<section class="ap-container nl-partner-details">
  <div><span class="ap-eyebrow">COMMISSION BASIS</span><h2>What earns commission?</h2><p>Commission is calculated on paid merchandise after discounts, points and store credit. Shipping, tax, membership fees and self-referrals are excluded. Refunds, voids and recorded chargebacks reverse the associated commission.</p><a class="ap-text-link" href="/partner-terms.html">Review the full partner terms</a></div>
  <div class="nl-partner-callout"><strong>${customerRate} off</strong><span>Your customer’s first qualifying order</span><p>New customers can follow your link or enter your code. The offer applies to eligible first orders of at least ${codeMinimum} USD in merchandise after discounts. Partner codes cannot be combined with another code or bulk pricing.</p></div>
</section>`;

// The same program markup is embedded in the HTML response and installed in
// the client router. The policy shares the shell but owns its own canonical URL.
function publish(directory, terms) {
  const programFile = path.join(directory, 'partner-program.html');
  const shell = fs.readFileSync(programFile, 'utf8');
  const pages = [
    {file: programFile, route: '/partner-program', title: 'Partner Program | PURE', description, main: markup},
    {file: path.join(directory, 'partner-terms.html'), route: '/partner-terms.html', title: 'Partner Terms | PURE',
      id: 'partner-terms', description: 'Review PURE’s partner enrollment, referral attribution, first-order discounts, commission eligibility, reversals and monthly payout terms.', main: terms}
  ];
  for (const page of pages) {
    const dom = new JSDOM(shell);
    const doc = dom.window.document;
    const canonical = doc.querySelector('link[rel="canonical"]');
    canonical.href = new URL(page.route, canonical.href).href;
    doc.title = page.title;
    doc.querySelector('meta[name="description"]').content = page.description;
    doc.querySelector('meta[property="og:title"]').content = page.title;
    doc.querySelector('meta[property="og:description"]').content = page.description;
    doc.querySelector('meta[property="og:url"]').content = canonical.href;
    const main = doc.getElementById('ap-main');
    main.innerHTML = page.main;
    if (page.id) {
      main.id = page.id;
      doc.querySelector('a[href="#ap-main"]').setAttribute('href', '#' + page.id);
    }
    fs.writeFileSync(page.file, dom.serialize());
    dom.window.close();
  }
}

module.exports = {firstRate, repeatRate, customerRate, codeMinimum, payoutMinimum, markup, publish};
