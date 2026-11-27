'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM,VirtualConsole} = require('jsdom');
const config = require('../config/conversion.json');
const auth = {auth:{getSession:async()=>({data:{session:{access_token:'fixture_account_token_123456'}}})}};
function setup(payload,{ok=true}={}) {
  const dom = new JSDOM('<main id="root"></main>',{url:'https://pure.example/account/membership',runScripts:'outside-only'}),w=dom.window,calls=[];
  w.fetch=async(url,options)=>{calls.push({url,options});return {ok,json:async()=>payload};};
  w.eval(fs.readFileSync('membership-experience.js','utf8'));
  w.eval(fs.readFileSync('conversion-ui.js','utf8'));
  return {dom,w,root:w.document.getElementById('root'),calls};
}
test('active WHITE account shows the paid term and benefits without another purchase link',async()=>{
  const env=setup({membership:{plan:'vip',expires_at:'2099-12-31T00:00:00Z'},terms:{conversion:config}});
  await env.w.ConversionUI.mountMembership(env.root,auth);
  assert.match(env.root.querySelector('.cv-member-status h2').textContent,/PURE WHITE/);
  assert.match(env.root.querySelector('.cv-member-status').textContent,/5%/);
  assert.match(env.root.querySelector('.cv-member-status').textContent,/Current membership term/);
  assert.match(env.root.querySelector('.cv-program-note').textContent,/2099/);
  assert.equal(env.root.querySelectorAll('a[href^="/checkout?plan="]').length,0);
  assert.equal(env.calls[0].url,'/api/customer-config?checkout=account');
  assert.equal(env.calls[0].options.headers.Authorization,'Bearer fixture_account_token_123456');
  assert.equal(env.calls[0].options.cache,'no-store');
  assert.ok(env.root.querySelector('a[href="/membership-terms.html"]'));
  env.dom.window.close();
});
test('the membership summary starts collapsed and keeps its shop action available',async()=>{
  const env=setup({membership:null,terms:{conversion:config}});
  try{
    await env.w.ConversionUI.mountMembership(env.root,auth);
    const card=env.root.querySelector('.cv-member-status');
    const toggle=card.querySelector('button[aria-expanded]');
    const details=env.w.document.getElementById(toggle.getAttribute('aria-controls'));
    assert.equal(toggle.textContent,'MEMBER');
    assert.equal(toggle.getAttribute('aria-expanded'),'false');
    assert.ok(details.hidden);
    assert.ok(card.querySelector('.cv-member-summary a[href="/shop"]'));
    assert.ok(details.querySelector('.cv-member-metrics'));
    assert.ok(details.querySelector('a[href="/account/points"]'));
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'),'true');
    assert.equal(details.hidden,false);
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'),'false');
    assert.equal(details.hidden,true);
  }finally{env.w.close();}
});
test('active BLACK account discloses credit qualification, BAC gift and priority',async()=>{
  const env=setup({membership:{plan:'elite',expires_at:'2099-12-31T00:00:00Z'},terms:{conversion:config}});
  await env.w.ConversionUI.mountMembership(env.root,auth);
  const card=env.root.querySelector('.cv-member-black');
  assert.match(card.textContent,/PURE BLACK/);
  assert.match(card.textContent,/10%/);
  assert.match(card.textContent,/\$50 monthly credit after a qualifying \$150\+ order/);
  assert.doesNotMatch(card.textContent,/Issued once per UTC calendar month|before points or store credit/);
  const creditTerms=card.querySelector('.mx-benefit-footnote');assert.ok(creditTerms);
  assert.equal(creditTerms.getAttribute('href'),'/membership-terms.html#pure-black-credit');
  assert.equal(creditTerms.getAttribute('aria-label'),'Read the PURE BLACK monthly credit terms');
  assert.equal(creditTerms.textContent,'†');
  assert.match(card.textContent,/Reconstitution Solution 3mL with each eligible product order/);
  assert.match(card.textContent,/Priority order fulfillment/);
  env.dom.window.close();
});
test('pending membership is awaiting payment, suppresses duplicate purchase links, and grants no paid benefits',async()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const env=setup({membership:null,membership_pending:{invoice_id:id,plan:'elite',name:'PURE BLACK',billing_period:'annual',status:'awaiting_payment',currency:'CAD',total_cents:133426,expires_at:'2099-12-31T00:00:00Z'},terms:{conversion:config}});
  await env.w.ConversionUI.mountMembership(env.root,auth);
  const pending=env.root.querySelector('.cv-pending-membership');assert.ok(pending);
  assert.match(pending.textContent,/AWAITING PAYMENT/);assert.match(pending.textContent,/CAD\s*1,334\.26/);assert.match(pending.textContent,/One prepaid year/);
  assert.ok(pending.querySelector('a[href="/account/purchases?id='+id+'"]'));
  assert.equal(env.root.querySelector('.cv-member-status h2').textContent,'MEMBER');
  assert.equal(env.root.querySelector('.cv-member-status .cv-program-badge').textContent,'FREE ACCOUNT');
  assert.equal(env.root.querySelectorAll('a[href^="/checkout?plan="]').length,0);
  assert.doesNotMatch(env.root.querySelector('.cv-member-status').textContent,/10%|Reconstitution Solution|\$50 monthly credit/);
  env.dom.window.close();
});
test('expired or review-required pending membership stays blocked and directs the account to order review',async()=>{
 for(const flags of [{expired:true},{requires_review:true}]){
  const id='11111111-1111-4111-8111-111111111111',env=setup({membership:null,membership_pending:{invoice_id:id,plan:'vip',name:'PURE WHITE',billing_period:'monthly',currency:'USD',total_cents:1999,expires_at:'2099-12-31T00:00:00Z',...flags},terms:{conversion:config}});
  await env.w.ConversionUI.mountMembership(env.root,auth);
  const pending=env.root.querySelector('.cv-pending-membership');
  assert.match(pending.textContent,/Unpaid membership needs attention/);assert.match(pending.textContent,/If you sent payment, contact PURE/);
  assert.match(pending.querySelector('a[href="/account/purchases?id='+id+'"]').textContent,/Review membership order/);
  assert.doesNotMatch(pending.textContent,/Complete this payment before|Continue payment/);
  assert.equal(env.root.querySelectorAll('a[href^="/checkout?plan="]').length,0);
  assert.equal(env.root.querySelector('.cv-member-status h2').textContent,'MEMBER');
  env.dom.window.close();
 }
});
test('expired or revoked membership cannot appear as an active paid tier',async()=>{
  for (const membership of [{plan:'elite',expires_at:'2020-01-01T00:00:00Z'},{plan:'vip',expires_at:'2099-12-31T00:00:00Z',revoked_at:'2026-01-01T00:00:00Z'}]) {
    const env=setup({membership,terms:{conversion:config}});
    await env.w.ConversionUI.mountMembership(env.root,auth);
    assert.equal(env.root.querySelector('.cv-member-status h2').textContent,'MEMBER');
    assert.equal(env.root.querySelector('.cv-member-status .cv-program-badge').textContent,'FREE ACCOUNT');
    assert.equal(env.root.querySelectorAll('a[href^="/checkout?plan="]').length,2);
    env.dom.window.close();
  }
});
function setupMonthly(payload,{ok=true}={}) {
  const html=fs.readFileSync('monthly-orders.html','utf8');
  const source=fs.readFileSync('monthly-orders.js','utf8');
  const dom=new JSDOM(html,{url:'https://pure.example/monthly-orders',runScripts:'outside-only'});
  const w=dom.window,calls=[];
  w.eval(fs.readFileSync('account-navigation.js','utf8'));
  w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{
    access_token:'fixture_account_token_123456',user:{id:'fixture-owner',email:'owner@example.test'}
  }}})}})};
  w.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url==='/api/customer-config')return {ok:true,json:async()=>({supabaseUrl:'https://fixture.supabase.co',anonKey:'test'})};
    return {ok,json:async()=>payload};
  };
  return {w,calls,root:w.document.getElementById('monthly-content'),render:()=>w.eval(source)};
}

test('account API failures do not fabricate membership or monthly order state',async()=>{
  const membership=setup({error:'Sign in again to view this account.'},{ok:false});
  const monthly=setupMonthly({error:'Invoice plans could not be loaded.'},{ok:false});
  try {
    await membership.w.ConversionUI.mountMembership(membership.root,auth);
    assert.match(membership.root.querySelector('[role="alert"]').textContent,/Sign in again/);
    assert.equal(membership.root.querySelector('.cv-member-status'),null);
    await monthly.render();
    assert.match(monthly.w.document.querySelector('#monthly-status').textContent,/Invoice plans could not be loaded/);
    assert.equal(monthly.root.querySelector('article'),null);
    assert.doesNotMatch(monthly.root.textContent,/You have no monthly invoice plans/);
  }finally{membership.w.close();monthly.w.close();}
});

test('account with no monthly invoices states that no plans exist',async()=>{
  const env=setupMonthly({plans:[],builder_terms:'pure-monthly-invoice-v2'});
  try {
    await env.render();
    assert.equal(env.root.querySelector('h2').textContent,'Your subscription plans');
    assert.match(env.root.textContent,/You have no subscription plans/);
    const menu=env.w.document.querySelector('.monthly-account-nav');
    assert.equal(menu.hidden,false);
    assert.equal(menu.querySelector('[aria-current="page"]').textContent,'Subscription');
    assert.equal(menu.querySelector('.account-nav-toggle').getAttribute('aria-expanded'),'false');
    assert.equal(env.root.querySelector('article'),null);
    assert.equal(env.root.querySelector('a.button[href="/subscribe-and-save"]').textContent,'Subscribe & Save');
    assert.equal(env.calls[1].url,'/api/customer-config?repeat_orders=1');
    assert.equal(env.calls[1].options.method,'GET');
    assert.equal(env.calls[1].options.cache,'no-store');
    assert.equal(env.calls[1].options.headers.Authorization,'Bearer fixture_account_token_123456');
  }finally{env.w.close();}
});

test('monthly plan history displays verified account state and only permitted actions',async()=>{
  const terms='pure-monthly-invoice-v2';
  const snapshot={kind:'builder',terms,total_cents:24000,request:{items:[
    {id:'fixture',name:'<script>unsafe</script>',size:'5 mg',qty:4}
  ]}};
  const completed={id:'completed-plan',status:'completed',invoice_id:'second-invoice',snapshot,
    can_edit:false,can_cancel:false,can_restart:true,delivered_count:3};
  const active={id:'active-plan',status:'active',invoice_id:'active-invoice',snapshot,
    can_edit:true,can_cancel:false,can_restart:false,delivered_count:1,next_due_at:'2099-12-01T00:00:00Z'};
  const env=setupMonthly({plans:[active,completed],builder_terms:terms});
  const finished=setupMonthly({plans:[completed],builder_terms:terms});
  try {
    await env.render();
    const plan=env.root.querySelector('[data-id="active-plan"]');
    assert.match(plan.textContent,/\$240\.00/);
    assert.match(plan.textContent,/1 of 3/);
    assert.match(plan.textContent,/Next invoice/);
    assert.ok(plan.querySelector('a[href="/account/purchases?id=active-invoice"]'));
    assert.ok(plan.querySelector('a[href="/contact"]'));
    assert.equal(env.root.querySelector('script'),null);
    assert.deepEqual([...plan.querySelectorAll('button[data-action]')].map(button=>button.dataset.action),['edit']);
    assert.equal(env.root.querySelector('a[href="/subscribe-and-save"]'),null,'An unfinished plan prevents starting another.');
    assert.ok(env.calls.every(call=>!call.options?.body));
    await finished.render();
    assert.match(finished.root.textContent,/3 of 3/);
    assert.match(finished.root.querySelector('a[href="/subscribe-and-save"]').textContent,/Start another plan/);
    assert.equal(finished.root.querySelector('button[data-action]'),null);
  }finally{env.w.close();finished.w.close();}
});

test('partners can copy the commission disclosure beside their referral link',async()=>{
 const env=setup({partner:{code:'LABTEAM',status:'active'},events:[],summary:{},terms:config.partner});
 const copied=[];
 Object.defineProperty(env.w.navigator,'clipboard',{value:{writeText:async text=>copied.push(text)}});
 try{
  await env.w.ConversionUI.partner(env.root,auth);
  const disclosure=env.root.querySelector('.rd-referral .pure-partner-disclosure');
  assert.ok(disclosure);
  assert.equal(disclosure.open,false);
  await disclosure.querySelector('button').onclick();
  assert.deepEqual(copied,['I earn a commission when you buy through my PURE link or code.']);
  assert.equal(disclosure.querySelector('textarea').value.split('\n')[0],copied[0]);
 }finally{env.dom.window.close();}
});

test('partner links open the selected catalog variant and record the chosen referral alias', async () => {
 const env = setup({partner:{code:'LABTEAM',status:'active'},codes:[{code:'OTHER'},{code:'LABTEAM'}],events:[]});
 const storefront = fs.readFileSync('products.js','utf8') + '\n' + fs.readFileSync('storefront-v2.js','utf8');
 const copied = [];
 Object.defineProperty(env.w.navigator, 'clipboard', {value:{writeText:async value => copied.push(value)}});
 let visitor;
 try {
  env.w.eval(storefront);
  await env.w.ConversionUI.partner(env.root, auth);
  const select = env.root.querySelector('[data-link-destination]');
  const code = env.root.querySelector('[data-link-code]');
  const link = env.root.querySelector('[data-referral-url]');
  const variants = env.w.AltaStore.catalog.flatMap(product => product.variants);
  assert.equal(select.options.length, variants.length + 3);
  assert.equal(link.value, 'https://pure.example/?ref=LABTEAM');
  select.value = '/shop';
  select.dispatchEvent(new env.w.Event('change'));
  assert.equal(link.value, 'https://pure.example/shop?ref=LABTEAM');

  select.value = '/product/bpc-tb-500?size=5mg%2F5mg';
  select.dispatchEvent(new env.w.Event('change'));
  code.value = 'OTHER';
  code.dispatchEvent(new env.w.Event('change'));
  await env.root.querySelector('[data-copy-link]').onclick();
  await env.root.querySelector('[data-copy-caption]').onclick();
  assert.equal(copied[0], 'https://pure.example/product/bpc-tb-500?size=5mg%2F5mg&ref=OTHER');
  assert.match(copied[1], /^I earn a commission/);
  assert.ok(copied[1].includes(select.selectedOptions[0].textContent));
  assert.match(copied[1], /laboratory research use only/);
  assert.ok(copied[1].endsWith(copied[0]));
  assert.doesNotMatch(copied[1], /\d+% off|BOGO|free shipping/i);

  visitor = new JSDOM('<main id="ap-main"></main>', {url:copied[0], runScripts:'outside-only'});
  const w = visitor.window, visits = [];
  w.fetch = async (url, options) => {
   if (url.includes('partner=visit')) visits.push(JSON.parse(options.body));
   return {ok:true, json:async () => ({})};
  };
  w.eval(fs.readFileSync('conversion-ui.js','utf8'));
  w.eval(storefront);
  await w.PurePartnerVisit;
  assert.match(w.document.querySelector('#ap-main h1').textContent, /5mg\/5mg/);
  assert.equal(w.AltaStore.selections['bpc-tb-500'], '5mg/5mg');
  assert.deepEqual(visits.map(visit => visit.code), ['OTHER']);
 } finally {
  visitor?.window.close();
  env.dom.window.close();
 }
});

test('bulk referral links open the builder with the selected strength and partner disclosure', async () => {
 const env = setup({partner:{code:'LABTEAM',status:'active'},codes:[{code:'OTHER'},{code:'LABTEAM'}],events:[]});
 const storefront = fs.readFileSync('products.js','utf8') + '\n' + fs.readFileSync('storefront-v2.js','utf8');
 const workspace = fs.readFileSync('workspace-v2.js','utf8');
 const visitors = [];
 try {
  env.w.eval(storefront);
  env.w.eval(workspace);
  await env.w.ConversionUI.partner(env.root, auth);
  const field = env.root.querySelector('[data-bulk-link-field]');
  const variant = field.querySelector('select');
  const link = env.root.querySelector('[data-referral-url]');
  const caption = env.root.querySelector('[data-referral-caption]');
  function choose(element, value) {
   element.value = value;
   element.dispatchEvent(new env.w.Event('change'));
  }
  assert.equal(field.hidden, true);
  choose(env.root.querySelector('[data-link-destination]'), '/bulk-orders');
  assert.equal(field.hidden, false);
  assert.equal(link.value, 'https://pure.example/bulk-orders?ref=LABTEAM');
  assert.equal([...variant.options].some(o => o.value.includes('needles')), false);
  choose(variant, '/bulk-orders?product=bpc-157&size=10mg');
  choose(env.root.querySelector('[data-link-code]'), 'OTHER');
  assert.equal(link.value, 'https://pure.example/bulk-orders?product=bpc-157&size=10mg&ref=OTHER');
  assert.match(caption.value, /^I earn a commission/);
  assert.match(caption.value, /bulk pricing for BPC-157 · 10mg/i);
  assert.match(caption.value, /50% at 10 units or 60% at 50 units of the same compound/);
  assert.doesNotMatch(caption.value, /BOGO|coupon|code|20%/i);
  assert.ok(caption.value.endsWith(link.value));

  const regularCart = [{id:'bpc-157', size:'5mg', qty:2}];
  for (const saved of [false, true]) {
   const dom = new JSDOM('<main id="ap-main"></main><dialog id="ap-age-dialog"></dialog>', {url:link.value,runScripts:'outside-only'});
   visitors.push(dom);
   const w = dom.window, visits = [];
   w.HTMLDialogElement.prototype.showModal = function(){this.open = true;};
   w.fetch = async (url, options) => {
    if (url.includes('partner=visit')) {
     assert.equal(options.keepalive,true);
     visits.push(JSON.parse(options.body).code);
    }
    return {ok:true,json:async()=>[]};
   };
   w.localStorage.setItem('pp-cart', JSON.stringify(regularCart));
   if (saved) {
    w.localStorage.setItem('ap-bulk-size-selections-v2', '{"bpc-157":"5mg"}');
    w.localStorage.setItem('ap-bulk-draft-v2', JSON.stringify(regularCart));
   }
   w.eval(fs.readFileSync('conversion-ui.js','utf8'));
   w.eval(storefront);
   w.eval(workspace);
   await w.PurePartnerVisit;
   await new Promise(resolve=>setImmediate(resolve));
   assert.deepEqual(visits,['OTHER']);
   assert.equal(w.document.querySelector('#ap-age-dialog').open,true);
   assert.equal(w.document.querySelector('#ap-bulk-query').value,'BPC-157');
   const size = w.document.querySelector('[data-bulk-product="bpc-157"] [aria-pressed="true"]');
   assert.equal(size.dataset.size,saved?'5mg':'10mg');
   assert.deepEqual(JSON.parse(w.localStorage.getItem('pp-cart')).map(({id,size,qty})=>({id,size,qty})),regularCart);
   assert.deepEqual(JSON.parse(w.localStorage.getItem('ap-bulk-draft-v2')),saved?regularCart:null);
   assert.deepEqual(JSON.parse(w.localStorage.getItem('ap-bulk-size-selections-v2')),saved?{'bpc-157':'5mg'}:null);
  }
  choose(env.root.querySelector('[data-link-destination]'),'/shop');
  assert.equal(field.hidden,true);
  assert.equal(link.value,'https://pure.example/shop?ref=OTHER');
 } finally {
  visitors.forEach(dom=>dom.window.close());
  env.dom.window.close();
 }
});

test('bulk checkout proceeds after a short grace period even when referral tracking hangs', async () => {
 const storefront = fs.readFileSync('products.js','utf8') + '\n' + fs.readFileSync('storefront-v2.js','utf8');
 const workspace = fs.readFileSync('workspace-v2.js','utf8');
 for (const tracking of ['none','settles','hangs','rejects']) {
  const attempts = [], console = new VirtualConsole();
  console.on('jsdomError',error=>attempts.push(error.message));
  const dom = new JSDOM('<main id="ap-main"></main>',{url:'https://pure.example/bulk-orders',runScripts:'outside-only',virtualConsole:console});
  const w = dom.window;
  try {
   w.fetch = async()=>({ok:true,json:async()=>[]});
   w.localStorage.setItem('ap-bulk-draft-v2','[{"id":"bpc-157","size":"5mg","qty":10}]');
   w.eval(storefront);
   w.eval(workspace);
   await new Promise(resolve=>setImmediate(resolve));
   let finish, fail, deadline, cleared = false;
   if(tracking!=='none')w.PurePartnerVisit = new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
   w.setTimeout = (callback,ms) => {assert.equal(ms,1500);deadline=callback;return 42;};
   w.clearTimeout = id => {assert.equal(id,42);cleared=true;};
   const checkout = w.document.querySelector('[data-action="bulk-checkout"]');
   checkout.click();
   if(tracking==='none'){
    assert.equal(deadline,undefined);
   }else{
    assert.equal(attempts.length,0);
    assert.equal(checkout.disabled,true);
    if(tracking==='hangs')deadline();
    if(tracking==='settles')finish();
    if(tracking==='rejects')fail(Error('offline'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(cleared,true);
   }
   assert.equal(attempts.length,1);
   assert.match(attempts[0],/navigation/i);
  }finally{dom.window.close();}
 }
});

test('partners can select a caption manually if clipboard access fails', async () => {
 const env = setup({partner:{code:'LABTEAM',status:'active'},events:[]});
 try {
  await env.w.ConversionUI.partner(env.root, auth);
  assert.equal(env.root.querySelector('[data-link-code]'), null);
  await env.root.querySelector('[data-copy-caption]').onclick();
  const caption = env.root.querySelector('[data-referral-caption]');
  assert.equal(caption.closest('details').open, true);
  assert.equal(env.w.document.activeElement, caption);
  assert.equal(caption.selectionStart, 0);
  assert.equal(caption.selectionEnd, caption.value.length);
  assert.match(env.root.querySelector('[data-referral-message]').textContent, /copy command/);
 } finally {
  env.dom.window.close();
 }
});

test('suspended partner accounts have no campaign link builder', async () => {
 const env = setup({partner:{code:'LABTEAM',status:'suspended'},events:[]});
 try {
  await env.w.ConversionUI.partner(env.root, auth);
  assert.equal(env.root.querySelector('[data-partner-links]'), null);
  assert.equal(env.root.querySelector('.rd-code-form, [data-copy]'), null);
  assert.match(env.root.querySelector('.rd-referral').textContent, /Referral sharing is paused/);
  assert.ok(env.root.querySelector('[data-partner-tab="wallet"]'));
 } finally {
  env.dom.window.close();
 }
});
