'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const config=require('../config/conversion.json');
function render(quote,callbacks={}){
 const dom=new JSDOM('<main><div id="offer"></div></main>',{url:'https://getpurelabs.com/checkout',runScripts:'outside-only'});
 const w=dom.window;w.eval(fs.readFileSync('membership-checkout.js','utf8'));
 const box=w.document.querySelector('#offer');
 w.PureMembershipCheckout.offer(box,quote,config,callbacks);
 return{dom,w,box};
}
const quote={membership:null,membership_offer:{plans:{vip:{total_savings_cents:1850},elite:{total_savings_cents:2599}}},currency:'USD',pricing:{fx_ppm:1000000}};
test('the checkout offer pairs PURE WHITE savings and the one-month fee with a single add button',()=>{
 const added=[],env=render(quote,{onAdd:choice=>added.push(choice)});
 try{
  const button=env.box.querySelector('[data-pm-add]');
  assert.equal(env.box.querySelectorAll('button').length,1);
  assert.equal(button.textContent,'Add PURE WHITE · $19.99');
  assert.equal(button.previousElementSibling.textContent,'Save $18.50 on this order');
  assert.equal(env.box.querySelector('a'),null);
  button.click();
  assert.deepEqual(JSON.parse(JSON.stringify(added)),[{plan:'vip',period:'monthly'}]);
 }finally{env.dom.window.close();}
});
test('the checkout card is hidden if no PURE WHITE offer is quoted',()=>{
 const env=render({...quote,membership_offer:{plans:{elite:{total_savings_cents:2599}}}});
 try{assert.equal(env.box.hidden,true);assert.equal(env.box.textContent,'');}finally{env.dom.window.close();}
});
test('selected membership is shown once in order item list, not duplicated in upsell area',()=>{
 const env=render({...quote,pricing:{membership_addon:{plan:'vip',period:'monthly',fee_cents:1999}}});
 try{assert.equal(env.box.hidden,true);assert.equal(env.box.textContent,'');}finally{env.dom.window.close();}
});
test('Canadian checkout shows $ for membership fees without US$ prefixes',()=>{
 const env=render({...quote,currency:'CAD',pricing:{fx_ppm:1400000}});
 try{assert.match(env.box.querySelector('[data-pm-add]').textContent,/\$27\.99/);assert.doesNotMatch(env.box.textContent,/US\$/);}finally{env.dom.window.close();}
});
test('active paid member sees no membership add-on prompt',()=>{
 const env=render({...quote,membership:{plan:'vip',name:'PURE WHITE'}});
 try{assert.equal(env.box.hidden,true);assert.equal(env.box.querySelector('[data-pm-add]'),null);}finally{env.dom.window.close();}
});
