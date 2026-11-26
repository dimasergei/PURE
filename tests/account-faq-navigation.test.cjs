'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

test('the shared account footer keeps its link to the homepage FAQ', () => {
  const build = readFileSync(resolve(__dirname, '../site-build.cjs'), 'utf8');
  const storefront = readFileSync(resolve(__dirname, '../storefront-v2.js'), 'utf8');
  const home = require('../reference-ui-functions.cjs').store.home.toString();
  assert.match(build, /<footer[^\n]+<a href="\/#faq">FAQ<\/a>/);
  assert.match(build, /account=account\.includes\([^\n]+account\.replace\([^\n]+,header\)/);
  assert.match(home, /\$\{homeFAQ\(\)\}/);
  assert.match(storefront, /<section [^>]*id="faq"/);
});
