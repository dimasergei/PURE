'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('the cart shows confirmed bonus units and gifts beside merchandise, once',async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://example.test/shop',runScripts:'outside-only'});
 const w=dom.window;
 try{
  const items=[
   {id:'fixture',key:'fixture:5mg',size:'5mg',qty:2,price:100,name:'Sample'},
   {id:'fixture',key:'fixture:10mg',size:'10mg',qty:1,price:99,name:'Sample'},
  ];
  w.AltaStore={cart:items,catalog:[],product:()=>items[0],image:()=>'/sample.svg'};
  const quote={
   subtotal_cents:29900,discount_cents:0,total_cents:29900,
   pricing:{bogo_campaign:{free_units:[{id:'fixture',size:'5mg',qty:2}]},
    bundled_items:[{id:'gift-bac-3',name:'Recon solution',size:'3 mL',qty:1}]},
  };
  w.fetch=async url=>({ok:true,json:async()=>String(url).endsWith('=public')?{methods:[],delivery_options:[]}:quote});
  w.eval(fs.readFileSync('cart-reference.js','utf8'));
  const root=w.document.querySelector('main');
  await w.AltaCartNmi.offer(root);
  const [eligible,regular]=root.querySelectorAll('.nlc-line');
  assert.equal(eligible.querySelector('.nlc-unit-bonus').textContent,'+2 free');
  assert.equal(eligible.querySelector('.nlc-unit-bonus').hidden,false);
  assert.equal(eligible.querySelector('.ap-quantity input').value,'2');
  assert.equal(regular.querySelector('.nlc-unit-bonus').hidden,true);
  assert.match(root.querySelector('[data-nlc-gifts]').textContent,/Recon solution.*3 mL.*Free gift/);
  assert.doesNotMatch(root.querySelector('[data-nlc-cart-totals]').textContent,/Recon solution|free units/i);
  assert.equal(root.querySelector('[data-pure-campaign-countdown]'),null);
  assert.match(root.querySelector('.nlc-proceed').textContent,/299\.00/);
 }finally{w.close();}
});

test('the drawer uses a verified session for partner savings without turning a link into a typed coupon',async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://example.test/shop',runScripts:'outside-only'});
 const w=dom.window;
 try{
  const item={id:'test',key:'test:10mg',size:'10mg',qty:1,price:125,name:'Sample'};
  w.AltaStore={cart:[item],catalog:[],product:()=>item,image:()=>'/sample.svg'};
  w.AltaWorkspace={authClient:async()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-session'}}})}})};
  const requests=[];
  w.fetch=async(url,options)=>{
   if(String(url).endsWith('=public'))return {ok:true,json:async()=>({methods:[],delivery_options:[]})};
   requests.push(options);
   return {ok:true,json:async()=>({subtotal_cents:12500,discount_cents:2500,total_cents:10000,automatic_partner_offer:true,
    pricing:{affiliate_code:'LAB20',coupon_discount_cents:2500}})};
  };
  w.eval(fs.readFileSync('cart-reference.js','utf8'));
  const root=w.document.querySelector('main');
  await w.AltaCartNmi.offer(root);
  assert.equal(requests[0].headers.Authorization,'Bearer fixture-session');
  assert.equal(JSON.parse(requests[0].body).coupon,'');
  assert.equal(w.localStorage.getItem('ap-checkout-coupon'),null);
  assert.equal(root.querySelector('[name=nlc_coupon]').value,'');
  assert.match(root.querySelector('[data-nlc-cart-totals]').textContent,/Partner savings.*25.00/);
  assert.equal(root.querySelector('details').open,false);
 }finally{w.close();}
});
