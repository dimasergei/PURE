'use strict';
const {JSDOM,VirtualConsole}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const retiredCopy=/\bBOGO\b|\b(?:ALTA|PURE)\s+(?:GOLD|PLATINUM)\b|buy\s*1\s*,?\s*get\s*1/i;
const retiredRoute=/^\/offers(?:[/.?#]|$)/;
function assertCurrentView(d,route){
 for(const a of d.querySelectorAll('a[href]'))assert.doesNotMatch(a.getAttribute('href'),retiredRoute,route+' has no retired destinations');
 for(const area of d.querySelectorAll('header,#ap-main,footer')){
  const content=area.cloneNode(true);
  content.querySelectorAll('.pure-bogo-home,.pure-card-sale,[data-campaign-product],[data-filter-group="Offers"],[data-pure-collection-title]').forEach(node=>node.remove());
  assert.doesNotMatch(content.textContent,retiredCopy,route+' has no retired brand or BOGO offer copy');
 }
 assert.equal(d.querySelectorAll('#ap-main [data-promo-clock],#ap-main .nl-offer-grid').length,0,route+' has no old sale presentation');
}
async function setup(route,campaign=null,quote=null){const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM(read('public-build/index.html'),{url:'https://getpurelabs.com'+route,runScripts:'outside-only',virtualConsole:console}),w=dom.window;w.localStorage.setItem('ap-age-verified','true');w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.fetch=async url=>({ok:true,json:async()=>String(url).includes('campaign=window')?(campaign||{}):String(url).includes('checkout=cart')?quote:[]});w.AltaConversionConfig=require('../config/conversion.json');w.eval(read('public-build/quantity-pricing.js')+'\n'+read('public-build/membership-experience.js')+'\n'+read('public-build/conversion-ui.js')+'\n'+read('public-build/products.js')+'\n'+read('public-build/product-images.js')+'\n'+read('public-build/storefront-v2.js')+'\n'+read('public-build/workspace-v2.js'));await new Promise(r=>setTimeout(r,0));assert.deepEqual(errors,[],route);assertCurrentView(w.document,route);return{dom,w,d:w.document};}
(async()=>{
 const now=Date.now();
 {
  const staticHome=new JSDOM(read('public-build/index.html'));
  const entry=staticHome.window.document.querySelector('#ap-main');
  assert.equal(entry.querySelector('[data-pure-home-pending] h1').textContent,'PURE');
  assert.equal(entry.querySelector('a').getAttribute('href'),'/shop');
  assert.doesNotMatch(entry.textContent,/CUTTING EDGE|Buy one/i);
  staticHome.window.close();
  const ends_at='2026-12-25T05:00:00.000Z';
  const campaign={ends_at,server_time:'2026-12-10T16:00:00.000Z',eligible_variants:['bpc-157:10mg']};
  const quote={pricing:{coupon_discount_cents:299,bogo_campaign:{ends_at,free_units:[{id:'bpc-157',size:'10mg',qty:1}]}}};
  let confirm;
  const verification=new Promise(resolve=>{confirm=resolve;});
  const {dom,d}=await setup('/',campaign,verification);
  const pending=d.querySelector('[data-pure-home-pending]');
  assert.ok(pending);
  assert.equal(d.querySelector('.nl-hero,.pure-bogo-home'),null);
  pending.querySelector('a').focus();
  confirm(quote);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(d.querySelector('[data-pure-home-pending],.nl-hero'),null);
  assert.equal(d.activeElement,d.querySelector('[data-pure-sale-cta]'));
  const set=d.querySelector('.pure-promo-set:not(.pure-promo-repeat)');
  const [christmas,divider,blackFriday,shipping]=set.children;
  assert.equal(christmas.querySelector('time').dateTime,ends_at);
  const countdown=christmas.querySelector('time span').textContent;
  assert.match(countdown,/^14d \d\d:\d\d:\d\d$/);
  for(const copy of d.querySelectorAll('.pure-promo-repeat time span'))assert.equal(copy.textContent,countdown);
  assert.ok(divider.matches('.pure-promo-divider[aria-hidden="true"]'));
  assert.equal(divider.textContent,'❄');
  assert.equal(blackFriday.querySelector('[data-copy-offer]').dataset.copyOffer,'BLACKFRIDAY10');
  assert.equal(shipping.getAttribute('href'),'/shipping-policy');
  assert.equal(shipping.querySelector('.pure-offer-free').textContent,'$250+');
  assert.equal(shipping.querySelector('.pure-offer-buy').textContent,'Free shipping');
  const hero=d.querySelector('.pure-bogo-home');
  assert.equal(hero.querySelector('h1').textContent,'Buy one, get one Free');
  assert.equal(hero.querySelector('.pure-bogo-copy p').textContent,'Buy one, get one of the same unit FREE, added to your cart automatically. Stack with no limit, through Dec 24.');
  assert.equal(hero.querySelector('.pure-bogo-badge').textContent,'Black Friday Sale');
  const photos=hero.querySelectorAll('.pure-bogo-art img');
  assert.equal(photos.length,2);
  assert.equal(photos[0].getAttribute('src'),photos[1].getAttribute('src'));
  assert.equal(hero.querySelector('.pure-bogo-vial-free span').textContent,'Free');
  assert.equal(hero.querySelector('[data-pure-sale-cta]').getAttribute('href'),'/shop?category=Peptides');
  assert.doesNotMatch(hero.textContent,/BLACKFRIDAY10/);
  assert.ok(d.querySelector('.pure-promo-repeat[aria-hidden="true"]'));
  d.querySelector('.pure-promo-pause').click();
  assert.ok(d.querySelector('.pure-promo-paused'));
  dom.window.close();
  const unverified=await setup('/',campaign,{pricing:{}});
  assert.equal(unverified.d.querySelector('.pure-bogo-home'),null);
  assert.ok(unverified.d.querySelector('.nl-hero'));
  unverified.dom.window.close();
 }
 {
  const {dom,d,w}=await setup('/cart');
  d.querySelector('header [data-action="cart"]').click();
  const drawer=d.querySelector('#ap-cart-dialog');
  const title=d.getElementById(drawer.getAttribute('aria-labelledby'));
  assert.equal(drawer.open,true);
  assert.equal(title.textContent,'Your Cart');
  w.AltaStore.addItems([{id:'bpc-157',size:'10mg',qty:2}]);
  assert.equal(title.textContent,'Your Cart (2)');
  drawer.querySelector('[data-action="cart-quantity"][data-step="-1"]').click();
  assert.equal(title.textContent,'Your Cart (1)');
  drawer.querySelector('[data-action="cart-remove"]').click();
  assert.equal(title.textContent,'Your Cart');
  drawer.querySelector('[aria-label="Close cart"]').click();
  assert.equal(drawer.open,false);
  dom.window.close();
 }
 const offer={second_unit:{discount_bps:2500,eligible_variants:['bpc-157:10mg','ghk-cu:50mg']}};
 for(const route of ['/','/shop','/product/semaglutide?size=10mg','/product/bpc-157?size=10mg']){
  const {dom,d}=await setup(route,offer);
  const link=d.querySelector('.ap-announcement .pure-offer-trigger');
  assert.equal(link.getAttribute('href'),'/shop?offer=second-unit');
  assert.equal(link.textContent,'25% off the second unit on eligible pairs');
  assert.equal(d.querySelector('[data-pure-home-campaign]'),null,'no duplicate hero message');
  if(route.includes('/product/')){
   const reports=d.querySelector('.nl-document-link');
   const reportUrl=new URL(reports.href);
   assert.equal(reportUrl.pathname,'/coas');
   assert.equal(reportUrl.searchParams.get('product'),route.split('?')[0].split('/').at(-1));
   assert.equal(reportUrl.searchParams.get('size'),'10mg');
   const timer=d.querySelector('[data-campaign-product]');
   assert.equal(timer.hidden,!route.includes('bpc-157'));
   if(!timer.hidden)assert.match(timer.textContent,/25% off the second unit/);
  }else{
   const badges=[...d.querySelectorAll('.pure-card-sale')];
   assert.ok(badges.length>0);
   assert.ok(badges.every(b=>['bpc-157','ghk-cu'].includes(b.closest('article').dataset.product)));
  }
  dom.window.close();
 }
 {const {dom,d,w}=await setup('/shop?offer=second-unit',offer);
  assert.equal(d.querySelector('[data-filter-group="Offers"]').getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelector('[data-pure-collection-title]').textContent,'SECOND-UNIT OFFERS');
  assert.deepEqual([...d.querySelectorAll('#ap-catalog-grid .ap-product-image')].map(a=>a.getAttribute('href')).sort(),['/product/bpc-157?size=10mg','/product/ghk-cu?size=50mg']);
  d.querySelector('[data-filter-group="Supplies"]').click();
  assert.equal(d.querySelector('.pure-card-sale'),null);
  assert.equal(new URL(w.location.href).searchParams.has('offer'),false);
  dom.window.close();
 }
 {
  const legacy={ends_at:new Date(now+60000).toISOString(),eligible_variants:['bpc-157:10mg']};
  const {dom,d}=await setup('/shop?offer=bogo',legacy);
  assert.equal(d.querySelector('.pure-offer-trigger:not([data-default-offer],.pure-shipping-slide),.pure-card-sale'),null);
  assert.ok(d.querySelector('#ap-catalog-grid article'),'legacy links open the regular catalog');
  assert.match(d.querySelector('.ap-announcement').textContent,/BLACKFRIDAY10/);
  dom.window.close();
 }
 {const{dom,d,w}=await setup('/');
  const ribbon=d.querySelector('.ap-announcement .pure-offer-trigger[data-default-offer]');
  assert.equal(ribbon.querySelector('.pure-offer-action').getAttribute('href'),'/shop');
  assert.equal(ribbon.querySelector('.pure-offer-free').textContent,'BLACKFRIDAY10');
  assert.ok(ribbon.nextElementSibling.matches('.pure-shipping-slide'));
  assert.match(d.querySelector('h1').textContent,/CUTTING EDGEPURITY/);
  // The Testing route remains discoverable in the footer.
  assert.equal(d.querySelector('#ap-nav a[href="/coas"]'),null);
  assert.equal(d.querySelector('.ap-footer a[href="/coas"]')?.textContent,'Testing');
  assert.equal((read('public-build/storefront-v2.js').match(/coas:'Testing'/g)||[]).length,3);
  const vials=[...d.querySelectorAll('.nl-hero .nl-vial')];
  assert.deepEqual(vials.map(a=>a.getAttribute('href')),['/product/nad','/product/retatrutide','/product/bpc-157','/product/ghk-cu','/product/tirzepatide']);
  assert.equal(vials[2].querySelector('img').getAttribute('fetchpriority'),'high');
  const featured=[...d.querySelectorAll('#nl-featured .ap-product-card')];
  assert.equal(d.querySelector('.nl-featured .pure-home-featured-title').textContent,'Featured Compounds');
  assert.doesNotMatch(d.querySelector('.nl-featured .ap-section-head').textContent,/BLACKFRIDAY10/);
  assert.equal(featured.length,10);
  for(const card of featured){
   const p=w.AltaStore.product(card.dataset.product),photo=card.querySelector('.ap-product-image');
   assert.equal(card.querySelector('.nl-featured-meta h3').textContent,p.name);
   assert.doesNotMatch(card.querySelector('.ap-card-price-line').textContent,/\bfrom\b/i);
   assert.match(card.querySelector('.nl-featured-price').textContent,/^\$[\d,]+(?:\.\d{2})?$/);
   assert.equal(new URL(photo.href).pathname,'/product/'+p.id);
   assert.equal(card.querySelector('select,.nl-size-label'),null);
   assert.ok(card.querySelector('.ap-catalog-action'));
   assert.equal(card.querySelector('.ap-catalog-view').href,photo.href);
   assert.equal(photo.contains(card.querySelector('.nl-featured-meta')),false,'name and price are outside the image');
   assert.doesNotMatch(card.textContent,/per unit|\(\d+\s*mg\)/i);
  }
  const bulk=d.querySelector('.pure-home-volume');
  assert.equal(d.querySelector('.nl-featured').nextElementSibling,bulk,'bulk savings follow featured products');
  assert.equal(d.querySelector('[data-mx-membership-home]'),null);
  const testing=d.querySelector('.nl-editorial');
  assert.deepEqual([...testing.querySelectorAll(':scope > div:first-child > p')].map(p=>p.textContent),['Request the certificate for your fulfilled lot when you order.']);
  const callout=testing.nextElementSibling;
  assert.ok(callout.matches('.pure-home-research'));
  assert.equal(callout.querySelector('h2').textContent,'Ready to start your research?');
  assert.match(callout.querySelector('p').textContent,/available Certificates of Analysis/);
  assert.equal(callout.querySelector('a[href="/shop"]').textContent.trim(),'Shop All Compounds');
  assert.equal(callout.nextElementSibling.id,'faq');
  assert.deepEqual([...testing.querySelectorAll('a[href="/coas"]')], [
   testing.querySelector('.nl-doc-bottom > a')
  ], 'Explore Testing appears only inside the documentation card');
  assert.equal(bulk.querySelector('h2').textContent,'Bulk Orders');
  assert.doesNotMatch(bulk.textContent,/BOGO|monthly auto.?billing/i);
  const form=bulk.querySelector('form[data-home-bulk]');
  const tiers=[...form.querySelectorAll('[data-home-bulk-tier]')];
  assert.deepEqual(tiers.map(tier=>[tier.value,tier.labels[0].querySelector('strong').textContent,tier.labels[0].querySelector('small').textContent,tier.checked]),[['10','10 units','50% off',true],['50','50 units','60% off',false]]);
  assert.equal(bulk.querySelector('header a.pure-home-express-more[href="/bulk-orders"]').getAttribute('aria-label'),'View all bulk products');
  assert.equal(form.querySelector('img,article,details,[data-home-bulk-step],[data-home-bulk-remove]'),null);
  assert.equal(form.querySelectorAll('button').length,1);
  const checkout=form.querySelector('[data-home-bulk-checkout]');
  assert.equal(checkout.textContent,'Bulk Checkout');
  assert.equal(checkout.disabled,false);
  const compound=form.querySelector('[data-home-bulk-compound]');
  const strength=form.querySelector('[data-home-bulk-size]');
  const estimate=form.querySelector('[data-home-bulk-estimate]');
  assert.deepEqual([...compound.options].map(option=>option.value),['retatrutide','bpc-157','ghk-cu']);
  const update=(field,index)=>{
   field.selectedIndex=index;
   field.dispatchEvent(new w.Event('change',{bubbles:true}));
  };
  const assertTotal=quantity=>{
   const variant=w.AltaStore.product(compound.value).variants.find(v=>v.size===strength.value);
   const retail=Math.round(variant.price*100)*quantity;
   const net=retail-w.PureQuantityPricing.bulkDiscountCents(retail,quantity);
   assert.equal(estimate.querySelector('span').textContent,'Est. subtotal');
   assert.equal(estimate.querySelector('del').textContent,w.AltaStore.money(retail/100));
   assert.equal(estimate.querySelector('strong').textContent,w.AltaStore.money(net/100));
  };
  assertTotal(10);
  assert.equal(w.localStorage.getItem('ap-bulk-draft-v2'),null);
  update(compound,1);
  update(strength,1);
  tiers[1].click();
  assertTotal(50);
  const selectedStrength=strength.value;
  update(compound,2);
  update(compound,1);
  assert.equal(strength.value,selectedStrength);
  const storage=Object.getPrototypeOf(w.localStorage),setItem=storage.setItem;
  storage.setItem=function(key,value){
   if(key==='ap-bulk-draft-v2')throw Error('Storage blocked.');
   return setItem.call(this,key,value);
  };
  try{
   form.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
   assert.equal(form.querySelector('[data-home-bulk-notice]').textContent,'Allow browser storage to carry this order to checkout.');
   assert.equal(checkout.disabled,false);
  }finally{storage.setItem=setItem;}
  w.AltaStore.render();
  const refreshed=d.querySelector('[data-home-bulk]');
  assert.equal(refreshed.querySelector('[data-home-bulk-compound]').value,compound.value);
  assert.equal(refreshed.querySelector('[data-home-bulk-size]').value,selectedStrength);
  assert.equal(refreshed.querySelector('[data-home-bulk-tier]:checked').value,'50');
  const faq=d.querySelector('#faq');
  assert.equal(faq.firstElementChild.textContent,'Frequently asked questions');
  assert.equal(faq.firstElementChild.tagName,'H2');
  assert.ok(faq.firstElementChild.nextElementSibling.matches('.pure-faq-list'));
  assert.equal(faq.querySelector('nav'),null);
  const club=d.querySelector('.pure-home-email');
  assert.equal(club.querySelector('.pure-home-email-club').textContent,'PURE CLUB');
  assert.equal(club.querySelector('h2').textContent,'Get 10% off your first order.');
  assert.equal(club.querySelector('.pure-home-email-copy p').textContent,'New compounds, restocks, and COAs first. One code, straight to your inbox.');
  assert.equal(club.querySelector('button[type="submit"]').textContent.trim(),'Get my 10% off');
  dom.window.close();
 }
 {
  const {dom,d,w}=await setup('/');
  d.querySelector('[data-action="cart"]').click();
  const dialog=d.querySelector('#ap-cart-dialog');
  const empty=dialog.querySelector('.nlc-empty-cart');
  assert.ok(dialog.open);
  assert.equal(empty.querySelector('a.ap-button[href="/shop"]').textContent,'Continue Shopping');
  const suggestions=[...empty.querySelectorAll('.nlc-empty-add')];
  assert.deepEqual(suggestions.map(button=>button.dataset.id),['retatrutide','bpc-157','ghk-cu']);
  for(const button of suggestions){
   const product=w.AltaStore.product(button.dataset.id);
   const variant=product.variants.find(v=>v.size===button.dataset.size);
   assert.ok(button.closest('li').querySelector('small').textContent.includes(variant.size));
   assert.ok(variant.price>0);
  }
  const {id,size}=suggestions[0].dataset;
  suggestions[0].click();
  assert.equal(dialog.querySelector('.nlc-empty-cart'),null);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('pp-cart')).map(({id,size,qty})=>({id,size,qty})),[{id,size,qty:1}]);
  assert.equal(d.activeElement,dialog.querySelector('.ap-cart-line a'));
  dialog.querySelector('[data-action="cart-remove"]').click();
  assert.equal(dialog.querySelectorAll('.nlc-empty-add').length,3);
  dom.window.close();
 }
 {const{dom,d,w}=await setup('/shop');
  assert.equal(d.querySelector('h1').textContent,'ALL PRODUCTS.');
  assert.match(d.querySelector('.nl-shop-header p').textContent,/choose the precise strength/);
  assert.equal(d.querySelector('.nl-shop-sale'),null);assert.equal(d.querySelector('#ap-result-count'),null);
  assert.deepEqual([...d.querySelectorAll('.nl-filter-pills button')].map(x=>x.textContent),['All Products','Peptides','Mist Applicators','Supplies']);
  const cards=[...d.querySelectorAll('#ap-catalog-grid .ap-product-card')];assert.equal(cards.length,20);
  for(const card of cards){
   const p=w.AltaStore.product(card.dataset.product),photo=card.querySelector('a.ap-product-image'),url=new URL(photo.href);
   const variant=p.variants.find(v=>v.size===url.searchParams.get('size'));
   assert.ok(variant,'catalog photo links to an available strength');
   assert.equal(url.pathname,'/product/'+p.id);
   assert.equal(card.querySelector('.nl-featured-meta h3').textContent,p.name);
   assert.equal(card.querySelector('.nl-featured-meta h3 a').href,photo.href);
   assert.equal(card.querySelector('.nl-featured-price').textContent,new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:Number.isInteger(variant.price)?0:2,maximumFractionDigits:2}).format(variant.price));
   assert.equal(card.querySelector('select,.nl-card-actions,.nl-size-label,.ap-card-body'),null);
   assert.equal(card.querySelector('button.ap-catalog-action')?.dataset.action,p.variants.length>1?'catalog-options':'add');
   assert.equal(card.querySelector('a.ap-catalog-view').href,photo.href);
   assert.doesNotMatch(card.textContent,/per unit|\(\d+\s*mg\)/i);
  }
  const input=d.querySelector('#ap-catalog-query'),sort=d.querySelector('#ap-catalog-sort');
  assert.ok(input.closest('.nl-shop-controls')===sort.closest('.nl-shop-controls'));
  assert.equal(d.querySelector('label[for="ap-catalog-sort"]').textContent,'Sort by:');
  d.querySelector('#ap-load-more').click();assert.ok(d.querySelectorAll('#ap-catalog-grid .ap-product-card').length>cards.length);
  input.value='BPC-157';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.ok(d.querySelector('#ap-catalog-grid').textContent.includes('BPC-157'));
  const group=d.querySelectorAll('[data-filter-group]')[1];group.click();assert.equal(group.getAttribute('aria-pressed'),'true');
  input.value='';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-filter-group=Supplies]').click();assert.equal(d.querySelectorAll('#ap-catalog-grid .ap-product-card').length,2);
  assert.equal(d.querySelector('[data-filter-group=Equipment]'),null);
  d.querySelector('[data-filter-group=Supplies]').click();sort.value='low';sort.dispatchEvent(new w.Event('change',{bubbles:true}));
  const prices=[...d.querySelectorAll('#ap-catalog-grid .ap-product-card')].map(card=>Math.min(...w.AltaStore.catalog.find(p=>p.id===card.dataset.product).variants.map(v=>v.price)));
  assert.deepEqual(prices,[...prices].sort((a,b)=>a-b));
  assert.equal(w.AltaStore.cart.length,0,'browsing catalog cards does not alter the cart');
  dom.window.close();
 }
 {const{dom,d,w}=await setup('/product/retatrutide');
  assert.equal(d.querySelector('h1').textContent,'Retatrutide (10mg)');
  assert.doesNotMatch(d.querySelector('.ap-detail-copy').textContent,/PU-1 RT/);
  assert.equal(d.querySelector('[data-pure-campaign-countdown]').dataset.campaignProduct,'retatrutide:10mg');
  const paths=[...d.querySelectorAll('.nl-product-saving-card')];
  assert.equal(paths.length,2);
  assert.match(paths[0].getAttribute('href'),/^\/subscribe-and-save\?product=/);
  assert.match(paths[0].textContent,/SUBSCRIBE & SAVE/);
  assert.match(paths[1].textContent,/Save up to 60%/);
  assert.match(paths[1].getAttribute('href'),/^\/bulk-orders\?product=/);
  assert.equal(d.querySelector('[data-bundle-quantity]'),null);
  assert.equal(d.querySelector('#ap-detail-quantity').value,'1');d.querySelector('[data-action="detail-add"]').click();assert.equal(w.AltaStore.cart[0].qty,1);const options=d.querySelectorAll('[data-action="detail-size"]');options[1].click();assert.ok(d.querySelector('h1').textContent.includes(options[1].dataset.size));dom.window.close();}
 {const{dom,d,w}=await setup('/bulk-orders');
  assert.equal(d.querySelector('.nl-bulk-count'),null);assert.equal(d.querySelector('#ap-bulk-count'),null);
  const benefits=[...d.querySelectorAll('.nl-bulk-benefit')];
  assert.equal(benefits.length,4);
  assert.deepEqual(benefits.slice(0,2).map(benefit=>benefit.querySelector('.nl-bulk-benefit-rate').textContent),['50%','60%']);
  assert.deepEqual(benefits.map(benefit=>benefit.querySelector('.nl-bulk-benefit-copy').textContent),['Off every unit at 10+','Off every unit at 50+','Certificates of Analysis','Free 2-day express shipping']);
  assert.match(d.querySelector('.nl-bulk-benefit-shipping small').textContent,/U\.S\. bulk orders · after dispatch/);
  assert.equal(benefits[2].getAttribute('href'),'/coas');
  assert.equal(benefits[2].querySelector('.nl-bulk-coa-proof strong').textContent,'99%+ purity');
  assert.equal(benefits[2].querySelector('.nl-bulk-coa-proof small').textContent,'In select HPLC + MS reports');
  assert.equal(benefits[2].querySelector('.nl-bulk-coa-details small').textContent,'Lab reports · View COAs →');
  const reportedResults=require('../data/coa-results.json');
  const supplierReports=require('../data/supplier-coas.json').reports;
  assert.ok(supplierReports.some(report=>{
   const result=reportedResults[report.id];
   return result?.document_sha256===report.sha256&&parseFloat(result.purity)>=99&&
    result.methods?.some(method=>/HPLC/.test(method))&&result.methods.some(method=>/MS/.test(method));
  }),'a linked supplier report supports the qualified purity badge');
  const hero=d.querySelector('.nl-bulk-hero');
  assert.equal(hero.querySelector('.nl-capsule').textContent,'BULK ORDERS · SALE PRICING');
  assert.equal(hero.querySelector('h1').textContent,'Buy in bulk. Save up to 60%.');
  assert.match(hero.querySelector('p').textContent,/50% on every unit at 10\+ or 60% at 50\+, based on retail prices/);
  assert.equal(hero.querySelector('a,button'),null);
  assert.deepEqual([...d.querySelectorAll('[data-action="bulk-category"]')].map(button=>button.textContent),['All Products','Peptides','Mist Applicators','Supplies']);
  const category=d.querySelector('[data-action="bulk-category"][data-group="Supplies"]');category.click();
  assert.equal(category.getAttribute('aria-pressed'),'true');
  const supplies=[...d.querySelectorAll('.nl-bulk-product')];assert.ok(supplies.length>0);
  assert.ok(supplies.every(card=>w.AltaStore.categoryOf(w.AltaStore.catalog.find(p=>p.id===card.dataset.bulkProduct))==='Supplies'));
  d.querySelector('[data-action="bulk-category"][data-group="All"]').click();
  const qty=d.querySelector('#ap-bulk-rows [data-bulk-id]');
  const variant=w.AltaStore.product(qty.dataset.bulkId).variants.find(v=>v.size===qty.dataset.bulkSize);
  const subtotal=()=>d.querySelector('.nl-bulk-estimate-total strong').textContent;
  const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,true);
  qty.value='1';qty.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(subtotal(),money(variant.price));
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,true,'one unit is below the bulk minimum');
  qty.value='10';qty.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(subtotal(),money(variant.price*10),'larger quantities retain the same catalog unit price');
  assert.equal(w.AltaStore.read('ap-bulk-draft-v2',[])[0].qty,10,'the draft contains exactly the selected units');
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').textContent,'Checkout · '+money(variant.price*5));
  assert.equal(d.querySelector('[data-bulk-threshold="10"]').dataset.tierActive,'true');
  qty.value='50';qty.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(d.querySelector('[data-bulk-threshold="50"]').dataset.tierActive,'true');
  assert.match(qty.closest('article').querySelector('[data-bulk-photo-discount]').textContent,/60% off/);
  qty.value='9';qty.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(d.querySelector('[data-bulk-threshold][data-tier-active="true"]'),null);
  assert.equal(w.AltaStore.cart.length,0);
  assertCurrentView(d,'/bulk-orders after quantity changes');
  dom.window.close();
 }
 for(const route of ['/contact','/partner-program','/coas','/rewards','/track-order']){const{dom,d}=await setup(route);assert.ok(d.querySelector('h1'),route);if(route==='/rewards'||route==='/track-order'){assert.ok(d.querySelector('#ap-main a[href="'+(route==='/rewards'?'/account#rewards-and-credit':'/account/purchases')+'"]'),route+' points to the signed-in account page');}else assert.ok(d.querySelector('#ap-main').textContent.trim().length>150,route);dom.window.close();}
 {
  const {dom,d}=await setup('/track-order'),main=d.querySelector('#ap-main');
  const vercel=require('../vercel.json');
  assert.equal(vercel.rewrites.find(rule=>rule.source==='/track-order')?.destination,'/track-order.html');
  assert.equal(vercel.redirects.some(rule=>rule.source==='/track-order'),false);
  const form=main.querySelector('#ap-track-order-form');
  assert.ok(form.querySelector('input[name="order_number"][required]'));
  assert.ok(form.querySelector('input[name="email"][type="email"][required]'));
  assert.match(main.textContent,/send status and carrier tracking details to the checkout address/i);
  assert.equal(main.querySelector('a[href="/contact"]').textContent,'contact support');
  dom.window.close();
  const fallback=new JSDOM(read('public-build/track-order.html'));
  assert.ok(fallback.window.document.querySelector('#ap-main a[href="/contact"]'));
  fallback.window.close();
  const help=await setup('/contact');
  assert.ok(help.d.querySelector('#ap-main a[href="/track-order"]'));
  help.dom.window.close();
 }
 // COAs and Partner Program use PURE's original dark hero and shared bold uppercase display typography.
 {
  const html=read('public-build/index.html'),stylesheet=read('public-build/pure-coa.css');
  assert.doesNotMatch(html,/pure-editorial-parity\.css/,'the light theme override was removed');
  assert.match(stylesheet,/Dark, high-contrast editorial headers/);
  assert.match(stylesheet,/\.pure-coa-hero-copy h1\{/);
  assert.match(stylesheet,/\.nl-partner-hero h1\{/);
  assert.match(stylesheet,/background:#0b0b0b!important/);
  assert.match(stylesheet,/color:#fff!important/);
  assert.match(stylesheet,/@media\(max-width:767px\)/);
 }
 {
  const {dom,d,w}=await setup('/coas'),page=d.querySelector('.pure-coa-page');
  assert.ok(page,'COA library has a scoped design');
  assert.ok(page.querySelector('.ap-coa-hero'));
  assert.equal(page.querySelector('.ap-coa-hero.pure-editorial-hero'),null,'original hero structure restored');
  const title=page.querySelector('.pure-coa-hero-copy h1');
  assert.equal(title.textContent,'FIND YOUR PRODUCTDOCUMENTATION.');
  assert.equal(title.textContent,title.textContent.toUpperCase());
  assert.equal(title.querySelector('em').textContent,'DOCUMENTATION.');
  assert.ok(page.querySelector('.pure-coa-hero-art'),'PURE identity artwork remains');
  for(const id of ['ap-coa-query','ap-coa-product','ap-coa-size','ap-coa-lab','ap-coa-reset','ap-supplier-references'])
   assert.ok(page.querySelector('#'+id),'COA filter/report function remains: '+id);
  assert.equal(page.querySelector('#ap-coa-reset').type,'button');
  assert.equal(page.querySelector('.ap-coa-results-heading a').getAttribute('href'),'/contact');
  // Actual supplier report rendering: metadata and document actions stay together in each row.
  const fixture=JSON.parse(read('data/supplier-coas.json'));
  const sampleReports=fixture.reports.slice(0,5);
  assert.ok(sampleReports.length>0,'report data fixture exists');
  w.fetch=async()=>({ok:true,json:async()=>({...fixture,reports:sampleReports})});
  w.eval(read('public-build/supplier-coas.js'));
  await w.AltaSupplierCoas.render(d.getElementById('ap-supplier-references'),w.AltaStore.catalog);
  const rows=[...d.querySelectorAll('.ap-supplier-coa-grid .ap-coa-card')];
  assert.equal(rows.length,sampleReports.length,'sample report rows render');
  for(const [index,row] of rows.entries()){
   const report=sampleReports[index];
   assert.equal(row.querySelector('.pure-coa-row-title').textContent,report.product+' · '+report.size);
   assert.deepEqual([...row.querySelectorAll('.pure-coa-row-meta dt')].map(term=>term.textContent),['Laboratory','Certificate publisher','Reported lot','Report date','Report ID']);
   assert.ok(row.querySelector('.pure-coa-row-meta').textContent.includes(report.report_id));
   const actions=row.querySelector('.pure-coa-card-body .ap-actions');
   const primary=actions.querySelector('button.ap-button');
   const original=actions.querySelector('a.ap-coa-original-link');
   assert.ok(primary&&original,'both actions are present on each row');
   assert.equal(actions.children[0],primary);
   assert.equal(actions.children[1],original);
   assert.match(original.textContent,/^Open original (?:PDF|report)$/);
   assert.equal(original.target,'_blank');
   assert.ok(original.rel.includes('noopener'));
   assert.ok(original.href.startsWith('https://'),'original document remains secure');
   assert.equal(original.querySelector('svg')?.getAttribute('aria-hidden'),'true');
  }
  const coaStyles=read('public-build/pure-coa.css');
  assert.ok(coaStyles.includes('.ap-coa-original-link {'),'new original button CSS is published');
  assert.match(coaStyles,/\.pure-coa-page \.ap-supplier-coa-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/,'one report per row across the full archive width');

  dom.window.close();
 }
 {
  const {dom,d}=await setup('/partner-program');
  const hero=d.querySelector('.nl-partner-hero'),h1=hero?.querySelector('h1');
  assert.ok(hero,'Partner page retains the original high-contrast black hero');
  assert.ok(h1);
  assert.equal(h1.textContent,'GOOD RESEARCH GROWSTHROUGH GOOD CONNECTIONS.');
  assert.equal(h1.textContent,h1.textContent.toUpperCase());
  assert.equal(h1.querySelector('em').textContent,'THROUGH GOOD CONNECTIONS.');
  assert.equal(d.querySelector('.pure-partner-program-page'),null,'the light-theme wrapper is removed');
  const rates=[...d.querySelectorAll('.nl-partner-rates article')];
  assert.equal(rates.length,2);
  assert.deepEqual(rates.map(x=>x.querySelector('strong').textContent),['40%','10%']);
  assert.ok(d.querySelector('.nl-partner-actions a[href="/account/partner"]'));
  assert.ok(d.querySelector('.nl-partner-actions a[href="/partner-terms.html"]'));
  assert.equal(d.querySelectorAll('.nl-partner-step-grid article').length,4);
  const rawPage=new JSDOM(read('public-build/partner-program.html'));
  const raw=rawPage.window.document;
  assert.equal(raw.title,d.title);
  assert.equal(raw.querySelector('link[rel="canonical"]').href,'https://getpurelabs.com/partner-program');
  assert.equal(raw.querySelector('meta[property="og:url"]').content,raw.querySelector('link[rel="canonical"]').href);
  assert.match(raw.querySelector('meta[property="og:description"]').content,/40%.*first qualifying.*10%.*later qualifying/);
  assert.equal(raw.querySelector('meta[name="description"]').content,raw.querySelector('meta[property="og:description"]').content);
  assert.equal(raw.querySelector('#ap-main').innerHTML,d.querySelector('#ap-main').innerHTML,'the public landing page is identical before and after JavaScript');
  assert.match(raw.querySelector('main').textContent,/20% off[\s\S]*at least \$100 USD in merchandise after discounts/);
  assert.match(raw.querySelector('main').textContent,/first day of the following month.*eligible balance reaches \$100 USD/);
  assert.match(raw.querySelector('main').textContent,/recorded chargebacks reverse/);
  assert.match(raw.querySelector('main').textContent,/first valid referral link is remembered for 30 days/);
  assert.match(read('public-build/sitemap.xml'),/<loc>https:\/\/getpurelabs\.com\/partner-program<\/loc>/);
  assert.doesNotMatch(read('public-build/robots.txt'),/Disallow: \/(?:partner|$)/m);
  const termsPage=new JSDOM(read('public-build/partner-terms.html'));
  const policy=termsPage.window.document;
  assert.equal(policy.querySelector('link[rel="canonical"]').href,'https://getpurelabs.com/partner-terms.html');
  assert.equal(policy.querySelector('meta[property="og:url"]').content,policy.querySelector('link[rel="canonical"]').href);
  assert.match(policy.querySelector('main').textContent,/discounted merchandise subtotal must be at least \$100 USD/i);
  rawPage.window.close();termsPage.window.close();
  dom.window.close();
 }
 console.log('PASS: built reference pages, retired view removal, product size changes, regular quantities/prices, search/category filters and isolated bulk order.');
})().catch(e=>{console.error(e);process.exitCode=1;});
