'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const views=require('../reference-ui-functions.cjs');
const read=file=>fs.readFileSync(file,'utf8');

test('membership pages and embedded home tiers omit redundant note, approximation and currency suffix',()=>{
 const member=read('membership-experience.js'),fx=read('config/conversion.json');
 assert.match(member,/Save 20%/);
 assert.doesNotMatch(member,/Save ≈20%|mx-currency-note|currencyCode\(\)\} \/ /);
 assert.match(member,/mx-price-period/);
 assert.ok(JSON.parse(fx).plans.elite.annual_cents===Math.round(JSON.parse(fx).plans.elite.monthly_cents*12*.8));
 assert.ok(JSON.parse(fx).plans.vip.annual_cents===Math.round(JSON.parse(fx).plans.vip.monthly_cents*12*.8));
});
test('sign-in Google artwork is the existing clean payment G with no inline outline',()=>{
 const js=read('account.js'),asset=read('assets/payment-brands/google-g-clean.svg');
 assert.match(js,/google-g-clean\.svg/);
 assert.match(js,/class="pure-google-mark"/);
 assert.doesNotMatch(js,/<svg viewBox="0 0 48 48"/);
 assert.doesNotMatch(asset,/(?:stroke|stroke-width)="black"/);
});
test('account tabs use the same underline active and hover behavior as the storefront',()=>{
 const brand=read('pure-brand.css'),palette=read('unified-palette.css');
 assert.match(brand,/nav\.account-nav a\[aria-current=page\]::after/);
 assert.match(brand,/nav\.account-nav :is\(a,\.account-nav-logout\):hover::after/);
 assert.match(brand,/background:transparent!important/);
 assert.doesNotMatch(palette,/\.account-nav a\[aria-current=page\]/);
 assert.match(brand,/\.cv-program-primary,\.ap-subscriptions-empty a\.ap-button/);
 assert.match(brand,/-webkit-text-fill-color:#fff!important/);
});
test('Partner and COA preserve original form, report and navigation integration',()=>{
 const partner=views.workspace.partnerPage.toString(),coa=read('workspace-v2.js'),styling=read('pure-coa.css');
 assert.match(partner,/pure-partner-hero/);
 assert.match(partner,/pure-partner-inquiry/);
 assert.match(partner,/inquiryForm\('partner'\)/);
 assert.match(partner,/href="\/account\/partner"/);
 assert.match(coa,/id="ap-coa-query"/);
 assert.match(coa,/id="ap-supplier-references"/);
 assert.match(coa,/PURE \/ CERTIFICATES OF ANALYSIS/);
 assert.match(styling,/\.pure-coa-page \.ap-coa-card/);
});

test('only the terms link remains below membership cards on both routes',()=>{
 const src=read('membership-experience.js');
 assert.match(src,/class="mx-terms"><a href="\/membership-terms\.html">See full terms\.<\/a>/);
 assert.doesNotMatch(src,/class="mx-terms">\$\{esc\(terms\(config\)\)\}/);
});
test('legacy rewards fragments route to the canonical points page and account overview still shows both balances',()=>{
 const nav=read('account-experience-build.cjs'),ui=read('readiness-ui.js');
 const client=read('account-experience.js');
 assert.ok(client.includes("['#rewards','#rewards-and-credit'].includes(location.hash)"));
 assert.ok(client.includes("history.replaceState(history.state,'','/my-account/points'+location.search)"));
 assert.ok(nav.includes("['Rewards','/account/points']"));
 assert.match(ui,/id="rewards-and-credit"/);
 assert.match(ui,/rd-balance-pair/);
});
test('homepage FAQ and original sample link to the real testing archive',()=>{
 const {JSDOM}=require('jsdom');
 const {site}=require('../config/site.ts');
 const {renderHomeDocument}=require('../scripts/home-shell.cjs');
 const html=renderHomeDocument('<html><head></head><body><main></main></body></html>',site);
 const d=new JSDOM(html).window.document;
 const sample=JSON.parse(read('data/supplier-coas.json')).reports.find(r=>r.id==='p99-0285-opt-260727-r1');
 assert.equal(sample.scope,'supplier_reference');assert.equal(sample.inventory_lot_linked,false);
 const preview=d.querySelector('.ph-report');
 assert.ok(preview.textContent.includes(sample.lot));assert.ok(preview.textContent.includes(sample.lab_name));assert.ok(preview.textContent.includes(sample.size));
 assert.ok(preview.querySelector('a[download][href$=".pdf"]'));assert.ok(preview.querySelector('img[src$=".webp"]'));
 assert.equal(d.querySelectorAll('#faq details').length,10);
 assert.equal(d.querySelector('.ph-lab a[href="/coas"]').textContent.trim(),'Search all lab reports ↗');
});
