'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {JSDOM} = require('jsdom');
const read = file => readFileSync(file, 'utf8');
const home = require('../reference-ui-functions.cjs').store.home.toString();
const storefront = read('storefront-v2.js');

test('desktop and mobile share the four primary links while FAQ stays available in the footer', () => {
  const files = new Map();
  const fs = {
    readFileSync: file => files.get(file) ?? read(file),
    writeFileSync: (file, value) => files.set(file, value)
  };
  require('node:vm').runInNewContext(read('site-build.cjs'), {
    require: name => name === 'node:fs' ? fs : require(name),
    console: {log() {}}
  }, {filename: 'site-build.cjs', timeout: 1000});
  const dom = new JSDOM(files.get('index.html'));
  try {
    const {document} = dom.window;
    const labels = ['Products', 'Bulk Orders', 'Contact Us', 'Partner'];
    for (const menu of ['#ap-nav','#ap-mobile-menu nav']) {
      const nav = document.querySelector(menu);
      assert.ok(nav, menu);
      assert.deepEqual([...nav.querySelectorAll('a')].map(link => link.textContent), labels);
    }
    assert.equal(document.querySelector('#ap-more-menu'), null);
    assert.equal(document.querySelector('.ap-footer a[href="/#faq"]')?.textContent, 'FAQ');
    assert.match(home, /\$\{homeFAQ\(\)\}/);
    assert.match(storefront, /<section [^>]*class="[^"]*pure-faq-section[^"]*" id="faq">/);
  } finally {
    dom.window.close();
  }
});

test('the restored FAQ side panel leads to contact and order tracking', () => {
  assert.match(storefront, /href="\/contact">Contact Us/);
  assert.match(storefront, /<a href="\/track-order">Track Order/);
  assert.match(read('storefront-v2.css'), /\.pure-home-faq \.pure-faq-intro \{[^}]*background:/);
});
