'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('account navigation separates prepaid Membership from Monthly orders and marks the current location',()=>{
 const build=read('account-experience-build.cjs');
 const match=build.match(/`(function accountNav\(active\)\{[\s\S]*?\n)`\+s\.slice\(end\)/);
 assert.ok(match,'The account build exposes the generated navigation function.');
 for(const route of ['/account/membership','/monthly-orders']){
  const output=vm.runInNewContext(match[1]+'\naccountNav('+JSON.stringify(route)+');');
  const {window}=new JSDOM(output);
  try{
   const {document}=window;
   assert.equal(document.querySelectorAll('a[href="/my-account/membership"]').length,1);
   const monthly=document.querySelectorAll('a[href="/monthly-orders"]');
   assert.equal(monthly.length,1);
   assert.equal(monthly[0].textContent,'Monthly orders');
   assert.equal(document.querySelector('a[aria-current="page"]').getAttribute('href'),route.replace('/account','/my-account'));
   assert.equal(document.querySelectorAll('#logout').length,1);
   assert.equal(document.querySelector('a[href="/account/subscriptions"],a[href="/account/stack"]'),null);
  }finally{window.close();}
 }
 const conversion=read('conversion-build.cjs');
 assert.match(conversion,/path==='\/account\/membership'\)return window\.ConversionUI\.mountMembership\(root,auth\)/);
 assert.doesNotMatch(conversion,/ConversionUI\.subscriptions/);
 for(const name of ['membership-experience.js','membership-checkout.js'])assert.ok(conversion.includes(name),name+' is published');
});

test('site generation maintains authenticated membership routing and retires the old research pages',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pure-membership-routing-'));
 try{
  for(const file of ['products.js','account.html','account.js'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
  fs.mkdirSync(path.join(temp,'config'),{recursive:true});
  fs.copyFileSync(path.join(root,'config','display-currencies.json'),path.join(temp,'config','display-currencies.json'));
  const run=spawnSync(process.execPath,[path.join(root,'site-build.cjs')],{cwd:temp,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const account=fs.readFileSync(path.join(temp,'account.js'),'utf8');
  assert.match(account,/if\(p==='\/account\/stack'\|\|p==='\/account\/subscriptions'\)return go\('\/account\/membership'\)/);
  assert.match(account,/\['\/account\/points','\/account\/store-credit','\/account\/partner','\/account\/membership'\]\.includes\(p\)\)\{if\(!user\)return go\('\/account\/login\?returnTo='\+encodeURIComponent\(accountReturnDestination\(p\)\)\);return placeholder\(p\)/);
  assert.match(account,/window\.AltaWorkspace\.renderAccountPanel\(path,document\.getElementById\('ap-account-panel'\),auth,user\)/);
  const routing=JSON.parse(read('vercel.json'));
  const redirect=source=>routing.redirects.find(entry=>entry.source===source)?.destination;
  assert.equal(redirect('/research-builder'),'/subscribe-and-save');
  assert.equal(redirect('/research-subscriptions'),'/subscribe-and-save');
  assert.equal(redirect('/research-checkout'),'/memberships');
  assert.equal(routing.rewrites.find(entry=>entry.source==='/subscribe-and-save/checkout')?.destination,'/monthly-checkout.html');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('membership tiers stay prepaid while Subscribe & Save has its own invoice contract',()=>{
 const config=JSON.parse(read('config/conversion.json'));
 assert.equal(config.memberships_enabled,true);
 assert.equal(config.billing_mode,'prepaid');
 assert.equal(config.automatic_renewal,false);
 assert.equal(config.recurring_available,false);
 assert.equal(config.plans.vip.name,'PURE WHITE');
 assert.equal(config.plans.elite.name,'PURE BLACK');

 const {terms}=require('../lib/research-builder-pricing');
 assert.equal(terms.membership_required,true);
 assert.equal(terms.subscription_available,false);
 assert.equal(terms.automatic_renewal,false);
 const snapshot=require('../lib/repeat-orders').pricedBasket('builder',
  [{id:'fixture',size:'S',qty:4}],
  [{id:'fixture',name:'Fixture',category:'injectables',variants:[{size:'S',price:12.50}]}],
  'US',require('../lib/delivery-options').defaults);
 assert.equal(snapshot.pricing.billing_mode,'invoice_per_cycle');
 assert.equal(snapshot.total_cents,3000);
 assert.match(read('conversion-ui.js'),/request\('checkout=account',null,auth\)/);
 assert.doesNotMatch(read('conversion-ui.js'),/user_metadata\?\.(points|store_credit|rewards|membership)/);
});
