'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const retired=/additional free|5%.*bank/i;
function referenceSource(file,scope,anchor){
 const source=read(file),views=require('../reference-ui-functions.cjs')[scope];
 assert.ok(source.includes(anchor),file+' exposes the reference view insertion point');
 return source.replace(anchor,Object.entries(views).map(([name,fn])=>'\n '+name+' = '+fn.toString()+';\n').join('')+anchor);
}
async function fixture(route,{workspace=false,cart=[],reviews=null,catalogFixture=null,monthlyAvailable=false}={}){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(read('storefront-v2.html'),{url:'https://getpurelabs.com'+route,runScripts:'outside-only',virtualConsole:vc}),w=dom.window;
 w.localStorage.setItem('ap-age-verified','true');w.matchMedia=()=>({matches:false});
 if(cart.length)w.localStorage.setItem('pp-cart',JSON.stringify(cart));
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('repeat_orders=status')?{available:monthlyAvailable}:String(url).includes('reviews=summary')?reviews:String(url).includes('/data/supplier-coas.json')?require('../data/supplier-coas.json'):[]});
 const scripts=['products.js','product-images.js','quantity-pricing.js'].map(read);
 if(catalogFixture)scripts.push('CATALOG.splice(0,CATALOG.length,...'+JSON.stringify(catalogFixture)+');');
 // The production build replaces these views inside the storefront closure.
 scripts.push(referenceSource('storefront-v2.js','store',' window.AltaStore='));
 if(workspace)scripts.push(read('supplier-coas.js'),referenceSource('workspace-v2.js','workspace',' window.AltaWorkspace='));
 scripts.push(read('reference-ui.js'));
 w.eval(scripts.join('\n'));
 await settle();
 return{w,d:w.document,errors,async close(){await settle();assert.deepEqual(errors,[],route);dom.window.close();}};
}
test('homepage keeps the announcement, five-vial hero and product links with quick buy',async()=>{
 const f=await fixture('/');
 try{
  const {d,w}=f,hero=d.querySelector('.nl-hero');
  const offer=d.querySelector('.ap-announcement.pure-offer-active .pure-offer-trigger');
  assert.equal(offer.querySelector('.pure-offer-action').getAttribute('href'),'/shop');
  assert.equal(offer.querySelector('.pure-offer-buy').textContent,'10% off');
  assert.equal(offer.querySelector('.pure-offer-free').textContent,'BLACKFRIDAY10');
  assert.equal(offer.querySelector('.pure-offer-action').textContent,'Shop now');
  assert.equal([...hero.querySelector('h1').childNodes].map(n=>n.nodeName==='BR'?'\n':n.textContent).join(''),'CUTTING EDGE\nPURITY');
  assert.equal(hero.querySelector('.nl-hero-description').textContent,'Research compounds, product documentation, and straightforward ordering for laboratories and research teams.');
  const heroCopy=hero.querySelector('.nl-hero-copy');
  assert.deepEqual([...heroCopy.querySelectorAll('a,button')].map(a=>[a.textContent,a.getAttribute('href')]),[['SHOP NOW','/shop']]);
  assert.doesNotMatch(heroCopy.textContent,/Black Friday|BLACKFRIDAY10|View Testing/i);
  const packaging=d.querySelector('.pure-home-packaging');
  assert.deepEqual([...packaging.querySelectorAll('a,button')].map(a=>[a.textContent,a.getAttribute('href')]),[['Shop now','/shop']]);
  const highlights=hero.querySelectorAll('.nl-trust > div > span');
  assert.deepEqual([...highlights].map(node=>node.textContent),['Free shipping over $250','99%+ Purity','Verified Lab Testing']);
  assert.equal(highlights[1].querySelector('a').getAttribute('href'),'/coas?product=5-amino-1mq&size=50mg');
  assert.equal(highlights[2].querySelector('a').getAttribute('href'),'/coas');
  assert.equal(hero.querySelectorAll('.nl-trust-check').length,3);
  assert.equal(hero.querySelectorAll('.nl-vial').length,5);
  const featured=[...d.querySelectorAll('#nl-featured .ap-product-card')];
  assert.equal(featured.length,10);
  for(const card of featured){
   const p=w.AltaStore.product(card.dataset.product);assert.ok(p);
   assert.equal(card.querySelectorAll('select,input').length,0,'strength choices stay in the picker');
   assert.ok(card.querySelector('.ap-catalog-action'));
   const photo=card.querySelector('a.ap-product-image');assert.ok(photo?.querySelector('img'));
   const target=new URL(photo.getAttribute('href'),w.location.href);
   assert.equal(target.pathname,'/product/'+p.id);
   assert.ok(p.variants.some(v=>v.size===target.searchParams.get('size')),'photo links retain a valid catalog strength');
   assert.equal(card.querySelector('h3 a').getAttribute('href'),photo.getAttribute('href'));
   assert.equal(card.querySelector('h3 a').textContent,p.name);
  }
  assert.equal(w.AltaStore.cart.length,0);
  assert.equal(d.querySelectorAll('[data-promo-clock],.nl-offer-grid').length,0);
  assert.ok([...d.querySelectorAll('del')].every(price=>price.closest('[data-home-bulk]')));
  assert.equal(d.querySelector('[data-mx-membership-home]'),null,'the homepage omits the membership comparison');
  const supplierReport=require('../data/supplier-coas.json').reports.find(r=>r.product_id==='retatrutide'&&r.size==='20mg'&&r.lab_name==='Prodigy Labs');
  assert.ok(supplierReport,'the featured 20mg example must exist in the COA source library');
  assert.match(supplierReport.lot,/laboratory sample 202607-PRO-005/);
  assert.equal(supplierReport.inventory_lot_linked,false,'do not confuse the sample number with a delivered PURE lot');
  const coaCard=d.querySelector('.nl-editorial .nl-doc-sheet');
  assert.ok(coaCard,'featured COA card remains present');
  assert.equal(coaCard.querySelector('.nl-doc-sheet-top span').textContent,'VERIFIED LAB TESTING');
  assert.equal(coaCard.querySelector('.nl-doc-sheet-top a, .nl-doc-sheet-top button'),null,'verified lab testing is text, not a duplicate link');
  assert.equal(d.querySelector('.nl-doc-bottom a').getAttribute('href'),'/coas','existing bottom Explore COAS button remains');
  const reportFields=[...coaCard.querySelectorAll('.nl-doc-sheet-row')].map(row=>[
   row.querySelector('span').textContent.trim(),row.querySelector('b').textContent.trim()
  ]);
  assert.deepEqual(reportFields,[
   ['COMPOUND','Retatrutide · 20mg'],
   ['LAB',supplierReport.lab_name],
   ['LAB SAMPLE','202607-PRO-005']
  ]);
  assert.doesNotMatch(coaCard.textContent,/ILLUSTRATIVE PREVIEW|FULFILLED LOT|Retatrutide\s*60\s*mg/i);
  assert.doesNotMatch(d.body.textContent,retired);
 }finally{await f.close();}
});
test('homepage adds verified ratings with the incentive disclosure only when at least one review exists',async()=>{
 for(const [reviews,expected] of [[{count:7,rating:4.1},'4.1/5 · 7 reviews'],[{count:1,rating:3},'3.0/5 · 1 review'],[{count:0,rating:null},null]]){
  const f=await fixture('/',{reviews});
  try{
   const row=f.d.querySelector('.nl-trust');
   assert.equal(row.querySelectorAll('.nl-trust-check').length,3);
   const rating=row.querySelector('.nl-trust-rating');
   if(expected){
    assert.ok(rating.textContent.includes(expected));
    assert.equal(rating.querySelector('small').textContent,'Review credit offered');
   }else assert.equal(rating,null);
  }finally{await f.close();}
 }
});
test('catalog photo cards preserve product navigation, exact USD prices, search, filters, sorting and pagination',async()=>{
 const f=await fixture('/shop');
 try{
  const {d,w}=f;
  const catalog=Array.from(w.AltaStore.catalog),cards=()=>[...d.querySelectorAll('#ap-catalog-grid .ap-product-card')];
  const ids=()=>cards().map(card=>card.dataset.product);
  const search=value=>{const input=d.querySelector('#ap-catalog-query');input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const sort=value=>{const select=d.querySelector('#ap-catalog-sort');select.value=value;select.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const assertPhotoCards=()=>{
   for(const card of cards()){
    const p=w.AltaStore.product(card.dataset.product),photo=card.querySelector('a.ap-product-image'),name=card.querySelector('h3 a');
    assert.ok(p&&photo?.querySelector('img')&&name,'each product has a linked photo and name');
    const target=new URL(photo.getAttribute('href'),w.location.href),variant=p.variants.find(v=>v.size===target.searchParams.get('size'));
    assert.equal(target.pathname,'/product/'+p.id);assert.ok(variant,'photo links select a valid catalog strength');
    assert.equal(photo.querySelector('img').getAttribute('src'),w.AltaStore.image(p,variant.size),'photo matches the linked strength');
    assert.equal(name.getAttribute('href'),photo.getAttribute('href'));assert.equal(name.textContent,p.name);
    const price=card.querySelector('.nl-featured-price');assert.ok(price);
    assert.equal(price.textContent,'$'+variant.price.toLocaleString('en-US',{minimumFractionDigits:Number.isInteger(variant.price)?0:2,maximumFractionDigits:2}));
    assert.equal(photo.contains(name),false,'name remains separate from the product photo');
    assert.equal(photo.contains(price),false,'price remains separate from the product photo');
    const action=card.querySelector('button.ap-catalog-action');
    assert.equal(action?.dataset.action,p.variants.length>1?'catalog-options':'add');
    assert.match(action.textContent,/^add to cart$/i);
    assert.equal(card.querySelector('a.ap-catalog-view').getAttribute('href'),photo.getAttribute('href'));
    assert.equal(card.querySelectorAll('select,input,button').length,1,'the catalog card has one purchase button');
    assert.doesNotMatch(card.textContent,/per unit/i);
   }
  };
  assert.equal(d.querySelectorAll('.nl-badge,del,.ap-pair-offer').length,0);
  const firstPage=ids();assert.ok(firstPage.length>0&&firstPage.length<catalog.length);
  assertPhotoCards();
  assert.equal(d.querySelector('#ap-load-more').hidden,false);
  d.querySelector('#ap-load-more').click();
  assert.ok(cards().length>firstPage.length,'loading more reveals additional products');
  assert.deepEqual(ids().slice(0,firstPage.length),firstPage,'pagination keeps the existing order');
  for(let pages=0;pages<catalog.length&&!d.querySelector('#ap-load-more').hidden;pages++)d.querySelector('#ap-load-more').click();
  assert.equal(d.querySelector('#ap-load-more').hidden,true);
  assert.deepEqual(ids(),catalog.map(p=>p.id),'every product is reachable once through pagination');
  assert.equal(new Set(ids()).size,catalog.length);assertPhotoCards();
  for(const direction of ['low','high']){
   sort(direction);
   const prices=cards().map(card=>Math.min(...w.AltaStore.product(card.dataset.product).variants.map(v=>v.price)));
   assert.deepEqual(prices,[...prices].sort((a,b)=>direction==='low'?a-b:b-a),direction+' price sorting updates the rendered cards');
  }
  sort('name');
  const names=cards().map(card=>card.querySelector('h3 a').textContent);
  assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b)));
  sort('popular');assert.deepEqual(ids(),catalog.map(p=>p.id));
  search('bPc-157');assert.deepEqual(ids(),['bpc-157'],'search is case insensitive');
  assert.equal(d.querySelector('#ap-load-more').hidden,true);assertPhotoCards();
  search('');
  d.querySelector('[data-filter-group=Supplies]').click();
  assert.deepEqual(ids(),catalog.filter(p=>w.AltaStore.categoryOf(p)==='Supplies').map(p=>p.id));
  assert.equal(d.querySelector('[data-filter-group=Supplies]').getAttribute('aria-pressed'),'true');
  search('Reconstitution');assert.equal(cards().length,2,'search combines with the selected category');assertPhotoCards();
  search('retatrutide');assert.equal(cards().length,0,'search does not escape the selected category');
  assert.match(d.querySelector('#ap-catalog-grid').textContent,/No matching compounds/);
  d.querySelector('[data-action="clear-filters"]').click();
  assert.equal(d.querySelector('#ap-catalog-query').value,'');
  assert.equal(d.querySelector('[data-filter-group=All]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(ids(),firstPage,'clearing filters restores the first catalog page');
  assert.equal(catalog.some(p=>p.id==='needles'),false);
  assert.equal(w.AltaStore.cart.length,0,'browsing the catalog never changes the cart');
  assert.doesNotMatch(d.querySelector('.nl-shop').textContent,retired);
 }finally{await f.close();}
});
test('catalog adds single variants directly and asks for an explicit choice on cards with options',async()=>{
 const f=await fixture('/shop',{catalogFixture:[
  {id:'fixture-single',name:'Fixture single',group:'Supplies',variants:[{size:'Small',price:12}]},
  {id:'fixture-multiple',name:'Fixture multiple',group:'Supplies',variants:[{size:'Small',price:15},{size:'Large',price:20}]}
 ]});
 try{
  const {d,w}=f;
  d.querySelector('[data-id="fixture-single"][data-action="add"]').click();
  const cart=()=>Array.from(w.AltaStore.cart,x=>[x.id,x.size,x.qty]);
  assert.deepEqual(cart(),[['fixture-single','Small',1]]);
  const drawer=d.querySelector('#ap-cart-dialog');
  assert.ok(drawer.open,'adding a single variant opens the cart immediately');
  drawer.close();
  const action=d.querySelector('[data-id="fixture-multiple"][data-action="catalog-options"]');
  action.click();
  const dialog=d.querySelector('.ap-catalog-options');
  assert.ok(dialog.open);
  assert.equal(drawer.open,false,'the cart stays closed until a strength is chosen');
  assert.equal(dialog.querySelector('h2').textContent,'Fixture multiple');
  assert.deepEqual([...dialog.querySelectorAll('[data-quick-size]')].map(x=>x.dataset.quickSize),['Small','Large']);
  assert.deepEqual(cart(),[['fixture-single','Small',1]],'opening the picker does not add an item');
  dialog.querySelector('[data-quick-size="Large"]').click();
  assert.equal(dialog.open,false);
  assert.ok(drawer.open,'adding the chosen strength opens the cart');
  assert.deepEqual(cart(),[['fixture-single','Small',1],['fixture-multiple','Large',1]]);
 }finally{await f.close();}
});
test('header and catalog searches show direct shipping and help destinations',async()=>{
 const f=await fixture('/shop');
 try{
  const {d,w}=f;
  d.querySelector('[data-action="search"]').click();
  const search=(id,value)=>{const input=d.getElementById(id);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  search('ap-global-search','shipping rates');
  assert.ok(d.querySelector('#ap-search-results a[href="/shipping-policy.html"]'));
  search('ap-global-search','help');
  assert.ok(d.querySelector('#ap-search-results a[href="/#faq"]'));
  assert.ok(d.querySelector('#ap-search-results a[href="/contact"]'));
  search('ap-catalog-query','shipping');
  assert.ok(d.querySelector('#ap-catalog-grid .ap-catalog-help a[href="/shipping-policy.html"]'));
  assert.ok(d.querySelector('#ap-catalog-grid .ap-catalog-help a[href="/track-order"]'));
  search('ap-catalog-query','');
  assert.equal(d.querySelector('.ap-catalog-help'),null);
 }finally{await f.close();}
});
test('product page shows only Subscribe & Save and bulk savings paths, with regular quantity pricing',async()=>{
 const f=await fixture('/product/retatrutide');
 try{
  const {d,w}=f,product=w.AltaStore.product('retatrutide');
  assert.equal(d.querySelector('#ap-detail-quantity').value,'1');
  assert.equal(d.querySelector('[data-bundle-quantity]'),null);
  assert.equal(d.querySelector('[data-bundle-estimate]'),null);
  const offers=[...d.querySelectorAll('.nl-product-saving-card')];
  assert.equal(offers.length,2);
  assert.match(offers[0].getAttribute('href'),/^\/subscribe-and-save\?product=/);
  assert.match(offers[0].textContent,/SUBSCRIBE & SAVE/);
  assert.match(offers[1].getAttribute('href'),/^\/bulk-orders\?product=retatrutide/);
  assert.match(offers[1].textContent,/Save up to 60%/);
  const price=product.variants[0].price;
  const input=d.querySelector('#ap-detail-quantity');
  input.value='10';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(d.querySelector('[data-bundle-estimate]'),null);
  assert.doesNotMatch(d.querySelector('.ap-detail-copy').textContent,/for \d+ (?:vials?|packs?)/i);
  d.querySelector('[data-action="detail-add"]').click();
  assert.equal(w.AltaStore.cart[0].qty,10);assert.equal(w.AltaStore.cart[0].price,price);
  assert.doesNotMatch(d.querySelector('.ap-detail-copy').textContent,/BOGO|additional free/i);
 }finally{await f.close();}
});

test('mobile size selection retains the quantity and opens the correctly priced cart or monthly order',async()=>{
 const f=await fixture('/product/retatrutide',{monthlyAvailable:true});
 try{
  const {w,d}=f;
  const quantity=d.querySelector('#ap-detail-quantity');
  quantity.value='3';
  quantity.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelectorAll('.ap-mobile-sizes button')[1].click();
  await settle();
  const variant=w.AltaStore.product('retatrutide').variants[1];
  const month=new URL(d.querySelector('.nl-product-saving-card-member').href);
  assert.equal(month.pathname,'/monthly-orders');
  assert.equal(month.searchParams.get('size'),variant.size);
  assert.equal(month.searchParams.get('qty'),'3');
  assert.equal(d.querySelector('#ap-detail-quantity').value,'3');
  assert.equal(d.querySelector('.ap-mobile-sizes [aria-pressed=true]').textContent,variant.size);
  d.querySelector('.ap-mobile-controls [data-action=detail-add]').click();
  assert.equal(w.AltaStore.cart[0].size,variant.size);
  assert.equal(w.AltaStore.cart[0].qty,3);
  assert.equal(d.querySelector('#ap-cart-dialog').open,true);
 }finally{await f.close();}
});

test('bulk ordering grows and clears its summary while preserving exact prices, strengths and the regular cart',async()=>{
 const f=await fixture('/bulk-orders',{workspace:true,cart:[{id:'retatrutide',size:'10mg',qty:2}]});
 try{
  const {d,w}=f;
  const draft=()=>w.AltaStore.read('ap-bulk-draft-v2',[]);
  const regularCart=JSON.stringify(w.AltaStore.cart),storedCart=w.localStorage.getItem('pp-cart');
  const summaryNode=()=>d.querySelector('#ap-bulk-summary');
  const format=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  const summary=()=>d.querySelector('.nl-bulk-estimate-total strong').textContent;
  const search=d.querySelector('#ap-bulk-query');let scrollRequests=0;
  search.scrollIntoView=()=>{scrollRequests++;};
  assert.equal(summaryNode().dataset.empty,'true');assert.equal(draft().length,0);
  const addProducts=summaryNode().querySelector('[data-action="bulk-add-products"]');
  assert.equal(addProducts?.textContent,'ADD PRODUCTS');
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,true);
  search.value='BPC';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-action="bulk-category"][data-group="Peptides"]').click();
  summaryNode().querySelector('[data-action="bulk-add-products"]').click();
  assert.equal(d.activeElement,search);assert.equal(scrollRequests,1,'Add Products scrolls to the product search');
  assert.equal(search.value,'BPC','Add Products preserves the current search');
  assert.equal(d.querySelector('[data-action="bulk-category"][data-group="Peptides"]').getAttribute('aria-pressed'),'true');
  assert.equal(draft().length,0,'Add Products does not add an item');
  search.value='';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-action="bulk-category"][data-group="All"]').click();
  let card=d.querySelector('[data-bulk-product]');assert.ok(card);
  const id=card.dataset.bulkProduct,p=w.AltaStore.product(id),first=p.variants[0],second=p.variants[1];assert.ok(second);
  card.querySelector('[data-action="bulk-qty"][data-delta="1"]').click();
  assert.equal(draft()[0].qty,1);assert.equal(summary(),format(first.price));
  assert.equal(summaryNode().dataset.empty,'false');assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-line').length,1);
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,true,'one unit is below the bulk minimum');
  card.querySelector('[data-action="bulk-qty"][data-delta="10"]').click();
  assert.equal(draft()[0].qty,11);assert.equal(summary(),format(first.price*11));assert.match(summaryNode().querySelector('.nl-bulk-tier-savings').textContent,/Bulk savings/);
  assert.equal(summaryNode().querySelector('.nl-bulk-net span').textContent,'Total');
  assert.deepEqual([...summaryNode().querySelectorAll('.nl-bulk-tier-key > span')].map(x=>x.textContent),['10+ units · 50%','50+ units · 60%']);
  assert.match(summaryNode().querySelector('.nl-bulk-tier-help').textContent,/Combine strengths of the same compound/);
  assert.equal(summaryNode().querySelector('.nl-bulk-included-shipping span').textContent,'Free 2-Day Express Shipping');
  assert.equal(summaryNode().querySelector('.nl-bulk-included-shipping strong').textContent,'FREE');
  assert.doesNotMatch(summaryNode().textContent,/Your regular cart stays saved separately|U\.S\. orders after dispatch|Strengths of each product count together/);
  let input=card.querySelector('[data-bulk-id]');input.value='100';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(draft()[0].qty,100);assert.equal(summary(),format(first.price*100));
  assert.equal(card.querySelector('[data-delta="1"]').disabled,true);
  const adjacentCard=card.nextElementSibling;
  card.querySelector('[data-action="bulk-size"][data-size="'+second.size+'"]').click();
  card=d.querySelector('[data-bulk-product="'+id+'"]');
  assert.equal(card.nextElementSibling,adjacentCard,'switching strength does not replace other cards');
  assert.equal(d.activeElement,card.querySelector('[data-action="bulk-size"][aria-pressed="true"]'));
  assert.equal(card.querySelector('[data-bulk-id]').value,'0');
  assert.equal(card.querySelector('[data-action="bulk-size"][aria-pressed="true"] del').textContent,format(second.price));
  card.querySelector('[data-delta="1"]').click();
  assert.equal(draft().length,2);assert.equal(summary(),format(first.price*100+second.price));
  input=card.querySelector('[data-bulk-id]');input.value='101';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(input.checkValidity(),false);assert.equal(draft().find(x=>x.size===second.size).qty,1);
  input.value='1';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  const otherCard=[...d.querySelectorAll('[data-bulk-product]')].find(node=>node.dataset.bulkProduct!==id),other=w.AltaStore.product(otherCard.dataset.bulkProduct),otherVariant=other.variants[0];
  otherCard.querySelector('[data-action="bulk-qty"][data-delta="1"]').click();
  assert.equal(draft().length,3);assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-product').length,2);
  assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-line').length,3);
  assert.equal(summary(),format(first.price*100+second.price+otherVariant.price));
  search.value='definitely-no-matching-product';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.match(d.querySelector('#ap-bulk-rows').textContent,/No matching products/);assert.equal(draft().length,3);
  search.value='';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-action="bulk-category"][data-group="Supplies"]').click();
  const cards=[...d.querySelectorAll('[data-bulk-product]')];assert.ok(cards.length>0);
  assert.ok(cards.every(c=>w.AltaStore.categoryOf(w.AltaStore.product(c.dataset.bulkProduct))==='Supplies'));
  const remove=(productId,size)=>{
   const button=[...summaryNode().querySelectorAll('.nl-bulk-menu-remove')].find(node=>node.dataset.id===productId&&node.dataset.size===size);
   assert.ok(button,'selected strength has a remove control');button.click();
  };
  remove(other.id,otherVariant.size);
  assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-product').length,1);
  assert.equal(draft().length,2);assert.equal(summary(),format(first.price*100+second.price));
  remove(id,second.size);
  assert.equal(summaryNode().dataset.empty,'false');assert.equal(draft().length,1);assert.equal(summary(),format(first.price*100));
  remove(id,first.size);
  assert.equal(summaryNode().dataset.empty,'true');assert.equal(draft().length,0);assert.equal(summary(),format(0));assert.equal(summaryNode().querySelector('.nl-bulk-tier-savings'),null);
  assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-product,.nl-bulk-menu-line').length,0);
  assert.equal(summaryNode().querySelector('[data-action="bulk-add-products"]').textContent,'ADD PRODUCTS');
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,true);
  assert.equal(JSON.stringify(w.AltaStore.cart),regularCart,'bulk selections never replace the existing regular cart');
  assert.equal(w.localStorage.getItem('pp-cart'),storedCart,'the saved regular cart remains intact');
  const bulkPage=d.querySelector('#ap-main');
  assert.match(bulkPage.textContent,/coupon and partner codes, membership discounts and Crypto savings are available on eligible retail orders/i);
  assert.equal(bulkPage.querySelector('input[name="coupon"], [data-pure-membership-offer], .pure-card-sale'),null);
  assert.doesNotMatch(bulkPage.textContent,/research builder|auto-stack/i);
 }finally{await f.close();}
});

test('COA page filters original reports by product, strength, laboratory and cross-field search',async()=>{
 const f=await fixture('/coas?product=bpc-157&size=10mg',{workspace:true});
 try{
  const {d,w}=f,query=d.querySelector('#ap-coa-query'),cards=()=>[...d.querySelectorAll('.ap-coa-card')];
  const change=async(id,value,event='change')=>{const input=d.querySelector(id);input.value=value;input.dispatchEvent(new w.Event(event,{bubbles:true}));await settle();};
  assert.equal(d.querySelector('#ap-coa-product').value,'bpc-157');
  assert.equal(d.querySelector('#ap-coa-size').value,'10mg');
  assert.equal(cards().length,3);
  assert.ok(cards().every(card=>card.querySelector('h2').textContent==='BPC-157 · 10mg'));
  await change('#ap-coa-lab','Janoshik Analytical');
  assert.equal(cards().length,1);assert.match(cards()[0].textContent,/#149043/);
  await change('#ap-coa-query','BPC157 10 mg Janoshik','input');
  assert.equal(cards().length,1);assert.match(d.querySelector('#ap-coa-count').textContent,/1 COA report found/);
  await change('#ap-coa-query','unmatched-report-identifier','input');
  assert.equal(cards().length,0);assert.match(d.querySelector('#ap-supplier-references').textContent,/No COA report matches/);
  d.querySelector('#ap-coa-reset').click();await settle();
  assert.equal(query.value,'');assert.equal(d.activeElement,query);
  assert.equal(d.querySelector('#ap-coa-product').value,'');assert.equal(d.querySelector('#ap-coa-size').value,'');assert.equal(d.querySelector('#ap-coa-lab').value,'');
  assert.equal(cards().length,require('../data/supplier-coas.json').reports.length);
  await change('#ap-coa-query','149043','input');
  assert.equal(cards().length,1);assert.match(cards()[0].textContent,/Janoshik Analytical/);
  assert.equal(d.querySelector('#ap-supplier-references').getAttribute('aria-busy'),'false');
  assert.match(d.querySelector('#ap-supplier-references').textContent,/request the exact fulfilled-lot COA/);
 }finally{await f.close();}
});

test('bulk order sheet tracks tier changes across strengths and restores the same summary on close',async()=>{
 const f=await fixture('/bulk-orders',{workspace:true});
 try{
  const {d,w}=f,bar=d.querySelector('[data-action="bulk-open-summary"]'),sheet=d.getElementById('nl-bulk-sheet');
  const card=[...d.querySelectorAll('[data-bulk-product]')].find(item=>item.querySelectorAll('[data-action="bulk-size"]').length>1);
  const id=card.dataset.bulkProduct,first=card.querySelector('[data-bulk-id]');
  const badge=card.querySelector('[data-bulk-photo-discount]');
  for(const [units,text] of [[9,''],[10,'50% off'],[49,'50% off'],[50,'60% off'],[49,'50% off']]){
   first.value=String(units);first.dispatchEvent(new w.Event('input',{bubbles:true}));
   assert.equal(badge.textContent,text);
   assert.equal(badge.hidden,!text);
  }
  assert.equal(card.querySelector('.nl-bulk-progress,.nl-bulk-tier-key'),null);
  card.querySelectorAll('[data-action="bulk-size"]')[1].click();
  const chosen=d.querySelector('[data-bulk-product="'+id+'"]');
  chosen.querySelector('[data-delta="1"]').click();
  assert.equal(chosen.querySelector('[data-bulk-photo-discount]').hidden,true,'the photo badge follows the selected strength only');
  assert.match(bar.textContent,/50 units/);
  bar.click();
  assert.equal(sheet.open,true);assert.equal(bar.getAttribute('aria-expanded'),'true');
  assert.equal(sheet.querySelector('.nl-bulk-rate-badge').textContent,'60% off');
  const minus=sheet.querySelector('[data-delta="-1"]');
  minus.focus();minus.click();
  assert.match(bar.textContent,/49 units/);
  assert.equal(sheet.querySelector('.nl-bulk-rate-badge').textContent,'50% off');
  assert.equal(d.activeElement.dataset.delta,'-1');
  assert.equal(sheet.querySelector('[data-action="bulk-checkout"]').disabled,false);
  sheet.querySelector('[data-action="bulk-close-summary"]').click();
  sheet.dispatchEvent(new w.Event('close'));
  assert.equal(sheet.open,false);assert.equal(bar.getAttribute('aria-expanded'),'false');
  assert.ok(d.querySelector('#ap-bulk-catalog > .nl-bulk-summary #ap-bulk-summary'));
  assert.equal(d.querySelectorAll('#ap-bulk-summary').length,1);
 }finally{await f.close();}
});
