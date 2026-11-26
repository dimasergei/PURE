'use strict';
const {JSDOM,VirtualConsole}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const retiredCopy=/\bBOGO\b|\b(?:ALTA|PURE)\s+(?:GOLD|PLATINUM)\b|buy\s*1\s*,?\s*get\s*1/i;
const retiredRoute=/^\/offers(?:[/.?#]|$)/;
function assertCurrentView(d,route){
 for(const a of d.querySelectorAll('a[href]'))assert.doesNotMatch(a.getAttribute('href'),retiredRoute,route+' has no retired destinations');
 for(const area of d.querySelectorAll('header,#ap-main,footer')){
  const content=area.cloneNode(true);
  content.querySelectorAll('.pure-card-sale,[data-campaign-product],[data-filter-group="Offers"],[data-pure-collection-title]').forEach(node=>node.remove());
  assert.doesNotMatch(content.textContent,retiredCopy,route+' has no retired brand or BOGO offer copy');
 }
 assert.equal(d.querySelectorAll('#ap-main [data-promo-clock],#ap-main .nl-offer-grid').length,0,route+' has no old sale presentation');
}
async function setup(route,campaign=null){const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM(read('public-build/index.html'),{url:'https://getpurelabs.com'+route,runScripts:'outside-only',virtualConsole:console}),w=dom.window;w.localStorage.setItem('ap-age-verified','true');w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.fetch=async url=>({ok:true,json:async()=>String(url).includes('campaign=window')?(campaign||{}):[]});w.AltaConversionConfig=require('../config/conversion.json');w.eval(read('public-build/quantity-pricing.js')+'\n'+read('public-build/membership-experience.js')+'\n'+read('public-build/conversion-ui.js')+'\n'+read('public-build/products.js')+'\n'+read('public-build/product-images.js')+'\n'+read('public-build/storefront-v2.js')+'\n'+read('public-build/workspace-v2.js'));await new Promise(r=>setTimeout(r,0));assert.deepEqual(errors,[],route);assertCurrentView(w.document,route);return{dom,w,d:w.document};}
(async()=>{
 const now=Date.now();
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
  assert.equal(d.querySelector('.pure-offer-trigger:not([data-default-offer]),.pure-card-sale'),null);
  assert.ok(d.querySelector('#ap-catalog-grid article'),'legacy links open the regular catalog');
  assert.match(d.querySelector('.ap-announcement').textContent,/BLACKFRIDAY10/);
  dom.window.close();
 }
 {const{dom,d,w}=await setup('/');
  const ribbon=d.querySelector('.ap-announcement .pure-offer-trigger[data-default-offer]');
  assert.equal(ribbon.querySelector('.pure-offer-action').getAttribute('href'),'/shop');
  assert.equal(ribbon.querySelector('.pure-offer-free').textContent,'BLACKFRIDAY10');
  assert.match(d.querySelector('h1').textContent,/CUTTING EDGEPURITY/);
  // The Testing route remains discoverable in the footer.
  assert.equal(d.querySelector('#ap-nav a[href="/coas"]'),null);
  assert.equal(d.querySelector('.ap-footer a[href="/coas"]')?.textContent,'Testing');
  assert.equal((read('public-build/storefront-v2.js').match(/coas:'Testing'/g)||[]).length,3);
  const vials=[...d.querySelectorAll('.nl-hero .nl-vial')];
  assert.deepEqual(vials.map(a=>a.getAttribute('href')),['/product/nad','/product/retatrutide','/product/bpc-157','/product/ghk-cu','/product/tirzepatide']);
  assert.equal(vials[2].querySelector('img').getAttribute('fetchpriority'),'high');
  const featured=[...d.querySelectorAll('#nl-featured .ap-product-card')];
  assert.equal(featured.length,10);
  for(const card of featured){
   const p=w.AltaStore.product(card.dataset.product),photo=card.querySelector('.ap-product-image');
   assert.equal(card.querySelector('.nl-featured-meta h3').textContent,p.name);
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
  assert.equal(d.querySelector('.nl-editorial').nextElementSibling.id,'faq');
  assert.equal(bulk.querySelector('a').getAttribute('href'),'/bulk-orders');
  assert.match(bulk.querySelector('h2').textContent,/Save up to 60%/);
  assert.doesNotMatch(bulk.textContent,/BOGO|monthly auto.?billing/i);
  const tiers=[...bulk.querySelectorAll('.pure-home-volume-tiers > div')];
  assert.deepEqual(tiers.map(tier=>tier.textContent),['50% OFF10+ units per compound','60% OFF50+ units per compound']);
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
  assert.deepEqual([...d.querySelectorAll('[data-bundle-quantity]')].map(x=>x.dataset.bundleQuantity),['1','2','3','4']);
  assert.equal(d.querySelector('#ap-detail-quantity').value,'1');d.querySelector('[data-action="detail-add"]').click();assert.equal(w.AltaStore.cart[0].qty,1);const options=d.querySelectorAll('[data-action="detail-size"]');options[1].click();assert.ok(d.querySelector('h1').textContent.includes(options[1].dataset.size));dom.window.close();}
 {const{dom,d,w}=await setup('/bulk-orders');
  assert.equal(d.querySelector('.nl-bulk-count'),null);assert.equal(d.querySelector('#ap-bulk-count'),null);
  const benefits=[...d.querySelectorAll('.nl-bulk-benefit')];
  assert.equal(benefits.length,4);
  assert.deepEqual(benefits.map(benefit=>benefit.querySelector('.nl-bulk-benefit-copy').textContent),['10+ units','50+ units','Free express shipping','Product documentation']);
  assert.match(d.querySelector('.nl-bulk-benefit-shipping').textContent,/2-day.*US bulk orders/);
  assert.equal(benefits[3].getAttribute('href'),'/coas');
  assert.match(d.querySelector('.nl-bulk-hero p').textContent,/Save 50% at 10 units/);
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
  assert.match(qty.closest('article').querySelector('[data-tier-active="true"]').textContent,/60% off/);
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
