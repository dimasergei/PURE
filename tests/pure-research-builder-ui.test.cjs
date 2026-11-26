'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const builderSource=fs.readFileSync('research-builder-client.js','utf8');
const localeSource=fs.readFileSync('locale.js','utf8');
const displayLocaleResponse=require('./display-locale-fixture.cjs');
const pricing=require('../lib/research-builder-pricing');
const draftKey='pure-member-stack-v1';
const token='fixture_verified_member_session_1234';
const catalog=Array.from({length:5},(_,index)=>({
  id:'compound-'+index,name:'Compound '+index,category:'injectables',group:index%2?'Category B':'Category A',
  variants:[{size:'5 mg',price:100.03+index},{size:'10 mg',price:180.02+index}]
})).concat({id:'bac-3',name:'Reconstitution Solution',category:'supplies',group:'Supplies',variants:[{size:'3 mL',price:14.95}]});
const items=catalog.slice(0,4).map(product=>({id:product.id,size:product.variants[0].size,qty:1}));
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

function setup(t,{draft,respond,withLocale=false,plan='vip',signedIn=true}={}){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://pure.example/fixture',runScripts:'outside-only'});
  const w=dom.window,root=w.document.getElementById('root'),calls=[],navigated=[];
  t.after(()=>w.close());
  if(draft)w.localStorage.setItem(draftKey,JSON.stringify(draft));
  const membership={plan,invoice_id:'fixture-member-invoice'};
  const auth={auth:{getSession:async()=>({data:{session:signedIn?{access_token:token}:null}})}};
  const quote=selection=>pricing.quote(selection,catalog,{membership});
  w.fetch=async(url,options)=>{
    const display=displayLocaleResponse(url);
    if(display)return display;
    const body=options?.body?JSON.parse(options.body):null;
    const call={url,body,options};
    calls.push(call);
    const result=respond&&await respond(call);
    if(result)return result;
    return {ok:true,json:async()=>body?quote(body.items):{catalog,member_plan:plan,terms:pricing.terms}};
  };
  w.AltaStore={catalog,product:id=>catalog.find(product=>product.id===id),image:()=>'/assets/fixture.webp'};
  if(withLocale)w.eval(localeSource);
  w.eval(builderSource);
  const find=selector=>root.querySelector(selector);
  return {w,root,find,calls,navigated,quote,auth,mount:(options={})=>
    w.PureResearchBuilder.mount(root,{auth,navigate:href=>navigated.push(href),...options})};
}

test('member builder accepts four different compounds and gates the dedicated checkout on a server quote',async t=>{
  const env=setup(t),{w,root,find,calls,navigated}=env;
  await env.mount();
  assert.equal(w.document.title,'Member Stack | PURE');
  assert.equal(find('.nl-builder-hero h1').textContent,'MEMBER STACK');
  assert.match(find('.nl-builder-hero p').textContent,/Choose four different compounds and strengths/);
  assert.equal(find('.nl-builder-summary h2').textContent,'Your Member Stack');
  assert.equal(root.querySelectorAll('[data-product]').length,5);
  assert.equal(find('[data-product="bac-3"]'),null);
  assert.equal(find('[data-checkout]').disabled,true);
  for(const item of items)find('[data-add="'+item.id+'"]').click();
  assert.equal(find('[data-checkout]').disabled,true,'The server quote is still pending.');
  await settle();
  assert.deepEqual(calls.find(call=>call.body).body,{action:'quote',mode:'member_stack',items});
  assert.equal(find('[data-add="compound-4"]').disabled,true);
  assert.equal(root.querySelectorAll('.nl-builder-slot.is-selected').length,4);
  assert.match(find('.nl-price-total').textContent,/\$324\.92/);
  find('[data-checkout]').click();
  assert.deepEqual(navigated,['/checkout?member_stack=1']);
  assert.ok(calls.filter(call=>call.body).every(call=>call.body.action==='quote'));
});

test('a BLACK stack presents the verified 40% and included shipping for one purchase',async t=>{
  const env=setup(t,{draft:{lines:items},plan:'elite'}),{find,root,navigated,calls}=env;
  await env.mount();
  assert.match(find('.nl-builder-hero').textContent,/PURE BLACK.*40% off/);
  assert.match(find('.nl-builder-benefits').textContent,/ExpressUS shipping included/);
  assert.match(find('.nl-builder-terms').textContent,/individual purchase/);
  assert.doesNotMatch(root.textContent,/minimum delivery|paid month|automatic renewal|cancel anytime/i);
  assert.match(find('.nl-price-total').textContent,/\$243\.68/);
  assert.match(find('.nl-price-list').textContent,/Reconstitution Solution 3mLIncluded/);
  find('[data-checkout]').click();
  assert.deepEqual(navigated,['/checkout?member_stack=1']);
  assert.ok(calls.every(call=>!call.body||call.body.action==='quote'));
});

test('invalid stored selections are removed and an exact strength change updates the quote',async t=>{
  const env=setup(t,{draft:{lines:[items[0],items[0],{id:'bac-3',size:'3 mL'},items[1]]}}),{w,root,find}=env;
  await env.mount();
  assert.equal(root.querySelectorAll('.nl-builder-slot.is-selected').length,2);
  find('[data-id="compound-0"][data-size="10 mg"]').click();
  find('[data-add="compound-2"]').click();
  find('[data-add="compound-3"]').click();
  await settle();
  const stored=JSON.parse(w.localStorage.getItem(draftKey));
  assert.equal(stored.lines[0].size,'10 mg');
  assert.equal(stored.lines.length,4);
  assert.equal(env.calls.filter(call=>call.body).at(-1).body.items[0].size,'10 mg');
  const search=find('#pure-member-stack-search');
  search.value='Compound 4';
  search.dispatchEvent(new w.Event('input'));
  assert.equal(root.querySelectorAll('[data-product]').length,1);
  assert.equal(root.querySelectorAll('.nl-builder-slot.is-selected').length,4);
});

test('a failed quote keeps checkout disabled without discarding the selected compounds',async t=>{
  const env=setup(t,{draft:{lines:items},respond:call=>call.body?{ok:false,json:async()=>({error:'One selected size is unavailable.'})}:null});
  await env.mount();
  assert.equal(env.find('[data-checkout]').disabled,true);
  assert.match(env.find('[role="alert"]').textContent,/unavailable/);
  assert.deepEqual(JSON.parse(env.w.localStorage.getItem(draftKey)).lines,items);
  assert.deepEqual(env.navigated,[]);
});

test('a late quote for an earlier strength cannot overwrite current pricing',async t=>{
  let resolveFirst;
  const first=new Promise(resolve=>{resolveFirst=resolve;});
  let count=0;
  const env=setup(t,{respond:call=>call.body&&++count===1?first:null});
  await env.mount();
  for(const item of items)env.find('[data-add="'+item.id+'"]').click();
  env.find('[data-id="compound-0"][data-size="10 mg"]').click();
  await settle();
  assert.match(env.find('.nl-price-total').textContent,/\$388\.91/);
  resolveFirst({ok:true,json:async()=>env.quote(items)});
  await settle();
  assert.match(env.find('.nl-price-total').textContent,/\$388\.91/);
  assert.equal(env.find('[data-checkout]').disabled,false);
});

test('an inconsistent server quote fails closed for mode, price, tier, or delivery',async t=>{
  for(const badQuote of [
    {mode:'subscription'},{total_cents:0},{member_plan:'elite'},{shipping_speed:'express'}
  ]){
    const env=setup(t,{draft:{lines:items},respond:call=>call.body?{ok:true,json:async()=>({...env.quote(call.body.items),...badQuote})}:null});
    await env.mount();
    assert.equal(env.find('[data-checkout]').disabled,true);
    assert.match(env.find('[role="alert"]').textContent,/could not be confirmed/);
    assert.deepEqual(env.navigated,[]);
  }
});

test('clearing a quoted stack discards its selection and prevents checkout with the stale quote',async t=>{
  const env=setup(t,{draft:{lines:items}});
  await env.mount();
  assert.equal(env.find('[data-checkout]').disabled,false);
  env.find('[data-clear]').click();
  assert.deepEqual(JSON.parse(env.w.localStorage.getItem(draftKey)).lines,[]);
  assert.equal(env.root.querySelectorAll('.nl-builder-slot.is-selected').length,0);
  assert.equal(env.find('[data-checkout]').disabled,true);
  env.find('[data-checkout]').click();
  assert.deepEqual(env.navigated,[]);
});

test('the active session supplies authorization for both the member catalog and the quote',async t=>{
  const env=setup(t,{draft:{lines:items}});
  env.w.AltaWorkspace={authClient:async()=>env.auth};
  await env.mount({auth:undefined});
  assert.equal(env.calls.length,2);
  assert.equal(env.calls[0].options.method,'GET');
  assert.equal(env.calls[1].options.method,'POST');
  assert.ok(env.calls.every(call=>call.options.headers.Authorization==='Bearer '+token&&call.options.cache==='no-store'));
  assert.match(env.find('.nl-price-total').textContent,/\$324\.92/);
});

test('missing and expired sessions do not expose member products or retry without authorization',async t=>{
  const unsigned=setup(t,{signedIn:false,draft:{lines:items}});
  await unsigned.mount();
  assert.match(unsigned.find('[role="alert"]').textContent,/Sign in/);
  assert.equal(unsigned.calls.length,0);
  assert.equal(unsigned.find('[data-checkout]'),null);
  const denied=setup(t,{draft:{lines:items},respond:()=>({ok:false,status:401,json:async()=>({error:'Expired session'})})});
  await denied.mount();
  assert.match(denied.find('[role="alert"]').textContent,/Expired session/);
  assert.equal(denied.calls.length,1);
  assert.equal(denied.calls[0].options.headers.Authorization,'Bearer '+token);
  assert.equal(denied.find('[data-product]'),null);
});

test('changing display currency preserves member selections, filter, focus and canonical USD quote',async t=>{
  const env=setup(t,{draft:{lines:items},withLocale:true}),{w,find,calls}=env;
  await env.mount();
  find('[data-id="compound-0"][data-size="10 mg"]').click();
  await settle();
  find('[data-group="Category A"]').click();
  const search=find('#pure-member-stack-search');
  search.value='Compound';
  search.dispatchEvent(new w.Event('input'));
  search.focus();
  const selected=find('[data-id="compound-0"][data-size="10 mg"]');
  const draft=w.localStorage.getItem(draftKey);
  const quoteCount=calls.filter(call=>call.body).length;
  const total=find('.nl-price-total [data-usd-cents]');
  assert.equal(total.dataset.usdCents,'38891');
  await w.AltaLocale.setCurrency('CAD');
  assert.equal(find('#pure-member-stack-search'),search);
  assert.equal(w.document.activeElement,search);
  assert.equal(search.value,'Compound');
  assert.equal(find('[data-group="Category A"]').getAttribute('aria-pressed'),'true');
  assert.equal(find('[data-id="compound-0"][data-size="10 mg"]'),selected);
  assert.equal(selected.getAttribute('aria-pressed'),'true');
  assert.equal(find('.nl-price-total [data-usd-cents]'),total);
  assert.equal(total.dataset.usdCents,'38891');
  assert.match(total.textContent,/525\.03/);
  await w.AltaLocale.setCurrency('USD');
  assert.equal(find('.nl-price-total [data-usd-cents]'),total);
  assert.match(total.textContent,/388\.91/);
  assert.equal(w.localStorage.getItem(draftKey),draft);
  assert.equal(calls.filter(call=>call.body).length,quoteCount);
  assert.equal(find('[data-checkout]').disabled,false);
});
