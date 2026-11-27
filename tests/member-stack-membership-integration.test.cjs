'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const config=require('../config/conversion.json');
const read=path=>fs.readFileSync(path,'utf8');

test('the account hover menu has four destinations and the dashboard retains Membership',()=>{
 const homepage=new JSDOM(read('public-build/index.html'));
 const accountPage=new JSDOM(read('public-build/account.html'));
 for(const page of [homepage,accountPage]){
  const menu=page.window.document.querySelector('#ap-account-menu');
  assert.ok(menu);
  const links=Array.from(menu.querySelectorAll('a')).map(x=>[x.textContent.trim(),x.getAttribute('href')]);
  assert.deepEqual(links,[['Overview','/my-account'],['Orders','/account/purchases'],['Track','/track-order'],['Profile','/account/profile']]);
  page.window.close();
 }
 const {window}=new JSDOM('',{runScripts:'outside-only'});
 window.eval(read('public-build/account-navigation.js'));
 window.document.body.innerHTML=window.PureAccountNavigation.render('/account/membership');
 const nav=window.document.querySelector('.account-nav');
 assert.equal(nav.querySelector('[aria-current="page"]').getAttribute('href'),'/account/membership');
 assert.equal(nav.querySelector('a[href="/account/stack"]'),null);
 window.close();
 const workspace=read('public-build/workspace-v2.js');
 assert.match(workspace,/if\(path==='\/account\/membership'\)return window\.ConversionUI\.mountMembership/);
 assert.doesNotMatch(workspace,/if\(path==='\/account\/stack'\)/);
 assert.match(read('public-build/direct-checkout-client.js'),/\/account\/membership#member-stack/);
 const redirects=JSON.parse(read('vercel.json')).redirects;
 for(const url of ['/account/stack','/my-account/stack','/account/subscriptions','/my-account/subscriptions']){
  assert.equal(redirects.find(x=>x.source===url)?.destination,'/account/membership',url);
 }
});

function account({plan=null,hash=''}={}){
 const dom=new JSDOM('<main id="membership"></main>',{url:'https://getpurelabs.com/account/membership'+hash,runScripts:'outside-only'});
 const w=dom.window,root=w.document.getElementById('membership'),calls=[],mounts=[];
 const session={auth:{getSession:async()=>({data:{session:{access_token:'test-member-session-token'}}})}};
 w.fetch=async(url,options={})=>{
  calls.push(String(url));
  return {ok:true,json:async()=>({
   membership:plan?{plan,invoice_id:'11111111-1111-4111-8111-111111111111',expires_at:'2099-12-31T00:00:00Z'}:null,
   membership_pending:null,terms:{conversion:config}
  })};
 };
 w.PureResearchBuilder={mount:async(element,options)=>{
  mounts.push({element,options});
  element.innerHTML='<p data-stack-mounted>Member Stack builder is within Membership</p>';
 }};
 w.eval(read('membership-experience.js'));
 w.eval(read('conversion-ui.js'));
 return{dom,w,root,calls,mounts,session};
}
for(const plan of [null,'vip','elite']){
 test('membership retains account benefits without a Member Stack entry for '+(plan||'free'),async()=>{
  const env=account({plan,hash:'#member-stack'});
  try{
   await env.w.ConversionUI.mountMembership(env.root,env.session);
   assert.ok(env.root.querySelector('.cv-member-status'));
   assert.ok(env.root.querySelector('[data-cv-memberships]'));
   assert.doesNotMatch(env.root.textContent,/Member Stack/);
   assert.equal(env.root.querySelector('#member-stack'),null);
   assert.equal(env.mounts.length,0);
   assert.deepEqual(env.calls,['/api/customer-config?checkout=account']);
  }finally{env.dom.window.close();}
 });
}
