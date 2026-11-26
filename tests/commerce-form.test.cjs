'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {JSDOM}=require('jsdom');
const {handle}=require('../lib/commerce-form');

const env={SITE_URL:'https://getpurelabs.com',CHECKOUT_RATE_LIMIT_SECRET:'fixture-only-with-at-least-thirty-two-characters',ORDER_CONFIRMATION_FROM:'PURE <support@example.test>',RESEND_API_KEY:'fixture'};
const sample={name:'Lab Buyer',organization:'Fixture lab',email:'lab@example.test',message:'Please quote this catalog material.',consent:'on',variant:'lab|1 mg',quantity:'10'};
const catalog=[{id:'lab',name:'Fixture',variants:[{size:'1 mg',price:20}]}];
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},send(html){this.html=html;return this;}};}
function request(fields=sample,patch={}){return {method:'POST',headers:{origin:env.SITE_URL,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString(),socket:{remoteAddress:'127.0.0.1'},...patch};}
function mocks(records=[]){return {env,catalog,db:{},rateLimit:async()=>{},storeRequest:async(db,inquiry)=>{records.push(inquiry);return {email_status:'queued'};},deliverRequest:async()=>({email_status:'queued'}),delay:async()=>{}};}
test('native bulk and contact forms use validated storage and return non-cacheable HTML, including on a retry',async()=>{
 const rows=[],deps=mocks(rows);
 for(const kind of ['contact','bulk','bulk']){const res=response();await handle(request(),res,kind,deps);assert.equal(res.code,202);assert.equal(res.headers['Cache-Control'],'no-store');assert.match(res.html,/Request received/);assert.doesNotMatch(res.html,/lab@example.test/);}
 assert.equal(rows[0].items.length,0);assert.equal(rows[1].items[0].quantity,10);assert.equal(rows[1].items[0].unit_price_cents,2000);assert.equal(rows[1].request_id,rows[2].request_id);
});
test('native forms refuse unsupported methods, cross-origin requests, invalid units and oversized submissions',async()=>{
 const rows=[],deps=mocks(rows);
 for(const [req,status] of [[request(sample,{method:'GET'}),405],[request(sample,{headers:{origin:'https://example.test','content-type':'application/x-www-form-urlencoded'}}),403],[request({...sample,quantity:'101'}),400],[request({...sample,variant:'lab|not-a-size'}),400],[request({...sample,organization:''}),400],[request({...sample,message:'x'.repeat(17000)}),413]]){
  const res=response();await handle(req,res,'bulk',deps);assert.equal(res.code,status);
 }
 assert.deepEqual(rows,[]);
});
test('native tracking response never distinguishes a matching order or exposes carrier details',async()=>{
 const requestData={order_number:'P00001234',email:'lab@example.test'};const replies=[];
 for(const match of [null,{customer_email:'lab@example.test',status:'shipped',tracking_number:'PRIVATE',tracking_carrier:'UPS',created_at:'2026-01-01T12:00:00Z'}]){
  const res=response();let sent=0;await handle(request(requestData),res,'tracking',{...mocks(),findOrder:async()=>match,send:async message=>{sent++;assert.match(message.html,/Order timeline/);assert.match(message.text,/Jan 1, 2026/);}});
  assert.equal(res.code,202);assert.equal(sent,match?1:0);assert.doesNotMatch(res.html,/PRIVATE|lab@example.test/);replies.push(res.html);
 }
 assert.equal(replies[0],replies[1]);
});
test('reorder verifies each catalog strength and quantity and accepts identifiable historical records',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'});
 try{
  dom.window.eval(readFileSync('account-experience.js','utf8'));const lines=dom.window.AccountExperience.reorderLines;
  const same=[{id:'lab',size:'1 mg',qty:2},{product_name:'Fixture',variant_size:'1 mg',quantity:1}];
  assert.deepEqual(JSON.parse(JSON.stringify(lines(same,catalog))),[{id:'lab',size:'1 mg',qty:3}]);
  assert.throws(()=>lines([...same,{id:'withdrawn',size:'1 mg',qty:1}],catalog),/unavailable/);
  assert.throws(()=>lines([{id:'lab',size:'1 mg',qty:101}],catalog),/100/);
  assert.throws(()=>lines([same[1]],[...catalog,{...catalog[0],id:'other'}]),/unavailable/);
 }finally{dom.window.close();}
});
test('checkout retains one route heading while loading, after an error, and after recovery',async()=>{
 const dom=new JSDOM('<main data-checkout-title="Bulk checkout"><div id="account-root"><h1>Bulk checkout</h1></div></main>',{runScripts:'outside-only'});
 try{
  const {document}=dom.window,root=document.querySelector('#account-root');
  dom.window.eval(readFileSync('commerce-checkout-heading.js','utf8'));
  for(const html of ['<section></section>','<p>Shipping is temporarily unavailable.</p>','<header><h1>Bulk checkout</h1></header>']){
   root.innerHTML=html;await Promise.resolve();
   assert.equal(document.querySelectorAll('main h1').length,1);
   assert.equal(document.querySelector('h1').textContent,'Bulk checkout');
  }
 }finally{dom.window.close();}
});
