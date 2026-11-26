'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {JSDOM} = require('jsdom');
const read = file => readFileSync(file, 'utf8');
const home = require('../reference-ui-functions.cjs').store.home.toString();

test('desktop and mobile navigation expose FAQ and target the live homepage section', () => {
  const source = read('site-build.cjs');
  const desktop = source.match(/<header class="ap-header[^"]*">[\s\S]*?<\/header>/)?.[0];
  const mobile = source.match(/<dialog id="ap-mobile-menu"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(desktop && mobile);
  const dom = new JSDOM(desktop + mobile);
  try {
    const {document} = dom.window;
    for (const menu of ['#ap-nav','#ap-mobile-menu']) {
      const nav = document.querySelector(menu);
      assert.ok(nav,menu);
      const faq = nav.querySelector('a[href="/#faq"]');
      assert.equal(faq?.textContent,'FAQ');
    }
    assert.match(home,/<section [^>]*class="[^"]*pure-faq-section" id="faq">/);
  } finally {
    dom.window.close();
  }
});

test('the FAQ contact action stays prominent and its mobile introduction is centered', () => {
  const css = read('pure-brand.css');
  assert.match(home,/class="pure-faq-cta" href="\/contact">CONTACT US/);
  assert.match(css,/\.pure-faq-cta\{[^}]*justify-content:center/);
  assert.match(css,/\.pure-faq-intro\s*\{[^}]*text-align:\s*center/);
});
