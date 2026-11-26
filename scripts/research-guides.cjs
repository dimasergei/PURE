'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

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

function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildGuides(out, site, faq) {
  const shell = fs.readFileSync(path.join(out, 'research-documentation.html'), 'utf8');
  function write(route, title, description, content) {
    const dom = new JSDOM(shell);
    const doc = dom.window.document;
    doc.title = title + ' | PURE';
    const meta = doc.querySelector('meta[name="description"]') || doc.head.appendChild(doc.createElement('meta'));
    meta.name = 'description';
    meta.content = description;
    for (const node of doc.head.querySelectorAll('script[type="application/ld+json"],link[rel="canonical"],meta[property^="og:"],meta[name^="twitter:"]')) node.remove();
    doc.querySelector('main').innerHTML = '<article class="pure-policy-content">' + content + '</article>';
    const file = path.join(out, route + '.html');
    fs.mkdirSync(path.dirname(file), {recursive:true});
    fs.writeFileSync(file, dom.serialize());
    dom.window.close();
  }
  const links = guides.map(g => '<li><a href="/learn/' + g.slug + '">' + esc(g.title) + '</a><p>' + esc(g.description) + '</p></li>').join('');
  write('learn', 'Research documentation guides', 'Read laboratory reports, compare measurements and keep traceable records for research-use-only materials.',
    '<h1>Research documentation guides</h1><p>For laboratories reviewing research-use-only materials.</p><ul>' + links + '</ul><p><a href="/coas">Lab Testing &amp; COAs</a> · <a href="/shop">Research catalog</a></p>');
  for (const g of guides) {
    const related = guides.filter(other => other.slug !== g.slug).map(other => '<li><a href="/learn/' + other.slug + '">' + esc(other.title) + '</a></li>').join('');
    write('learn/' + g.slug, g.title, g.description,
      '<p><a href="/learn">Research guides</a></p><h1>' + esc(g.title) + '</h1><p>' + esc(g.description) + '</p>' +
      g.sections.map(([h,p]) => '<section><h2>' + esc(h) + '</h2><p>' + esc(p) + '</p></section>').join('') +
      '<p><a href="' + esc(g.source[1]) + '">' + esc(g.source[0]) + '</a></p><h2>Related documentation</h2><ul><li><a href="/coas">Browse the original laboratory reports</a></li>' +
      related + '</ul><p>' + esc(site.ruo) + '</p>');
  }
  write('faq', 'Frequently asked questions', 'Answers about research materials, lab reports, shipping, order tracking, returns and PURE account features.',
    '<h1>Frequently asked questions</h1>' + faq.map(q => '<details><summary>' + esc(q.question) + '</summary><p>' + esc(q.answer) + '</p></details>').join('') +
    '<p><a href="/coas">Lab Testing &amp; COAs</a> · <a href="/learn">Research guides</a> · <a href="/contact">Contact PURE</a></p>');
}

module.exports = {buildGuides, guides};
