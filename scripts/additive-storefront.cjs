'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const guides = [
  {
    slug: 'reading-a-coa',
    title: 'How to read a certificate of analysis',
    description: 'Match a research sample to its report, check the units and read the scope of the laboratory result.',
    sections: [
      ['Match the sample first', 'Begin with the identifier on the vial or carton. Find the sample identifier and lot or batch on the certificate, then compare the compound name and declared size. A familiar product name alone cannot establish that the laboratory tested the material in your shipment.'],
      ['Read across the result', 'Look for the test name, method, result and unit on the same row. If the report provides an acceptance limit, compare the result with that limit in the same units. A mass in milligrams and a relative percentage answer different questions. A blank result is an unknown, even when neighboring rows have values.'],
      ['Keep the original with your record', 'Capture the issuer, report number and issue date. Open the original pages from the archive, including any appendices, and retain the version you reviewed. When the archive identifies a document as a supplier reference, record that relationship. Ask PURE for a lot match if you need evidence for a specific shipment.']
    ],
    source: ['World Health Organization · Content of an analytical test report, Appendix 2', 'https://cdn.who.int/media/docs/default-source/medicines/norms-and-standards/guidelines/distribution/trs966-annex7-who-guidelines-on-the-conduct-of-surveys-of-the-quality-of-medicines.pdf']
  },
  {
    slug: 'understanding-purity-results',
    title: 'What a reported purity result measures',
    description: 'Read purity, identity and assay results in context when comparing supplier reports for research materials.',
    sections: [
      ['Identify the measurement', 'Start with the column heading and the method. A chromatographic area percentage describes the relative detector response assigned to a peak under the method used. It does not, on its own, tell you how many milligrams of material are present. If the report gives an assay result, read its units and basis separately.'],
      ['Look for supporting evidence', 'When the issuer supplies a chromatogram, compare its sample identifier and peak table with the results page. If a report also includes an identity measurement, such as mass spectrometry, look for the stated conclusion and the sample it covers. Each measurement answers a particular analytical question.'],
      ['Compare reports on the same basis', 'Check that the methods, units and stated purpose are comparable before interpreting a difference between percentages. Record what the issuer actually reported. Sterility and endotoxin require their own evidence; a purity percentage cannot fill either field.']
    ],
    source: ['International Council for Harmonisation · Q2(R2), Validation of Analytical Procedures', 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q2r2-validation-analytical-procedures']
  },
  {
    slug: 'storage-and-records',
    title: 'Storage records for research materials',
    description: 'Document receipt, lot identity and the supplier’s storage information for research-use-only materials.',
    sections: [
      ['Start at receipt', 'Record the date, item name, declared size, lot identifier and the condition of the package. Keep the label and shipping documentation together. If the seal appears damaged or identifiers disagree, document the discrepancy and contact the supplier before releasing the material into laboratory inventory.'],
      ['Use the instructions for the specific material', 'Consult the original label and the written storage information for that item and lot. Record the stated conditions and the document version. A general catalog description or a certificate for another lot cannot establish shelf life or an appropriate temperature for your material. Request written clarification when information is missing.'],
      ['Make the history traceable', 'Keep the receipt record, original certificate and any reported storage deviations together. Record who reviewed a discrepancy and the supplier’s response. This gives the next person handling the inventory a way to distinguish a documented condition from an assumption.']
    ],
    source: ['World Health Organization · Good storage and distribution practices, documentation and records', 'https://www.who.int/docs/default-source/medicines/norms-and-standards/guidelines/distribution/trs1025-annex7-%281%29.pdf']
  }
];

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
    ['Can I see my subscription or order history?', 'Sign in to Account with the email used for your order. Open Monthly orders to manage recurring orders or Orders to review purchases.'],
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

  const guideList = guides.map(g => '<li><a href="/learn/' + g.slug + '">' + escapeHtml(g.title) +
    '</a><p>' + escapeHtml(g.description) + '</p></li>').join('');
  writePolicy('learn','Research documentation guides',
    'Read laboratory reports, compare measurements and keep traceable records for research-use-only materials.',
    'RESEARCH GUIDES',
    '<p>For laboratories reviewing research-use-only materials.</p><ul>' + guideList +
    '</ul><p><a href="/coas">Lab Testing &amp; COAs</a> · <a href="/shop">Research catalog</a></p>');

  for (const guide of guides) {
    const related = guides.filter(other => other !== guide).map(other =>
      '<li><a href="/learn/' + other.slug + '">' + escapeHtml(other.title) + '</a></li>').join('');
    const sections = guide.sections.map(([heading,copy]) => '<section><h2>' + escapeHtml(heading) +
      '</h2><p>' + escapeHtml(copy) + '</p></section>').join('');
    writePolicy('learn/' + guide.slug, guide.title, guide.description, 'RESEARCH GUIDES',
      '<p>' + escapeHtml(guide.description) + '</p>' + sections +
      '<p><a href="' + escapeHtml(guide.source[1]) + '">' + escapeHtml(guide.source[0]) + '</a></p>' +
      '<h2>Related documentation</h2><ul><li><a href="/coas">Browse the original laboratory reports</a></li>' +
      related + '</ul><p>' + escapeHtml(site.ruo) + '</p><a class="back" href="/learn">All research guides</a>');
  }
  const faq = homeFaq(site);
  writePolicy('faq','Frequently asked questions',
    'Answers about research materials, lab reports, shipping, order tracking, returns and PURE account features.',
    'CUSTOMER SUPPORT',
    faq.map(({question,answer}) => '<details><summary>' + escapeHtml(question) + '</summary><p>' +
      escapeHtml(answer) + '</p></details>').join('') +
    '<p><a href="/coas">Lab Testing &amp; COAs</a> · <a href="/learn">Research guides</a> · <a href="/contact">Contact PURE</a></p>',
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
  client.src='/saved-cart-storefront.js';
  const entry = doc.createElement('script');
  entry.src='/saved-cart-entry.js';
  doc.body.append(entry);
  fs.writeFileSync(path.join(out,'cart.html'),dom.serialize());
  fs.copyFileSync(path.join(__dirname,'saved-cart-entry.js'),path.join(out,'saved-cart-entry.js'));
  dom.window.close();
}

module.exports = {buildAddedPages};
