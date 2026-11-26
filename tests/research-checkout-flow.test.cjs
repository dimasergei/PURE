'use strict';

const fs=require('node:fs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {pricedBasket}=require('../lib/repeat-orders');
const delivery=require('../lib/delivery-options');
const displayLocaleResponse=require('./display-locale-fixture.cjs');
const checkoutSource=fs.readFileSync('monthly-orders.js','utf8');
const checkoutHTML=fs.readFileSync('monthly-orders.html','utf8');
const planTerms='pure-monthly-invoice-v2';
const invoiceId='11111111-1111-4111-8111-111111111111';
const catalog=Array.from({length:4},(_,i)=>({
  id:'fixture-'+i,name:'Compound '+i,category:'injectables',variants:[{size:'5 mg',price:70},{size:'10 mg',price:100}]
}));
const items=catalog.map(({id})=>({id,size:'5 mg',qty:1}));
const regularCart=JSON.stringify([{id:'unrelated-product',size:'10mg',qty:2}]);
const rates=delivery.defaults;
const protection=rates.find(option=>option.id==='protection').price_cents;
const card={id:'card',label:'Card',currency:'USD',countries:['US','CA']};
const interac={id:'interac',label:'Interac',currency:'CAD',countries:['CA']};
const methods=[card,interac];
const identity={data:{session:{access_token:'fixture_verified_session_1234',user:{id:'fixture-owner',email:'owner@example.test'}}}};
const response=(data,ok=true)=>({ok,json:async()=>data});
const change=(window,input)=>input.dispatchEvent(new window.Event('change',{bubbles:true}));
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function setup(t,{draft=items,draftOrder,signedIn=true,respond,withLocale=false,plans=[]}={}){
  const pathname='/subscribe-and-save/checkout';
  const {window:w}=new JSDOM(checkoutHTML,{url:'https://getpurelabs.com'+pathname,runScripts:'outside-only'});
  t.after(()=>w.close());
  const document=w.document,calls=[];
  if(draft!==null)w.sessionStorage.setItem('pure-monthly-builder',JSON.stringify(draft));
  if(draftOrder)w.sessionStorage.setItem('pure-monthly-builder-order',JSON.stringify(draftOrder));
  w.localStorage.setItem('pp-cart',regularCart);
  w.supabase={createClient:()=>({auth:{getSession:async()=>signedIn?identity:{data:{session:null}}}})};
  w.fetch=async(url,options)=>{
    const display=displayLocaleResponse(url);
    if(display)return display;
    const body=options?.body?JSON.parse(options.body):null;
    calls.push({url,options,body});
    const intercepted=respond&&await respond(body);
    if(intercepted)return intercepted;
    if(url==='/api/customer-config')return response({supabaseUrl:'https://fixture.supabase.co',anonKey:'test'});
    if(!body)return response({catalog,methods,plans,builder_terms:planTerms,protection_cents:protection});
    if(['preview','quote'].includes(body.action)){
      try{
        const country=body.country||body.address.country;
        const price=pricedBasket(body.kind,body.items,catalog,country,rates,body.protection);
        return response({...price,quote:'fixture-signed-quote',terms:planTerms});
      }catch(error){return response({error:error.message},false);}
    }
    if(body.action==='enroll')return response({invoice_id:invoiceId});
    if(body.action==='select_payment')return response({id:invoiceId,reference:'FIXTURE-1',total_cents:body.total_cents,closed:true});
    throw Error('Unexpected action: '+body.action);
  };
  if(withLocale)w.eval(fs.readFileSync('locale.js','utf8'));
  const find=selector=>document.querySelector('#monthly-content '+selector);
  const actions=()=>calls.filter(call=>call.body).map(call=>call.body);
  return {w,document,find,calls,actions,render:()=>w.eval(checkoutSource)};
}

function confirm(env){
  const form=env.find('form');
  const address={name:'Test Buyer',line1:'23 Test Street',city:'Example',region:'NY',postal_code:'10001'};
  for(const [key,value] of Object.entries(address))form.elements[key].value=value;
  form.querySelector('[data-agree]').checked=true;
  form.querySelector('[data-use]').checked=true;
  return form;
}

test('monthly checkout reopens the selected draft with a static strength and a one-month total',async t=>{
  const env=setup(t);
  await env.render();
  const summary=env.find('[data-plan]');
  assert.match(summary.textContent,/Compound 0/);
  assert.match(summary.textContent,/5 mg/);
  assert.match(summary.textContent,/Reconstitution Solution/);
  assert.equal(summary.querySelector('select,input'),null);
  assert.match(env.find('[data-review]').textContent,/\$280\.00/);
  assert.match(env.find('[data-review]').textContent,/Express shippingFree/);
  assert.match(env.find('aside').textContent,/Three monthly deliveries/);
  assert.ok(env.find('a[href="/subscribe-and-save"]'));
  assert.deepEqual(env.actions().map(body=>body.action),['preview']);
  assert.equal(env.w.localStorage.getItem('pp-cart'),regularCart);
});

test('checkout keeps the selected set order while using the aggregated server quote',async t=>{
  const draft = items.map(item => ({...item, qty:2}));
  const draftOrder = [...items,...items];
  const env=setup(t,{draft,draftOrder});
  await env.render();
  const sets=[...env.find('[data-plan]').querySelectorAll('.monthly-set')];
  assert.deepEqual(sets.map(set=>set.querySelector('h3').textContent),['Set 1','Set 2']);
  for(const set of sets){
    assert.deepEqual([...set.querySelectorAll('.monthly-summary-item:not(.monthly-included) div > strong')].map(name=>name.textContent),
      catalog.map(product=>product.name));
    assert.equal(set.querySelectorAll('.monthly-included').length,1);
    assert.equal(set.querySelector('.monthly-summary-item del').textContent,'$70.00');
  }
  assert.deepEqual(env.actions()[0].items,draft);
});

test('an absent or invalid saved draft offers the planner without exposing invoice controls',async t=>{
  for(const draft of [null,[],[{id:items[0].id,size:'discarded variant',qty:1}]]){
    const env=setup(t,{draft});
    env.w.localStorage.setItem('ap-research-builder-v2',JSON.stringify({mode:'subscription',lines:items}));
    await env.render();
    assert.ok(env.find('a[href="/subscribe-and-save"]'));
    assert.equal(env.find('form'),null);
    assert.deepEqual(env.actions(),[]);
    assert.equal(env.w.localStorage.getItem('pp-cart'),regularCart);
  }
});

test('an incomplete current selection shows the server pricing error and cannot enroll',async t=>{
  const env=setup(t,{draft:items.slice(0,3)});
  await env.render();
  assert.match(env.find('[data-review]').textContent,/complete sets of four/);
  assert.equal(env.find('[data-confirm]').disabled,true);
  const form=confirm(env);
  await form.onsubmit({preventDefault(){}});
  assert.deepEqual(env.actions().map(body=>body.action),['preview']);
  assert.equal(env.w.localStorage.getItem('pp-cart'),regularCart);
});

test('an unsigned visitor can preview the monthly amount and must sign in to start a plan',async t=>{
  const env=setup(t,{signedIn:false});
  await env.render();
  const signIn=env.find('a[href^="/account/login"]');
  assert.equal(new URL(signIn.href).searchParams.get('returnTo'),'/subscribe-and-save/checkout');
  assert.equal(env.find('[data-confirm]'),null);
  assert.deepEqual(env.actions().map(body=>body.action),['preview']);
  const call=env.calls.find(entry=>entry.body?.action==='preview');
  assert.equal(call.options.headers.Authorization,undefined);
  assert.equal(call.url,'/api/customer-config?repeat_orders=checkout');
  assert.equal(env.w.location.pathname,'/subscribe-and-save/checkout');
});

test('accepting the three-delivery terms creates one invoice before choosing how to pay it',async t=>{
  const env=setup(t);
  await env.render();
  await env.find('form').onsubmit({preventDefault(){}});
  assert.deepEqual(env.actions().map(body=>body.action),['preview']);
  const form=confirm(env);
  await form.onsubmit({preventDefault(){}});
  const [preview,quote,enroll,payment]=env.actions();
  assert.equal(preview.action,'preview');
  assert.equal(quote.action,'quote');
  assert.equal(quote.plan_terms,planTerms);
  assert.equal(enroll.action,'enroll');
  assert.equal(enroll.id,quote.id);
  assert.equal(enroll.quote,'fixture-signed-quote');
  assert.equal(enroll.terms,planTerms);
  assert.equal(enroll.research_use,true);
  assert.equal(enroll.consent,true);
  assert.deepEqual(enroll.items,items);
  assert.deepEqual(payment,{action:'select_payment',id:invoiceId,total_cents:16800+protection,method_id:'card'});
  assert.equal(env.w.location.search,'?invoice='+invoiceId);
  assert.ok(env.find('a[href="/account/purchases?id='+invoiceId+'"]'));
  assert.equal(env.w.localStorage.getItem('pp-cart'),regularCart);
});

test('a stale terms version or changed price stops checkout before creating an invoice',async t=>{
  for(const changed of [{terms:'pure-monthly-invoice-v1',total_cents:16800+protection},{terms:planTerms,total_cents:1}]){
    const env=setup(t,{respond:body=>body?.action==='quote'?response({quote:'fixture',...changed}):null});
    await env.render();
    await confirm(env).onsubmit({preventDefault(){}});
    assert.ok(env.actions().some(body=>body.action==='quote'));
    assert.ok(env.actions().every(body=>['preview','quote'].includes(body.action)));
    const message=env.document.querySelector('#monthly-status').textContent;
    assert.match(message,changed.terms===planTerms?/total changed/i:/review the current plan terms/i);
    assert.equal(env.find('[data-confirm]').disabled,false);
    assert.equal(env.w.localStorage.getItem('pp-cart'),regularCart);
  }
});

test('destination and optional protection update payment choices and totals while billing stays in USD',async t=>{
  const env=setup(t,{withLocale:true});
  await env.render();
  const {w}=env,form=env.find('form'),review=form.querySelector('[data-review]');
  const amountWithProtection=(16800+protection)/100;
  assert.equal(form.querySelector('[name="method"][value="interac"]'),null);
  assert.ok(review.textContent.includes('$'+amountWithProtection.toFixed(2)));
  form.elements.separate.checked=true;
  form.elements.ship_country.value='CA';
  form.elements.protection.checked=false;
  change(w,form.elements.separate);
  await settle();
  assert.ok(form.querySelector('[name="method"][value="interac"]'));
  assert.match(review.textContent,/\$168\.00/);
  assert.doesNotMatch(review.textContent,/Shipment protection/);
  assert.match(review.textContent,/USD/);
  const latest=env.actions().at(-1);
  assert.deepEqual({country:latest.country,protection:latest.protection},{country:'CA',protection:false});
  const calls=env.actions().length;
  await w.AltaLocale.setCurrency('CAD');
  assert.match(review.textContent,/\$168\.00/);
  assert.match(review.textContent,/USD/);
  assert.equal(env.actions().length,calls);
  assert.equal(env.w.localStorage.getItem('pp-cart'),regularCart);
});
