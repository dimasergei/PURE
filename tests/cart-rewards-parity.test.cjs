'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {free_shipping_threshold_cents:shipping}=require('../config/checkout.json');
const {bacMinimum}=require('../lib/order-thresholds');
const js=fs.readFileSync('cart-reference.js','utf8');

async function fixture(subtotal,discount=0,country='US'){
 const dom=new JSDOM('<main></main>',{url:'https://example.test/shop',runScripts:'outside-only'});
 const w=dom.window,root=w.document.querySelector('main');
 w.PureSite=require('../config/site.ts').site;
 const item={id:'fixture',size:'5mg',name:'Item',key:'item:5mg',qty:1,price:subtotal/100};
 w.AltaStore={cart:[item],catalog:[],product:()=>item,image:()=>'/image.webp'};
 w.localStorage.setItem('ap-shipping-country',country);
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('checkout=public')?{methods:[],delivery_options:[]}:{
   subtotal_cents:subtotal,discount_cents:discount,total_cents:subtotal-discount+500,free_shipping_threshold_cents:shipping,
   recon_solution_threshold_cents:bacMinimum,pricing:{subtotal_cents:subtotal,delivery:{shipping_cents:500}},
 }});
 w.eval(js);
 await w.AltaCartNmi.offer(root);
 return {w,root,close:()=>w.close()};
}
test('the cart advances through both gifts using discounted merchandise cents',async()=>{
 for(const [merchandise,expected,shippingReached,reconReached] of [
  [24999,'Add $0.01 for free express shipping.',false,false],
  [25000,'Add $49.00 for free recon solution.',true,false],
  [25001,'Add $48.99 for free recon solution.',true,false],
  [26970,'Add $29.30 for free recon solution.',true,false],
  [29899,'Add $0.01 for free recon solution.',true,false],
  [29900,'Free express shipping + recon solution unlocked.',true,true],
  [29901,'Free express shipping + recon solution unlocked.',true,true],
 ]){
  const f=await fixture(merchandise+1000,1000);
  try{
   assert.equal(f.root.querySelector('[data-nlc-unlock-copy]').textContent,expected);
   const meter=f.root.querySelector('[role=progressbar]'),buttons=f.root.querySelectorAll('.nlc-reward-trigger');
   assert.equal(meter.getAttribute('aria-valuemax'),'299');
   assert.equal(Number(meter.getAttribute('aria-valuenow')),Math.min(merchandise,29900)/100);
   const earnedCents=reconReached?bacMinimum:shippingReached?shipping:0;
   assert.equal(parseFloat(meter.style.getPropertyValue('--earned-width')),earnedCents/bacMinimum*100);
   assert.equal(parseFloat(meter.firstElementChild.style.width),Math.min(merchandise/29900,1)*100);
   assert.deepEqual(Array.from(buttons,b=>b.dataset.reached),[String(shippingReached),String(reconReached)]);
   assert.equal(parseFloat(buttons[0].parentElement.style.left),250/299*100);
   assert.equal(buttons[1].parentElement.style.left,'100%');
  }finally{f.close();}
 }
});
test('milestone labels follow destination eligibility',async()=>{
 for(const [country,expected,count] of [['CA','free standard shipping',2],['GB','free recon solution',1]]){
  const f=await fixture(12600,0,country);
  try{
   assert.equal(f.root.querySelectorAll('.nlc-reward-trigger').length,count);
   assert.match(f.root.querySelector('[data-nlc-unlock-copy]').textContent,new RegExp(expected));
   assert.doesNotMatch(f.root.querySelector('.nlc-rewards').textContent,/priority shipping/i);
  }finally{f.close();}
 }
 for(const [subtotal,width] of [[26970,'0%'],[29900,'100%']]){
  const f=await fixture(subtotal,0,'GB');
  try{
   assert.equal(f.root.querySelector('[role=progressbar]').style.getPropertyValue('--earned-width'),width);
  }finally{f.close();}
 }
});
test('gift details open on hover, focus and tap and dismiss with Escape',async()=>{
 const f=await fixture(12600);
 try{
  const [first,last]=f.root.querySelectorAll('.nlc-reward-trigger');
  const tip=b=>f.w.document.getElementById(b.getAttribute('aria-describedby'));
  assert.ok(tip(first).hidden&&tip(last).hidden);
  first.dispatchEvent(Object.assign(new f.w.Event('pointerenter'),{pointerType:'mouse'}));
  assert.equal(tip(first).hidden,false);
  assert.match(tip(first).textContent,/250\.00.*Free express shipping/);
  first.parentElement.dispatchEvent(Object.assign(new f.w.Event('pointerleave'),{pointerType:'mouse'}));
  assert.equal(tip(first).hidden,true);
  first.focus();
  assert.equal(first.getAttribute('aria-expanded'),'true');
  last.focus();
  assert.ok(tip(first).hidden&&!tip(last).hidden);
  assert.match(tip(last).textContent,/299\.00.*Free express shipping \+ recon solution/);
  const escape=new f.w.KeyboardEvent('keydown',{key:'Escape',cancelable:true,bubbles:true});
  last.dispatchEvent(escape);
  assert.ok(escape.defaultPrevented&&tip(last).hidden);
  last.click();
  assert.equal(tip(last).hidden,false);
  last.click();
  assert.equal(tip(last).hidden,true);
 }finally{f.close();}
});
test('cart retains protection line, exact payment marks and quantity controls',()=>{
 assert.match(js,/nlc-protection-static/);
 assert.match(js,/google-g-clean\.svg/);
 assert.match(js,/nlc-quantity-row/);
 assert.doesNotMatch(js,/name="nlc_protection"/);
});

test('a late quote cannot replace newer milestones or clear a coupon after the cart is emptied',async()=>{
 const f=await fixture(12600);
 try{
  const pending=[];
  f.w.fetch=()=>new Promise(resolve=>pending.push(resolve));
  const quote=(subtotal,applied)=>({ok:true,json:async()=>({
   subtotal_cents:subtotal,discount_cents:0,total_cents:subtotal,free_shipping_threshold_cents:shipping,
   recon_solution_threshold_cents:bacMinimum,pricing:{coupon_code:applied,delivery:{shipping_cents:0}},
  })});
  const older=f.w.AltaCartNmi.offer(f.root);
  await new Promise(resolve=>setImmediate(resolve));
  const newer=f.w.AltaCartNmi.offer(f.root);
  await new Promise(resolve=>setImmediate(resolve));
  pending[1](quote(29900,'BLACKFRIDAY10'));
  await newer;
  pending[0](quote(12600,''));
  await older;
  assert.match(f.root.querySelector('[data-nlc-unlock-copy]').textContent,/unlocked/);
  assert.equal(f.w.localStorage.getItem('ap-cart-coupon'),'BLACKFRIDAY10');

  const outstanding=f.w.AltaCartNmi.offer(f.root);
  await new Promise(resolve=>setImmediate(resolve));
  f.root.replaceChildren('Your cart is empty.');
  pending[2](quote(20000,''));
  await outstanding;
  assert.equal(f.root.textContent,'Your cart is empty.');
  assert.equal(f.w.localStorage.getItem('ap-cart-coupon'),'BLACKFRIDAY10');
 }finally{f.close();}
});
