'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const cartSource=fs.readFileSync('cart-reference.js','utf8');
const store=fs.readFileSync('storefront-v2.js','utf8');
const compound={id:'compound',category:'injectables',name:'Research compound',variants:[{size:'5mg',price:50}]};
const solution={id:'bac-3',category:'supplies',name:'Reconstitution Solution',variants:[{size:'3 mL',price:14.95}]};
const largerSolution={...solution,id:'bac-10',variants:[{size:'10 mL',price:21.95}]};
const line=(product,size=product.variants[0].size)=>({id:product.id,name:product.name,size,price:product.variants[0].price,qty:1,key:product.id+':'+size});

function fixture(t,{items=[line(compound)],products=[compound,solution,largerSolution],bundled=[],unavailable=false,partnerPending=false}={}){
 const dom=new JSDOM('<div id="cart"></div>',{url:'https://getpurelabs.com/shop',runScripts:'outside-only'});
 t.after(()=>dom.window.close());
 const w=dom.window,root=w.document.getElementById('cart'),requests=[];
 w.AltaStore={cart:items,product:id=>products.find(product=>product.id===id),image:()=>'/fixture.webp'};
 w.fetch=async(url,options)=>{
  if(url.endsWith('checkout=public'))return {ok:true,json:async()=>({methods:[],delivery_options:[]})};
  requests.push(JSON.parse(options.body));
  if(unavailable)return {ok:false,status:503,json:async()=>({error:'Quote unavailable'})};
  return {ok:true,json:async()=>({subtotal_cents:5000,total_cents:6195,partner_offer_pending:partnerPending,pricing:{bundled_items:bundled,delivery:{shipping_cents:1195}}})};
 };
 w.eval(cartSource);
 return {root,requests,render:()=>w.AltaCartNmi.offer(root)};
}

test('cart lists optional supply sizes with their catalog price and existing add action',async t=>{
 const f=fixture(t);
 const pending=f.render();
 assert.equal(f.root.querySelector('[data-nlc-add-on]').hidden,true);
 await pending;
 const panel=f.root.querySelector('[data-nlc-add-on]');
 assert.equal(panel.hidden,false);
 assert.equal(panel.querySelector('h3').textContent,'Optional add-ons');
 assert.equal(panel.querySelectorAll('.nlc-rec').length,2);
 assert.match(panel.textContent,/Reconstitution SolutionExtra 3 mL vial \$14\.95/);
 assert.equal(panel.querySelector('[data-action="add"][data-id="bac-3"][data-size="3 mL"]').textContent,'Add to cart');
 assert.deepEqual(f.requests.map(request=>request.items),[[{id:'compound',size:'5mg',qty:1}]]);
 assert.match(store,/addItems\(\[\{id,size:button\.dataset\.size,qty\}\]\)/);
});

test('cart offers returning to checkout after partner eligibility sign-in and keeps guest checkout available',async t=>{
 const f=fixture(t,{partnerPending:true});
 await f.render();
 const offer=f.root.querySelector('[data-nlc-partner-sign-in]');
 assert.equal(offer.hidden,false);
 assert.equal(offer.querySelector('a').getAttribute('href'),'/account/login?returnTo=%2Fcheckout');
 assert.equal(f.root.querySelector('.nlc-proceed').getAttribute('href'),'/checkout');
});

for(const [description,options] of [
 ['either supply size is already selected',{items:[line(compound),line(largerSolution)]}],
 ['the quote includes the supply as a gift',{bundled:[{id:'gift-bac-3',name:solution.name,size:'3 mL'}]}],
 ['no supply is in the catalog',{products:[compound]}],
 ['the cart cannot accept another line',{items:Array.from({length:60},(_,index)=>line(compound,index+'mg'))}],
 ['a cart quote is unavailable',{unavailable:true}],
])test('cart omits the optional add-on when '+description,async t=>{
 const f=fixture(t,options);
 await f.render();
 assert.equal(f.root.querySelector('[data-nlc-add-on]').hidden,true);
 assert.equal(f.root.querySelector('[data-action="add"]'),null);
});
