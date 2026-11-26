'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const reply=body=>({ok:true,json:async()=>body});
const today=new Date().toISOString().slice(0,10);
const gift={id:'fcd7a755-1a40-4132-8dff-21421e5615a0',reference:'G-TEST',amount_cents:3575,send_date:today,purchaser_email:'buyer@example.test',recipient_email:'person@example.test',note:'For you <script>',status:'funded'};
test('verified buyer can order for another email, see USD transfer details, claim an eligible gift and sign out',async()=>{
 const dom=new JSDOM(read('lib/templates/gift-cards.html'),{runScripts:'outside-only',url:'https://example.test/gift-cards'}),w=dom.window,d=w.document;
 let onAuth,order,claimed=false,creating=0,claimCount=0;
 w.AltaWorkspace={authClient:async()=>({auth:{onAuthStateChange(fn){onAuth=fn;},getSession:async()=>({data:{session:{access_token:'demo',user:{id:'person'}}}})}})};
 w.fetch=async(url,options)=>{
  if(url.endsWith('=availability'))return reply({available:true,currency:'USD'});
  assert.equal(options.headers.Authorization,'Bearer demo');
  if(url.endsWith('=account'))return reply({purchases:order?[order]:[],received:[{...gift,status:claimed?'claimed':'funded'}]});
  const data=JSON.parse(options.body);
  if(url.endsWith('=claim')){assert.equal(data.id,gift.id);claimCount++;claimed=true;return reply({status:'claimed',amount_cents:3575});}
  assert.ok(url.endsWith('=create'));assert.equal(data.recipient_email,'recipient@example.test');assert.equal(data.confirm_email,data.recipient_email);
  assert.equal(data.amount_cents,3575);assert.equal(data.send_date,today);assert.ok(data.request_id);creating++;
  order={...gift,status:'pending',payment:{label:'USD transfer',payee:'Example payee',instructions:'Fixture bank instructions'}};
  return reply({order});
 };
 w.eval(read('gift-cards.js'));await tick();await tick();
 const form=d.querySelector('form'),fields=form.elements;
 fields.amount.value='35.75';fields.amount.dispatchEvent(new w.Event('input',{bubbles:true}));
 fields.recipientEmail.value=fields.confirmEmail.value='recipient@example.test';fields.consent.checked=true;
 form.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(form.reportValidity(),true);assert.match(form.querySelector('[type=submit]').textContent,/Continue to payment/);
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.match(d.querySelector('[data-gift-status]').textContent,/G-TEST/);
 assert.match(d.querySelector('[data-gift-account-list]').textContent,/Fixture bank instructions/);
 assert.equal(creating,1);
 d.querySelector('.pgc-order .pgc-secondary').click();await tick();
 assert.equal(claimCount,1);assert.match(d.querySelector('[data-gift-account-status]').textContent,/Claimed.*store credit/);
 assert.equal(d.querySelector('.pgc-message script'),null);
 onAuth('SIGNED_OUT',null);
 assert.doesNotMatch(d.querySelector('[data-gift-account-list]').textContent,/example.test/);
 assert.doesNotMatch(d.querySelector('[data-gift-status]').textContent,/Fixture bank/);
 dom.window.close();
});

test('admin operations check exact incoming/outgoing amounts and use authenticated funding, notification and refund actions',async()=>{
 const dom=new JSDOM('<details id="pure-admin-gifts"><summary>Gift cards</summary><div data-admin-gift-list></div></details>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document,actions=[];let status='pending',notification='waiting';
 w.PureAdminAuth={authenticated:true,fetch:async(url,options)=>{
  assert.equal(url,'/api/customer-config?gift_order=admin');
  if(!options.body)return reply({orders:[{...gift,status,notification_status:notification}],has_more:false});
  const data=JSON.parse(options.body);actions.push(data.action);
  if(data.action==='fund'||data.action==='refund_finish'){
   assert.equal(data.amount_cents,3575);assert.equal(data.confirmed,true);assert.equal(data.currency,'USD');assert.ok(data.reference);
  }
  if(data.action==='fund'){status='funded';notification='review';}
  if(data.action==='notify'){assert.equal(data.confirmed,true);notification='accepted';}
  if(data.action==='refund_start')status='refund_pending';
  if(data.action==='refund_finish')status='refunded';
  return reply({status});
 }};
 w.eval(read('admin-gift-cards.js'));
 const panel=d.querySelector('details');panel.open=true;
 panel.dispatchEvent(new w.Event('toggle'));await new Promise(resolve=>setTimeout(resolve,8));
 function action(title){return [...d.querySelectorAll('form')].find(f=>f.querySelector('button').textContent===title);}
 function submit(form){form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
 function referenceFields(form){form.elements.reference.value='TEST-BANK-REF';form.elements.amount.value='35.75';form.elements.verified.checked=true;}
 let form=action('Confirm funding');referenceFields(form);form.elements.amount.value='1';submit(form);await tick();assert.deepEqual(actions,[]);
 form.elements.amount.value='35.75';submit(form);await tick();
 form=action('Retry reviewed email');submit(form);await tick();assert.deepEqual(actions,['fund']);
 form.elements.verified.checked=true;submit(form);await tick();assert.equal(action('Retry reviewed email'),undefined);
 form=action('Reserve funds for refund');form.elements.verified.checked=true;submit(form);await tick();
 form=action('Record completed refund');referenceFields(form);submit(form);await tick();
 assert.deepEqual(actions,['fund','notify','refund_start','refund_finish']);
 assert.match(panel.textContent,/refunded/);
 w.dispatchEvent(new w.CustomEvent('pure-admin-auth-change',{detail:{authenticated:false}}));
 assert.equal(panel.open,false);assert.doesNotMatch(panel.textContent,/example.test/);
 dom.window.close();
});

test('purchase history pages distinguish missing instructions and require confirmation for unpaid cancellation',async()=>{
 const dom=new JSDOM(read('lib/templates/gift-cards.html'),{runScripts:'outside-only',url:'https://example.test/gift-cards'}),w=dom.window,d=w.document;
 let status='pending',cancels=0;
 w.AltaWorkspace={authClient:async()=>({auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{access_token:'demo'}}})}})};
 w.fetch=async(url,options)=>{
  if(url.endsWith('=availability'))return reply({available:true,currency:'USD'});
  if(url.endsWith('=cancel')){const body=JSON.parse(options.body);assert.deepEqual(body,{id:gift.id,confirmed:true});cancels++;status='cancelled';return reply({status});}
  if(url.endsWith('&offset=100'))return reply({purchases:[{...gift,status,payment:null}],received:[],offset:100,has_more:false});
  return reply({purchases:[],received:[gift],offset:0,has_more:true});
 };
 w.eval(read('gift-cards.js'));await tick();await tick();
 const account=d.querySelector('[data-gift-account-list]'),next=()=>[...account.querySelectorAll('button')].find(b=>b.textContent==='Next');
 next().click();await tick();
 assert.equal(next().disabled,true);assert.match(account.textContent,/Page 2/);
 assert.doesNotMatch(account.textContent,/Gifts received|Payee/);
 assert.match(account.textContent,/Contact support@getpurelabs.com/);
 const cancel=account.querySelector('form');
 cancel.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();assert.equal(cancels,0);
 cancel.querySelector('[type=checkbox]').checked=true;
 cancel.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();
 assert.equal(cancels,1);assert.match(account.textContent,/Cancelled/);assert.equal(account.querySelector('form'),null);
 assert.equal(d.querySelector('.pgc-faq a').getAttribute('href'),'/account#rewards-and-credit');
 dom.window.close();
});
