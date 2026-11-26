'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {test}=require('node:test');
const {JSDOM}=require('jsdom');
const config=require('../config/checkout.json');
const delivery_options=require('../config/delivery-options.json');
const shipping_zones=require('../config/shipping-zones.json');
const card={id:'card-1',native_provider:'pure_gateway',gateway_origin:'https://payments.example.test',countries:['US','CA']};
const preview={currency:'USD',total_cents:7200,pricing:{subtotal_cents:6300,delivery:{shipping_cents:900}}};
const read=file=>fs.readFileSync(file,'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});

function fixture(t,pathname,html='<main></main>'){
 const dom=new JSDOM(html,{url:'https://getpurelabs.com'+pathname,runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());
 w.eval(read('direct-checkout-client.js'));
 return w;
}

test('guest checkout takes an email, reprices and saves before an exact-origin card handoff',async t=>{
 const w=fixture(t,'/checkout?wallet=apple'),root=w.document.querySelector('main'),requests=[];
 const item={id:'fixture',size:'5mg',key:'fixture:5mg',name:'Catalog item',price:63,qty:1};
 w.AltaStore={cart:[item],catalog:[],product:()=>item,image:()=>'/fixture.svg'};
 w.sessionStorage.setItem('pure-checkout-membership-item-v1','{"plan":"vip","period":"monthly"}');
 w.PureMembershipCheckout={offer(){assert.fail('Guest checkout displayed a membership offer');}};
 w.fetch=async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;
  requests.push({url,init,body});
  assert.equal(init.credentials,'same-origin');
  assert.equal(init.headers.Authorization,undefined);
  if(url.endsWith('checkout=public'))return response({config,delivery_options,shipping_zones,methods:[card,{id:'crypto-1',native_provider:'polygon_usdc',countries:['CA']}],guest_methods:[card.id],balances:{points:100},membership:{}});
  if(url.endsWith('checkout=cart'))return body.coupon?response({error:'Sign in to use this code.'},403):response(preview);
  if(body.action==='quote')return response({...preview,quote:'verified'});
  if(body.action==='place')return response({id:body.id,status:'accepted'});
  assert.equal(body.action,'pay');
  return response({state:'redirected',redirect_url:'https://wrong.example.test/pay?pi=pi_fixture1234'});
 };
 w.localStorage.setItem('ap-shipping-country','CA');
 w.localStorage.setItem('ap-checkout-coupon','CARDTEST');
 w.eval(read('checkout-reference.js'));
 await w.DirectCheckout.checkout(root,null,null);await settle();
 assert.equal(root.querySelector('h1').textContent,'Guest checkout');
 assert.equal(root.querySelector('.nlx-heading a').pathname,'/account/login');
 assert.equal(root.querySelector('[name=country]').value,'CA');
 assert.equal(root.querySelector('[data-nlx-points]').hidden,true);
 assert.equal(w.localStorage.getItem('ap-checkout-coupon'),null);
 assert.match(root.querySelector('[data-nlx-coupon-status]').textContent,/Sign in to use this code/);
 const form=root.querySelector('form');
 for(const [field,value] of Object.entries({first_name:'Fixture',last_name:'Guest',phone:'4165550100',line1:'100 Main St',city:'Waterloo',region:'ON',postal_code:'N2L 3G1'}))form.elements[field].value=value;
 assert.equal(form.elements.email.required,true);
 assert.equal(form.elements.email.readOnly,false);
 root.querySelector('[data-nlx-next]').click();assert.ok(root.querySelector('.nlx-step-shipping'));
 form.elements.email.value='guest@example.test';
 root.querySelector('[data-nlx-next]').click();assert.match(root.querySelector('.nlx-address-confirm').textContent,/guest@example.test/);
 root.querySelector('[data-nlx-back-edit]').click();
 assert.equal(form.elements.email.value,'guest@example.test');assert.equal(form.elements.first_name.value,'Fixture');
 root.querySelector('[data-nlx-next]').click();root.querySelector('[data-nlx-next]').click();
 assert.deepEqual([...root.querySelectorAll('[name=payment_choice]')].map(option=>option.value),['card']);
 const submit=root.querySelector('[data-nlx-place]');assert.equal(submit.disabled,true);
 for(const name of ['ruo','responsibility']){form.elements[name].checked=true;form.elements[name].dispatchEvent(new w.Event('change'));}
 submit.click();await settle();
 const [cart,quote,placed,pay]=requests.slice(-4);
 assert.equal(cart.body.guest,true);assert.equal(cart.body.method_id,card.id);assert.equal(cart.body.country,'CA');
 assert.equal(quote.body.guest,true);assert.equal(placed.body.guest,true);assert.equal(placed.body.email,'guest@example.test');
 assert.equal(quote.body.id,placed.body.id);assert.equal(placed.body.quote,'verified');assert.equal(placed.body.membership_addon,undefined);
 assert.equal(pay.body.invoice_id,placed.body.id);assert.equal(pay.body.confirm_amount_cents,preview.total_cents);
 assert.match(root.querySelector('[data-nlx-status]').textContent,/unexpected payment destination/);
 assert.equal(root.querySelector('.nlx-view-order').getAttribute('href'),'/pay.html?invoice='+placed.body.id+'&guest=1');
 assert.equal(submit.disabled,true);
});

test('guest payment options include available Crypto and Canadian Interac',async t=>{
 for(const country of ['US','CA']){
  const w=fixture(t,'/checkout'),root=w.document.querySelector('main');
  const item={id:'fixture',size:'Single',key:'fixture:Single',name:'Catalog item',price:63,qty:1};
  const crypto={id:'crypto-1',native_provider:'polygon_usdc',countries:['US','CA']};
  const interac={id:'interac-1',kind:'interac',provider_key:'interac',currency:'CAD',countries:['CA']};
  w.AltaStore={cart:[item],catalog:[],product:()=>item,image:()=>'/fixture.svg'};
  w.localStorage.setItem('ap-shipping-country',country);
  w.fetch=async(url,init)=>{
   assert.equal(init.headers.Authorization,undefined);
   if(url.endsWith('checkout=public'))return response({config,delivery_options,shipping_zones,methods:[card,crypto,interac],guest_methods:[card.id,crypto.id,interac.id]});
   assert.ok(url.endsWith('checkout=cart'));
   const body=JSON.parse(init.body);
   assert.equal(body.guest,true);
   return response(body.method_id===interac.id?{...preview,currency:'CAD',total_cents:9700,fx_quote:'fixture-rate',pricing:{...preview.pricing,fx_ppm:1347222}}:preview);
  };
  w.eval(read('checkout-reference.js'));
  await w.DirectCheckout.checkout(root,null,null);await settle();
  const form=root.querySelector('form');
  for(const [field,value] of Object.entries({first_name:'Fixture',last_name:'Guest',email:'guest@example.test',phone:'4165550100',line1:'100 Main St',city:'Test City',region:'ON',postal_code:'N2L 3G1'}))form.elements[field].value=value;
  root.querySelector('[data-nlx-next]').click();root.querySelector('[data-nlx-next]').click();
  assert.deepEqual([...root.querySelectorAll('[name=payment_choice]')].map(option=>option.value),country==='CA'?['card','crypto','interac']:['card','crypto']);
  if(country==='CA'){
   form.querySelector('[value=interac]').click();await settle();
   assert.match(root.querySelector('[data-nlx-place]').textContent,/CA\$97\.00/);
  }
 }
});

test('guest card return confirms and displays the scoped order without starting an account session',async t=>{
 const id='80000000-0000-4000-8000-000000000002',w=fixture(t,'/pay.html?invoice='+id+'&payment_intent=pi_untrusted',read('pay.html'));
 const requests=[];
 w.fetch=async(url,init)=>{
  requests.push({url,init});
  assert.equal(url,'/api/checkout?native=customer&invoice='+id);
  assert.equal(init.headers.Authorization,undefined);
  assert.equal(init.credentials,'same-origin');
  if(init.method==='POST'){assert.deepEqual(JSON.parse(init.body),{action:'confirm_card',invoice_id:id});return response({});}
  return response({invoice:{guest:true,id,order_number:'P00001042',status:requests.length===1?'accepted':'paid',amount_cents:7200,currency:'USD'},gateway:{provider:'pure_gateway',origin:card.gateway_origin},attempts:[{state:'redirected',operation:'sale'}]});
 };
 w.eval(read('native-pay.js'));await settle();
 assert.deepEqual(requests.map(row=>row.init.method),['GET','POST','GET']);
 assert.equal(w.document.getElementById('native-title').textContent,'Payment confirmed');
 assert.match(w.document.getElementById('native-reference').textContent,/P00001042 · Paid/);
 assert.equal(w.document.getElementById('native-back').getAttribute('href'),'/shop');
 w.document.getElementById('native-refresh').click();await settle();
 assert.equal(requests.at(-1).init.method,'GET');
});

test('guest status without its checkout cookie does not open a payment or redirect to sign-in',async t=>{
 const id='80000000-0000-4000-8000-000000000003',w=fixture(t,'/pay.html?invoice='+id+'&guest=1',read('pay.html'));
 const methods=[];
 w.fetch=async(url,init)=>{assert.equal(url,'/api/checkout?native=customer&invoice='+id);methods.push(init.method);return response({error:'Order not found.'},404);};
 w.eval(read('native-pay.js'));await settle();
 assert.deepEqual(methods,['GET']);
 assert.match(w.document.getElementById('native-status').textContent,/browser used at checkout/);
 assert.equal(w.document.getElementById('native-refresh').hidden,true);
 assert.equal(w.document.getElementById('native-form').hidden,true);
});

test('guest pay page opens the exact saved Base or Ethereum route without requesting a transfer',async t=>{
 for(const [provider,label] of [['base_usdc','Base'],['ethereum_usdc','Ethereum']]){
  const id='80000000-0000-4000-8000-000000000004',w=fixture(t,'/pay.html?invoice='+id+'&guest=1',read('pay.html'));
  const requests=[];
  w.fetch=async(url,init)=>{
   requests.push(init.method);
   assert.equal(url,'/api/checkout?native=customer&invoice='+id);
   assert.equal(init.headers.Authorization,undefined);
   return response({invoice:{guest:true,id,status:'accepted',amount_cents:7200,currency:'USD',expires_at:'2099-01-01'},gateway:{provider,ready:true},crypto:{state:'not_started'}});
  };
  w.eval(read('polygon-usdc-pay.js'));w.eval(read('native-pay.js'));await settle();
  assert.equal(w.document.querySelector('.pure-usdc-payment h2').textContent,'Pay with native USDC on '+label);
  assert.match(w.document.getElementById('native-status').textContent,/ETH for gas/);
  assert.deepEqual(requests,['GET']);
 }
});
