'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

test('account header FAQ link targets the existing storefront section', () => {
  const build = readFileSync(resolve(__dirname, '../site-build.cjs'), 'utf8');
  const home = require('../reference-ui-functions.cjs').store.home.toString();
  assert.match(build, /<a href="\/#faq">FAQ<\/a>/);
  assert.match(build, /account=account\.includes\([^\n]+account\.replace\([^\n]+,header\)/);
  assert.match(home, /<section [^>]*id="faq"/);
});
