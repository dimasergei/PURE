'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const {price}=require('../lib/direct-checkout');
const config=require('../config/checkout.json'),delivery=require('../config/delivery-options.json'),zones=require('../config/shipping-zones.json');
const bank={id:'22222222-2222-4222-8222-222222222222',kind:'bank_transfer',sale_scope:'goods',currency:'USD',label:'Same-Day Bank Payment',active:true};
const card={id:'11111111-1111-4111-8111-111111111111',kind:'hosted_link',sale_scope:'goods',currency:'USD',label:'Card',native_provider:'rampex',rampex_provider:'hosted',countries:['US','CA']};
const user={email:'researcher@example.test',user_metadata:{full_name:'Fixture Researcher',alta_profile:{shipping:{name:'Fixture Researcher',line1:'123 Research Lane',city:'Miami',region:'FL',postal_code:'33101',country:'US',phone:'3055550157'}}}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
function fixture(surface,{legacyCoupon=false,balances={points:0,credit_cents:0},campaign}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://pure-labs.live/'+(surface==='cart'?'shop':'checkout'),runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,requests=[],orderRequests=[];
 let cart=[{id:'fixture',key:'fixture:5mg',name:'Fixture compound',size:'5mg',qty:2,price:80}];
 const products=[{id:'fixture',name:'Fixture compound',variants:[{size:'5mg',price:80}]},{id:'addon',name:'Research add-on',variants:[{size:'10mg',price:30}]}];
 const data={config,delivery_options:delivery,shipping_zones:zones,methods:[card,bank],nmi:null,balances,events:[]};
 w.AltaStore={get cart(){return cart;},catalog:products,product:id=>products.find(p=>p.id===id),image:()=>'/fixture.svg',adjustQuantity(key,delta){cart=cart.map(item=>item.key===key?{...item,qty:item.qty+delta}:item).filter(item=>item.qty>0);}};
 function quote(body){
  const q=price({kind:'goods',request:{items:body.items.map(item=>({...item,name:'Fixture compound',unit_price_usd_cents:8000})),...(body.membership_addon?{membership_addon:body.membership_addon}:{}),address:{country:body.country||body.address?.country||'US'},checkout:{coupon:body.coupon||'',points:body.points||0,credit_cents:body.credit_cents||0,delivery:body.delivery}}},bank,null,balances,null,delivery,null,campaign);
  return {...q,free_shipping_threshold_cents:25000,free_shipping_remaining_cents:Math.max(0,25000-q.subtotal_cents+q.discount_cents)};
 }
 w.fetch=async(url,options={})=>{
  if(String(url).includes('checkout=public'))return {ok:true,json:async()=>data};
  const body=JSON.parse(options.body);requests.push(body);
  try{const result=quote(body);return {ok:true,status:200,json:async()=>result};}
  catch(error){return {ok:false,status:error.status||500,json:async()=>({error:error.message})};}
 };
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-fixture-token'}}})}};
 w.eval(fs.readFileSync('direct-checkout-client.js','utf8'));
 w.DirectCheckout={...w.DirectCheckout,checkout:async()=>{},openHostedPayment:async()=>({paid:true}),api:async(_auth,body)=>{if(!body)return data;orderRequests.push(body);if(body.action==='quote')return {...quote(body),quote:'fixture-signed-quote'};if(body.action==='place')return {id:body.id};throw Error('Unexpected checkout action');}};
 if(legacyCoupon){w.localStorage.setItem('ap-checkout-coupon','BOGO');w.localStorage.setItem('ap-cart-coupon','BOGO');}
 w.eval(fs.readFileSync(surface==='cart'?'cart-reference.js':'checkout-reference.js','utf8'));
 return {dom,w,root:w.document.querySelector('main'),requests,orderRequests,auth,user};
}
for(const surface of ['cart','checkout'])test(surface+': regular purchased quantity, explicit 10% coupon, invalid-code recovery and removal use server totals',async()=>{
 const f=fixture(surface,{legacyCoupon:true});
 try{
  if(surface==='cart')await f.w.AltaCartNmi.offer(f.root);else await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);
  await tick();
  assert.equal(f.requests[0].items[0].qty,2);
  assert.equal(f.requests[0].coupon,'');
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),null);
  assert.match(f.root.textContent,/\$160\.00/);
  assert.match(f.root.textContent,/\$172\.95/);
  assert.doesNotMatch(f.root.textContent,/BOGO|\+\d+ FREE|member(ship)?/i);
  const cryptoOffer='Pay with Crypto at checkout for an extra 5% off the remaining merchandise.';
  if(surface==='cart'){
   const coupon=f.root.querySelector('.nlc-coupon');
   assert.equal(coupon.open,false);
   assert.equal(coupon.querySelector('summary').textContent,'Add coupon code');
   assert.doesNotMatch(f.root.textContent,/Converted prices are estimates|Choose Card or Crypto at checkout|Pay with Crypto at checkout/);
   assert.equal(f.root.querySelector('[data-pure-campaign-countdown]'),null);
   coupon.querySelector('summary').click();
   assert.equal(coupon.open,true);
  }
  assert.doesNotMatch(f.root.textContent.replace(cryptoOffer,''),/\b5% off/i,'No unrelated automatic discount is advertised');
  assert.equal(f.root.querySelector('s,del'),null);
  const input=f.root.querySelector(surface==='cart'?'[name=nlc_coupon]':'[name=sidebar_coupon]');
  const apply=f.root.querySelector(surface==='cart'?'[data-nlc-apply]':'[data-nlx-coupon]');
  const remove=f.root.querySelector(surface==='cart'?'[data-nlc-remove-coupon]':'[data-nlx-remove-coupon]');
  input.value=' blackfriday10 ';apply.click();await tick();
  assert.equal(f.requests.at(-1).coupon,'BLACKFRIDAY10');
  assert.equal(f.requests.at(-1).items[0].qty,2);
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),'BLACKFRIDAY10');
  assert.equal(f.w.localStorage.getItem('ap-cart-coupon'),'BLACKFRIDAY10');
  assert.equal(remove.hidden,false);
  assert.match(f.root.textContent,/BLACKFRIDAY10 applied/);
  if(surface==='cart')assert.match(f.root.querySelector('.nlc-coupon summary').textContent,/BLACKFRIDAY10/);
  assert.match(f.root.textContent,/\$16\.00/);
  assert.match(f.root.textContent,/\$156\.95/);
  if(surface==='cart')assert.match(f.root.querySelector('[data-nlc-unlock-copy]').textContent,/\$106\.00/);
  input.value='BOGO';apply.click();await tick();await tick();
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),'BLACKFRIDAY10','Rejected code cannot replace the applied coupon');
  assert.match(f.root.textContent,/\$156\.95/);
  assert.doesNotMatch(f.root.textContent,/BOGO applied/);
  remove.click();await tick();
  assert.equal(f.requests.at(-1).coupon,'');
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),null);
  assert.equal(f.w.localStorage.getItem('ap-cart-coupon'),null);
  assert.equal(remove.hidden,true);
  assert.match(f.root.textContent,/Coupon removed/);
  assert.match(f.root.textContent,/\$172\.95/);
  if(surface==='cart')assert.match(f.root.querySelector('[data-nlc-unlock-copy]').textContent,/\$90\.00/);
 }finally{f.dom.window.close();}
});
test('checkout Card order quotes and places the same purchased quantity and confirmed coupon',async()=>{
 const f=fixture('checkout');
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);await tick();
  f.root.querySelector('[name=sidebar_coupon]').value='BLACKFRIDAY10';f.root.querySelector('[data-nlx-coupon]').click();await tick();
  f.root.querySelector('[data-nlx-next]').click();f.root.querySelector('[data-nlx-next]').click();await tick();
  const cardChoice=f.root.querySelector('[name=payment_choice][value=card]');cardChoice.checked=true;cardChoice.dispatchEvent(new f.w.Event('change',{bubbles:true}));await tick();
  for(const name of ['ruo','responsibility']){const input=f.root.querySelector('[name='+name+']');input.checked=true;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));}
  const place=f.root.querySelector('[data-nlx-place]');assert.equal(place.disabled,false);place.click();await tick();
  assert.equal(f.orderRequests.length,2);
  assert.equal(f.orderRequests[0].action,'quote');assert.equal(f.orderRequests[1].action,'place');
  for(const body of f.orderRequests){assert.equal(body.items[0].qty,2);assert.equal(body.coupon,'BLACKFRIDAY10');assert.equal(body.kind,'goods');assert.equal(body.method_id,card.id);assert.equal(body.checkout_version,config.version);assert.equal(body.plan,undefined);assert.equal(body.research_builder,undefined);}
  assert.equal(f.orderRequests[1].quote,'fixture-signed-quote');
 }finally{f.dom.window.close();}
});
test('checkout exposes existing balances without promising new rewards',async()=>{
 const f=fixture('checkout',{balances:{points:200,credit_cents:500}});
 try{await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);await tick();assert.ok(f.root.querySelector('a[href="/checkout?balance=1"]'));assert.match(f.root.textContent,/200 points/);assert.doesNotMatch(f.root.textContent,/Earn .*points|membership/i);}finally{f.dom.window.close();}
});


test('checkout membership item lines up with product prices and no redundant payment or delivery copy appears',async()=>{
 const f=fixture('checkout');
 f.w.sessionStorage.setItem('pure-checkout-membership-item-v1',JSON.stringify({plan:'vip',period:'monthly'}));
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);await tick();
  assert.equal(f.requests[0].membership_addon.plan,'vip');
  assert.equal(f.requests[0].membership_addon.period,'monthly');
  const member=f.root.querySelector('.nlx-membership-line');
  assert.ok(member,'The purchased membership remains an ordinary order-summary line');
  assert.equal(member.querySelector('.nlx-product-name strong').textContent,'PURE WHITE');
  assert.equal(member.querySelector('.nlx-membership-period').textContent,'First month');
  assert.equal(member.querySelector('.nlx-product-price').textContent,'$19.99');
  assert.equal(member.querySelectorAll('.nlx-product-price').length,1);
  assert.equal(member.querySelectorAll('small').length,0,'No second-line membership sublabel');
  const css=fs.readFileSync('checkout-reference.css','utf8');
  assert.match(css,/\.nlx-checkout-root \.nlx-membership-line\{[^}]*grid-template-columns:18px minmax\(0,1fr\) auto;[^}]*border-top:0/);
  assert.match(css,/\.nlx-checkout-root \.nlx-membership-line \.nlx-product-name\{[^}]*flex-direction:row!important/);
  assert.match(css,/\.nlx-checkout-root \.nlx-membership-line \.nlx-product-price\{[^}]*grid-column:3;justify-self:end/);
  assert.equal(f.root.querySelector('[data-nlx-quote-note]').textContent,'','No summary shipping explanation below totals');
  f.root.querySelector('[data-nlx-next]').click();await tick();
  assert.doesNotMatch(f.root.textContent,/Next-day service is available for US and Canadian|Carrier eligibility and customs\/import requirements depend/);
  f.root.querySelector('[data-nlx-next]').click();await tick();
  assert.equal(f.root.querySelector('[data-nlx-wallet-note]'),null);
  assert.equal(f.root.querySelector('[data-nlx-payment-currency]'),null);
  assert.doesNotMatch(f.root.textContent,/Choose a wallet, review your order|Your order is priced in USD|Shipping rates are displayed by destination/);
  assert.ok(f.root.querySelector('[name=payment_choice][value=card]'),'Card payment remains available');
  assert.ok(f.root.querySelector('[name=ruo]'),'Required RUO checkbox remains');
  assert.ok(f.root.querySelector('[name=responsibility]'),'Required responsibility checkbox remains');
 }finally{f.dom.window.close();}
});


test('a rejected saved coupon and retired delivery extra cannot block cart totals',async()=>{
 const f=fixture('cart');
 try{
  for(const key of ['ap-checkout-coupon','ap-cart-coupon'])f.w.localStorage.setItem(key,'BLACKFRIDAY15');
  const items=f.w.AltaStore.cart.map(({id,size,qty})=>({id,size,qty}));
  f.w.sessionStorage.setItem('ap-v2-cart-extras:'+JSON.stringify(items),JSON.stringify(['cold_chain','protection']));
  await f.w.AltaCartNmi.offer(f.root);
  assert.deepEqual(f.requests.map(body=>body.coupon),['BLACKFRIDAY15','']);
  assert.deepEqual(f.requests[1].delivery.extras,['protection']);
  assert.equal(f.root.querySelector('.nlc-coupon').open,false);
  assert.match(f.root.querySelector('.nlc-proceed').textContent,/\$172\.95/);
  assert.match(f.root.querySelector('[data-nlc-cart-totals]').textContent,/Subtotal\$160\.00/);
  for(const key of ['ap-checkout-coupon','ap-cart-coupon'])assert.equal(f.w.localStorage.getItem(key),null);
 }finally{f.dom.window.close();}
});

test('a temporarily unavailable quote keeps the saved coupon and allows retrying the same cart',async()=>{
 const f=fixture('cart');
 try{
  f.w.localStorage.setItem('ap-cart-coupon','BLACKFRIDAY10');
  const fetch=f.w.fetch;
  f.w.fetch=async(url,options)=>String(url).includes('checkout=cart')?{ok:false,status:503,json:async()=>({})}:fetch(url,options);
  await f.w.AltaCartNmi.offer(f.root);
  assert.equal(f.w.localStorage.getItem('ap-cart-coupon'),'BLACKFRIDAY10');
  assert.match(f.root.querySelector('[data-nlc-cart-totals]').textContent,/Items subtotal\$160\.00/);
  assert.doesNotMatch(f.root.querySelector('.nlc-proceed').textContent,/\$/);
  f.w.fetch=fetch;
  f.root.querySelector('[data-nlc-retry]').click();await tick();
  assert.match(f.root.querySelector('.nlc-proceed').textContent,/\$156\.95/);
  assert.equal(f.root.querySelector('[data-nlc-retry]'),null);
 }finally{f.dom.window.close();}
});

test('cart destination changes update the economy estimate beside the payable total',async()=>{
 const f=fixture('cart');
 try{
  f.w.localStorage.setItem('ap-currency-mode','manual');
  f.w.localStorage.setItem('ap-currency','USD');
  f.w.eval(fs.readFileSync('locale.js','utf8'));
  await f.w.AltaLocale.ready;
  await f.w.AltaCartNmi.offer(f.root);
  const button=f.root.querySelector('.nlc-proceed');
  assert.equal(button.querySelector('.pure-price-value').textContent,'$172.95');
  assert.doesNotMatch(button.textContent,/<span/i);
  const destination=f.root.querySelector('[data-nlc-country]');
  assert.equal(destination.value,'US');
  assert.equal(f.requests[0].delivery.shipping,'economy');
  assert.match(f.root.querySelector('[data-nlc-cart-totals]').textContent,/Economy shipping estimate\$7\.95/);
  destination.value='CA';destination.dispatchEvent(new f.w.Event('change'));
  await tick();
  assert.equal(f.requests.at(-1).country,'CA');
  assert.equal(f.w.sessionStorage.getItem('pure-cart-destination'),'CA');
  assert.equal(button.querySelector('[data-usd-cents]').dataset.usdCents,'17995');
  assert.match(f.root.querySelector('[data-nlc-cart-totals]').textContent,/Economy shipping estimate\$14\.95/);
  assert.match(f.root.querySelector('.nlc-proceed').textContent,/\$179\.95/);
 }finally{f.dom.window.close();}
});


test('opening checkout directly removes an expired saved code only after a successful new quote',async()=>{
 const f=fixture('checkout');
 try{
  for(const key of ['ap-checkout-coupon','ap-cart-coupon'])f.w.localStorage.setItem(key,'BLACKFRIDAY15');
  await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);await tick();
  assert.deepEqual(f.requests.map(body=>body.coupon),['BLACKFRIDAY15','']);
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/Total\$172\.95/);
  for(const key of ['ap-checkout-coupon','ap-cart-coupon'])assert.equal(f.w.localStorage.getItem(key),null);
  assert.equal(f.root.querySelector('[data-nlx-quote-note]').textContent,'');
 }finally{f.dom.window.close();}
});

test('an obsolete failed response cannot erase a newer checkout total',async()=>{
 const f=fixture('checkout');
 try{
  let rejectOld;
  const fetch=f.w.fetch;
  f.w.fetch=(url,options)=>JSON.parse(options.body).items[0].qty===2?new Promise((resolve,reject)=>{rejectOld=reject;}):fetch(url,options);
  await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);await tick();
  f.root.querySelector('[data-nlx-qty="1"]').click();await tick();
  const totals=f.root.querySelector('[data-nlx-totals]');
  assert.match(totals.textContent,/Total\$252\.95/);
  rejectOld(Error('Old quote failed'));await tick();
  assert.match(totals.textContent,/Total\$252\.95/);
  assert.equal(f.root.querySelector('[data-nlx-quote-note]').textContent,'');
 }finally{f.dom.window.close();}
});


test('checkout shows second-unit savings without adding physical items',async()=>{
 const campaign={discount_bps:2500,eligible_variants:['fixture:5mg']};
 const f=fixture('checkout',{campaign});
 const summary=f.root;
 function check(paid,pairs){
  const rows=summary.querySelectorAll('.nlx-product');
  assert.equal(rows.length,1);
  assert.equal(rows[0].querySelector('.nlx-promo-free'),null);
  assert.equal(rows[0].querySelector('.nlx-qty span').textContent,String(paid));
  assert.equal(rows[0].querySelector('.nlx-product-price').textContent,'$'+(paid*80).toFixed(2));
  assert.equal(summary.querySelector('[data-nlx-item-count]').textContent,paid+(paid===1?' item':' items'));
  const savings=[...summary.querySelector('[data-nlx-totals]').children].find(row=>row.textContent.includes('Second-unit savings'));
  if(pairs)assert.match(savings.textContent,new RegExp(String(pairs*20)));
  else assert.equal(savings,undefined);
 }
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);await tick();
  check(2,1);
  summary.querySelector('[data-nlx-qty="-1"]').click();await tick();check(1,0);
  for(let i=2;i<=4;i++){
   summary.querySelector('[data-nlx-qty="1"]').click();await tick();check(i,Math.floor(i/2));
  }
  summary.querySelector('[data-nlx-qty="-1"]').click();await tick();check(3,1);
 }finally{f.dom.window.close();}
});
