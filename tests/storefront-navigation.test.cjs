'use strict';

const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {JSDOM} = require('jsdom');
const {site} = require('../config/site.ts');
const {buildHome, applyShell, homeFaq} = require('../scripts/home-shell.cjs');
const {buildGuides} = require('../scripts/research-guides.cjs');

const root = path.resolve(__dirname, '..');
let temp, home, faq;

before(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-nav-'));
  for (const file of ['products.js', 'account.html', 'account.js']) {
    fs.copyFileSync(path.join(root, file), path.join(temp, file));
  }
  fs.mkdirSync(path.join(temp, 'config'));
  fs.copyFileSync(path.join(root, 'config/display-currencies.json'), path.join(temp, 'config/display-currencies.json'));
  execFileSync(process.execPath, [path.join(root, 'site-build.cjs')], {cwd: temp});
  buildHome(temp, site);
  // The guides builder uses a generated policy shell. The common storefront fixture
  // supplies the same main landmark and shared navigation for this isolated test.
  fs.copyFileSync(path.join(temp, 'index.html'), path.join(temp, 'research-documentation.html'));
  buildGuides(temp, site, homeFaq(site));
  applyShell(temp, site);
  home = new JSDOM(fs.readFileSync(path.join(temp, 'index.html'), 'utf8'));
  faq = new JSDOM(fs.readFileSync(path.join(temp, 'faq.html'), 'utf8'));
});

after(() => {
  home?.window.close();
  faq?.window.close();
  if (temp) fs.rmSync(temp, {recursive: true, force: true});
});

test('desktop and mobile FAQ links open the published FAQ page and the homepage anchor remains usable', () => {
  const doc = home.window.document;
  for (const menu of ['#ap-nav', '#ap-mobile-menu']) {
    assert.equal(doc.querySelector(menu + ' a[href="/faq"]')?.textContent, 'FAQ', menu);
  }
  assert.ok(doc.querySelector('main #faq details > summary'));
  assert.match(faq.window.document.querySelector('main h1').textContent, /frequently asked questions/i);
  assert.equal(faq.window.document.querySelectorAll('main details').length, homeFaq(site).length);
});

test('the FAQ provides direct support and its mobile questions fit a single column', () => {
  assert.equal(faq.window.document.querySelector('main a[href="/contact"]')?.textContent, 'Contact PURE');
  const css = fs.readFileSync(path.join(temp, 'home-shell.css'), 'utf8');
  assert.match(css, /@media\s*\(max-width:\s*800px\)[\s\S]*?\.ph-faq\{grid-template-columns:1fr\}/);
  assert.match(css, /#faq\.ph-faq details>summary\{[^}]*min-height:52px/);
});
