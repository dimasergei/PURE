'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { buildSEO } = require('../seo-build.cjs');

test('canonical storefront metadata retains distinct variant offers and excludes private routes from the sitemap', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-seo-test-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const site = { origin: 'https://example.test', name: 'PURE', support: { email: 'support@example.test' } };
  const html = (body, schema = '') =>
    '<html><head><title>Old title</title>' + schema + '</head><body><main>' + body + '</main></body></html>';
  const write = (filename, source) => fs.writeFileSync(path.join(out, filename), source);
  fs.mkdirSync(path.join(out, 'product'));
  for (const size of ['3', '10']) {
    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Research supply',
      offers: [
        { '@type': 'Offer', name: 'Research supply ' + size + ' mL', price: '1.00', priceCurrency: 'USD' }
      ]
    };
    write(
      'product/size-' + size + '.html',
      html(
        '<h1>Research supply</h1>',
        '<script type="application/ld+json">' + JSON.stringify(product) + '</script>'
      )
    );
  }
  write(
    'index.html',
    html(
      '<h1>Catalog</h1><details><summary>Where are reports?</summary><p>Visit the archive.</p></details>' +
        '<a href="/shipping-policy.html#delivery">Shipping</a><a href="/account#rewards">Rewards</a><a href="/pay.html?order=example">Pay</a>'
    )
  );
  write('account.html', html('<h1>Account</h1>'));
  const callback = html('<h1>Payment status</h1>');
  write('checkout-result.html', callback);

  buildSEO(out, site);
  const read = (file) => fs.readFileSync(path.join(out, file), 'utf8');
  const homepage = new JSDOM(read('index.html')).window.document;
  const nodes = JSON.parse(homepage.querySelector('script[type="application/ld+json"]').textContent)[
    '@graph'
  ];
  assert.deepEqual(homepage.querySelectorAll('title').length, 1);
  assert.equal(homepage.querySelector('link[rel="canonical"]').href, site.origin + '/');
  assert.ok(homepage.querySelector('a[href="/shipping-policy#delivery"]'));
  assert.ok(homepage.querySelector('a[href="/my-account/points"]'));
  assert.ok(homepage.querySelector('a[href="/pay.html?order=example"]'));
  assert.equal(
    nodes.find((node) => node['@type'] === 'FAQPage').mainEntity[0].acceptedAnswer.text,
    'Visit the archive.'
  );
  for (const size of ['3', '10']) {
    const doc = new JSDOM(read('product/size-' + size + '.html')).window.document;
    assert.equal(doc.title, 'Research supply ' + size + ' mL | PURE');
    const graph = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
    assert.equal(graph.find((node) => node['@type'] === 'Product').offers[0].price, '1.00');
    assert.equal(
      graph.find((node) => node['@type'] === 'BreadcrumbList').itemListElement[1].item,
      site.origin + '/shop'
    );
  }
  const account = new JSDOM(read('account.html')).window.document;
  assert.match(account.querySelector('meta[name="robots"]').content, /noindex/);
  assert.doesNotMatch(read('sitemap.xml'), /my-account|account.html|checkout-result/);
  assert.equal(read('checkout-result.html'), callback);
});
