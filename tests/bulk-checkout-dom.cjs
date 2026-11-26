'use strict';
// Isolated browser fixture; no production account, order, or payment is used.
const {JSDOM,VirtualConsole}=require('jsdom'),{webcrypto}=require('node:crypto'),{TextEncoder}=require('node:util');
const fs=require('node:fs'),assert=require('node:assert/strict'),{normalize,price}=require('../lib/direct-checkout');
const config=require('../config/checkout.json'),delivery=require('../config/delivery-options.json'),zones=require('../config/shipping-zones.json');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
(async()=>{
 const errors=[],console=new VirtualConsole();console.on('jsdomError',error=>{if(!/Not implemented: navigation/.test(error.message))errors.push(error.message);});
 const dom=new JSDOM('<main id="root"></main>',{url:'https://pure.example.test/bulk-orders/checkout',runScripts:'outside-only',virtualConsole:console}),w=dom.window,root=w.document.querySelector('main');
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.HTMLElement.prototype.scrollIntoView=()=>{};
 const bulk=[{id:'bulk-compound',name:'Bulk compound',size:'10mg',qty:10,price:100}],regular=[{id:'regular-compound',name:'Regular compound',size:'5mg',qty:2,price:25}],regularSnapshot=JSON.stringify(regular);
 w.localStorage.setItem('pp-cart',regularSnapshot);w.localStorage.setItem('ap-bulk-draft-v2',JSON.stringify(bulk));
 const retailCouponKeys=['ap-cart-coupon','ap-checkout-coupon'];
 for(const key of retailCouponKeys)w.localStorage.setItem(key,'BLACKFRIDAY10');
 w.AltaStore={cart:regular,read:(key,fallback)=>JSON.parse(w.localStorage.getItem(key)||JSON.stringify(fallback)),normalizeLines:value=>JSON.parse(JSON.stringify(value)),product:id=>({id}),image:()=>'/fixture-vial.svg'};
 const method={id:'11111111-1111-4111-8111-111111111111',kind:'hosted_link',native_provider:'rampex',rampex_provider:'hosted',label:'Card',sale_scope:'goods',currency:'USD',active:true,countries:['US','CA']},calls=[];
 const data={config,methods:[method],balances:{points:0,credit_cents:0},capabilities:{card:false},delivery_options:delivery,shipping_zones:zones};
 w.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
  if(!body)return {ok:true,json:async()=>data};
  if(body.action==='pay')return {ok:true,json:async()=>({state:'paid'})};
  const preview=!body.action;
  const normalized=await normalize({},user,preview?{
   ...body,kind:'goods',id:'00000000-0000-4000-8000-000000000001',consent:true,research_use:true,
   name:'Fixture Researcher',checkout_version:config.version,address:{...user.user_metadata.alta_profile.shipping,country:body.country},
  }:body,[{id:'bulk-compound',name:'Bulk compound',variants:[{size:'10mg',price:100}]}]);
  const campaign={ends_at:'2099-01-01T00:00:00Z',eligible_variants:['bulk-compound:10mg']};
  const q=price(normalized,method,null,data.balances,null,delivery,null,campaign);
  assert.equal(q.total_cents,50500); // $1,000 merchandise less $500 bulk savings, plus $5 protection.
  assert.equal(q.pricing.bogo_campaign,undefined);
  assert.deepEqual(q.pricing.bundled_items||[],[],'the bulk discount excludes the retail campaign gift');
  if(body.action==='place')return {ok:true,json:async()=>({id:body.id,status:'accepted'})};
  return {ok:true,json:async()=>({...q,quote:'verified-bulk-quote'})};
 };
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-test-session-token'}}})}},user={id:'00000000-0000-4000-8000-000000000002',email:'fixture@example.test',user_metadata:{alta_profile:{shipping:{name:'Fixture Researcher',line1:'100 Test Street',city:'Test City',region:'FL',postal_code:'33101',country:'US'}}}};
 for(const file of ['readiness-ui.js','direct-checkout-client.js','checkout-reference.js'])w.eval(fs.readFileSync((process.env.PURE_TEST_SOURCE==='1'?'':'public-build/')+file,'utf8'));
 await w.DirectCheckout.checkout(root,auth,user);await tick();
 const preview=calls.find(call=>call.url.endsWith('checkout=cart'));
 assert.ok(preview);
 assert.deepEqual(preview.body.items,[{id:'bulk-compound',size:'10mg',qty:10}]);
 assert.equal(preview.body.delivery.shipping,'express');
 assert.deepEqual(preview.body.delivery.extras,['protection']);
 const initial=root.querySelector('.dc-summary').textContent;
 assert.match(initial,/Bulk savings/i);
 assert.equal(root.querySelector('.dc-summary h2').textContent,'Bulk order summary');
 assert.equal(root.querySelector('.dc-summary a').getAttribute('href'),'/bulk-orders');
 const unitLine=root.querySelector('[data-dc-line-price]');
 assert.equal(unitLine.querySelector('del').textContent,'$1,000.00');
 assert.match(unitLine.textContent,/\$500\.00/);
 assert.match(initial,/\$505\.00/);
 assert.doesNotMatch(initial,/Regular compound|BLACKFRIDAY10|\+10 FREE/i);
 const form=root.querySelector('form');
 assert.equal(form.elements.coupon,undefined);
 assert.equal(form.querySelector('[data-dc-apply-coupon]'),null);
 assert.equal(root.querySelector('.dc-step-nav'),null);
 assert.equal(form.querySelectorAll('.dc-section').length,3);
 assert.ok([...form.querySelectorAll('.dc-section')].every(section=>!section.hidden));
 form.elements.research_use.checked=true;
 form.elements.consent.checked=true;
 await form.onsubmit({preventDefault(){}});
 const final=root.querySelector('.dc-review-summary').textContent;
 assert.match(final,/Bulk savings/i);assert.match(final,/\$505\.00/);
 const place=root.querySelector('.dc-review-summary + button');assert.ok(place);await place.onclick();
 const priced=calls.filter(call=>call.url.endsWith('checkout=cart')||['quote','place'].includes(call.body?.action));
 assert.ok(priced.some(call=>call.body.action==='quote'));
 assert.ok(priced.some(call=>call.body.action==='place'&&call.body.quote==='verified-bulk-quote'));
 for(const {body} of priced){
  assert.equal(body.bulk_order,true);assert.equal(body.coupon||'','');
  assert.deepEqual(body.items,preview.body.items);
 }
 const payment=calls.find(call=>call.body?.action==='pay');assert.equal(payment.body.confirm_amount_cents,50500);
 assert.equal(w.localStorage.getItem('pp-cart'),regularSnapshot);
 for(const key of retailCouponKeys)assert.equal(w.localStorage.getItem(key),'BLACKFRIDAY10');
 assert.equal(w.localStorage.getItem('ap-bulk-draft-v2'),null);assert.deepEqual(errors,[]);dom.window.close();
 process.stdout.write('PASS: eligible bulk units receive the same exclusive tier in preview, order review, placement and the payment amount. The retail cart and coupon survive.\n');
})().catch(error=>{console.error(error);process.exitCode=1;});
