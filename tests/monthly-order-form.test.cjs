'use strict';
const {test}=require('node:test');
const {JSDOM}=require('jsdom');
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../monthly-orders.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../monthly-orders.html'),'utf8');
test('one-page monthly checkout displays its total immediately and retries enrollment with the same invoice plan', async()=>{
const dom=new JSDOM(html,{url:'https://getpurelabs.com/monthly-orders?product=item&size=S&qty=2',runScripts:'outside-only'}),w=dom.window, calls=[];
const q={quote:'fixturequote',terms:'pure-monthly-invoice-v1',total_cents:2595,pricing:{lines:[{qty:2,name:'Fixture',size:'S',line_total_cents:1800}],bundled_items:[],subtotal_cents:2000,discount_cents:200,delivery:{shipping_cents:795,selection:{shipping:'economy'}}}};
w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-token',user:{id:'owner',user_metadata:{}}}}})}})};
w.fetch=async(url,opts)=>{const body=opts?.body&&JSON.parse(opts.body);calls.push(body||url);
 const result=url.endsWith('config')?{supabaseUrl:'https://fixture.supabase.co',anonKey:'test'}:['preview','quote'].includes(body?.action)?q:body?.action==='enroll'?{error:'Simulated interrupted response. Retry safely.'}:{plans:[],methods:[{id:'mid',currency:'USD',countries:['US','CA'],label:'Card'}],catalog:[{id:'item',name:'Fixture',category:'injectables',variants:[{size:'S'},{size:'L'}]}]};
 return {ok:!result.error,json:async()=>result};};
w.HTMLElement.prototype.scrollIntoView=()=>{};
await w.eval(src);
const d=w.document,form=d.querySelector('form');assert.ok(form,d.body.textContent);
for(const [key,value] of Object.entries({name:'Tester',line1:'123 Main Street',city:'Example',region:'NY',postal_code:'10001'}))form.elements[key].value=value;
assert.match(d.querySelector('[data-review]').textContent,/\$25\.95/);
await form.onsubmit({preventDefault(){}});assert.equal(calls.filter(x=>x.action==='enroll').length,0);
d.querySelector('[data-agree]').checked=true;d.querySelector('[data-use]').checked=true;
await form.onsubmit({preventDefault(){}});await form.onsubmit({preventDefault(){}});
const posts=calls.filter(x=>x.action==='enroll');assert.equal(posts.length,2);assert.equal(posts[0].id,posts[1].id);assert.equal(posts[0].items[0].qty,2);
assert.equal(form.querySelector('[data-shipping]').hidden,true);
assert.equal(form.querySelector('[data-methods] input:checked').value,'mid');
dom.window.close();
});

test('Subscribe & Save checkout discloses the three-delivery term and displays the selected strength as text', async () => {
  const dom = new JSDOM(html, {url:'https://getpurelabs.com/subscribe-and-save/checkout',runScripts:'outside-only'});
  const w = dom.window;
  const preview = {
    total_cents: 2900,
    pricing: {
      lines: [{id:'item',qty:4,name:'Fixture',size:'S',line_total_cents:2400}],
      bundled_items: [{id:'gift-bac-3',qty:1,name:'Reconstitution Solution',size:'3 mL',line_total_cents:0}],
      subtotal_cents: 4000,
      discount_cents: 1600,
      delivery: {shipping_cents:0,extras_cents:500,selection:{shipping:'express'}}
    }
  };
  try {
    w.sessionStorage.setItem('pure-monthly-builder', JSON.stringify([{id:'item',size:'S',qty:4}]));
    w.supabase = {createClient:() => ({auth:{getSession:async () => ({data:{session:null}})}})};
    w.AltaStore = {
      product:id => ({id,variants:id==='bac-3'?[{size:'3 mL',price:14.95}]:[]}),
      image:item => '/fixtures/'+item.id+'.webp'
    };
    w.fetch = async (url, options) => {
      let result;
      if (url.endsWith('config')) result = {supabaseUrl:'https://fixture.supabase.co',anonKey:'test'};
      else if (options?.method === 'POST') result = preview;
      else result = {
        plans: [],
        builder_terms: 'pure-monthly-invoice-v2',
        protection_cents: 500,
        methods: [{id:'mid',currency:'USD',countries:['US','CA'],label:'Card'}],
        catalog: [{id:'item',name:'Fixture',category:'injectables',variants:[{size:'S'},{size:'L'}]}]
      };
      return {ok:true,json:async () => result};
    };
    await w.eval(src);
    const plan = w.document.querySelector('[data-plan]');
    const checkout = w.document.querySelector('.monthly-checkout-summary');
    assert.equal(checkout.querySelector('[data-plan]'),plan);
    assert.equal(checkout.querySelector('[data-item-count]').textContent,'4 items');
    const selected = plan.querySelector('.monthly-summary-item');
    assert.equal(selected.querySelector('img').getAttribute('src'),'/fixtures/item.webp');
    assert.equal(selected.querySelector('small').textContent,'S · Qty 4');
    assert.equal(selected.querySelector('.monthly-item-amount').textContent,'$24.00');
    assert.equal(plan.querySelector('.monthly-included img').getAttribute('src'),'/fixtures/bac-3.webp');
    assert.match(plan.querySelector('.monthly-included').textContent,/With every deliveryIncluded/);
    assert.equal(plan.querySelector('select'), null);
    assert.equal(w.document.querySelectorAll('.monthly-deliveries li').length,3);
    assert.equal(checkout.querySelector('[name=protection]').checked,true);
    assert.match(checkout.textContent, /Three monthly deliveries, paid one invoice at a time/);
    assert.match(checkout.textContent, /Change future selections after your first delivery ships/);
    const review = checkout.querySelector('[data-review]').textContent;
    assert.match(review, /Retail value\$54\.95/);
    assert.match(review, /Subscribe & Save \(40%\)−\$16\.00/);
    assert.match(review, /Included 3 mL solution−\$14\.95/);
    assert.match(review, /Express shippingFree/);
    assert.match(review, /Shipment protection\$5\.00/);
    assert.match(review, /Per month \(USD\)\$29\.00/);
    assert.match(checkout.querySelector('[data-agree]').parentElement.textContent, /three-delivery plan/);
  } finally {
    w.close();
  }
});
