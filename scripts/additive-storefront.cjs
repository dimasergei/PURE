'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

function homeFaq(site) {
  return [
    ['Who can order from PURE?', 'Orders are for laboratory research by purchasers aged '+site.minimumAge+' or older who meet applicable local requirements. '+site.ruo],
    ['Where can I find a certificate of analysis?', 'Search Lab Testing & COAs by compound, strength, laboratory or report ID. The archive links to original supplier reports.'],
    ['Does a supplier report identify my fulfillment lot?', site.testing.scope+' Contact support with your order number to request documentation for your assigned lot.'],
    ['How do I compare sizes and prices?', 'Select Compare on up to four compounds. Open the comparison to review their available sizes and listed prices together.'],
    ['Which destinations qualify for free shipping?', site.shipping.freeSummary],
    ['When should I expect my order?', site.shipping.processingEstimate+' '+site.shipping.transitEstimate],
    ['Is shipping protection optional?',site.shipping.protectionSummary],
    ['Where can I review quantity pricing?', 'Bulk Orders lets you select quantities by compound and strength and review the applicable merchandise tier before checkout.'],
    ['Can I see my subscription or order history?', 'Sign in to Account with the email used for your order. Open Subscription to manage recurring orders or Orders to review purchases.'],
    ['What is the returns window?', site.returns.summary]
  ].map(([question,answer])=>({question,answer}));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildAddedPages(out, site) {
  const policyShell = fs.readFileSync(path.join(out, 'shipping-policy.html'), 'utf8');
  const shopShell = fs.readFileSync(path.join(out, 'shop.html'), 'utf8');

  function metadata(doc, route, title, description) {
    const address = new URL('/' + route, site.origin || 'https://getpurelabs.com').href;
    doc.title = title + ' | PURE';
    const meta = doc.querySelector('meta[name="description"]') || doc.head.appendChild(doc.createElement('meta'));
    meta.name = 'description';
    meta.content = description;
    const canonical = doc.querySelector('link[rel="canonical"]') || doc.head.appendChild(doc.createElement('link'));
    canonical.rel = 'canonical';
    canonical.href = address;
    for (const [selector,value] of [
      ['meta[property="og:title"],meta[name="twitter:title"]',doc.title],
      ['meta[property="og:description"],meta[name="twitter:description"]',description],
      ['meta[property="og:url"]',address]
    ]) {
      for (const element of doc.querySelectorAll(selector)) element.content = value;
    }
    for (const oldSchema of doc.head.querySelectorAll('script[type="application/ld+json"]')) oldSchema.remove();
  }

  function writePolicy(route, title, description, label, body, schema) {
    const dom = new JSDOM(policyShell);
    const doc = dom.window.document;
    metadata(doc, route, title, description);
    const content = doc.querySelector('main#pure-policy-main .pure-policy-content');
    const kicker = content.querySelector('[data-pure-policy-label]');
    const heading = content.querySelector('#pure-policy-title');
    kicker.textContent = label;
    heading.textContent = title;
    content.replaceChildren(kicker, heading);
    content.insertAdjacentHTML('beforeend',body);
    if (schema) {
      const script = doc.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(schema).replace(/</g,'\\u003c');
      doc.head.append(script);
    }
    const file = path.join(out, route + '.html');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, dom.serialize());
    dom.window.close();
  }

  const faq = homeFaq(site);
  writePolicy('faq','Frequently asked questions',
    'Answers about research materials, lab reports, shipping, order tracking, returns and PURE account features.',
    'CUSTOMER SUPPORT',
    faq.map(({question,answer}) => '<details><summary>' + escapeHtml(question) + '</summary><p>' +
      escapeHtml(answer) + '</p></details>').join('') +
    '<p><a href="/coas">Lab Testing &amp; COAs</a> · <a href="/contact">Contact PURE</a></p>',
    {'@context':'https://schema.org','@type':'FAQPage',mainEntity:faq.map(({question,answer})=>({
      '@type':'Question',name:question,acceptedAnswer:{'@type':'Answer',text:answer}
    }))});

  // The baseline router reads location.pathname on every refresh. For this entry
  // only, run the very same shop renderer while preserving /cart in the address bar.
  const dom = new JSDOM(shopShell);
  const doc = dom.window.document;
  metadata(doc,'cart','Your cart','Review your saved PURE cart, available shipping and order total.');
  let robots = doc.querySelector('meta[name="robots"]');
  if (!robots) {robots=doc.createElement('meta');robots.name='robots';doc.head.append(robots);}
  robots.content='noindex,follow';
  const client = doc.querySelector('script[src^="/storefront-v2.js"]');
  const source = fs.readFileSync(path.join(out,'storefront-v2.js'),'utf8');
  const shopRoute = "const route=()=>location.pathname.replace(/\\.html$/,'').replace(/\\/$/,'')||'/';";
  if (!client || !source.includes(shopRoute)) throw Error('Unable to use original shop client for the cart entry.');
  fs.writeFileSync(path.join(out,'saved-cart-storefront.js'),source.replace(shopRoute,"const route=()=>'/shop';"));
  client.src=client.getAttribute('src').replace('/storefront-v2.js','/saved-cart-storefront.js');
  const entry = doc.createElement('script');
  entry.src='/saved-cart-entry.js';
  doc.body.append(entry);
  fs.writeFileSync(path.join(out,'cart.html'),dom.serialize());
  fs.copyFileSync(path.join(__dirname,'saved-cart-entry.js'),path.join(out,'saved-cart-entry.js'));
  dom.window.close();
}

module.exports = {buildAddedPages};
