(() => {
 'use strict';
 document.addEventListener('click',e=>{const control=e.target.closest('[data-carousel]');if(!control)return;const rail=document.getElementById('nl-featured');if(rail)rail.scrollBy({left:Number(control.dataset.carousel)*rail.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
 // Native clipboard button is added to report IDs without modifying the report data.
 const reports=document.getElementById('ap-supplier-references');
 if(reports){const decorate=()=>{for(const dt of reports.querySelectorAll('dt')){if(dt.textContent!=='Report ID')continue;const dd=dt.nextElementSibling;if(!dd||dd.querySelector('button'))continue;const id=dd.textContent;const button=document.createElement('button');button.type='button';button.className='nl-coa-copy';button.textContent='Copy';button.setAttribute('aria-label','Copy report ID '+id);button.onclick=async()=>{try{await navigator.clipboard.writeText(id);button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1800);}catch{button.textContent='Select ID to copy';}};dd.append(button);}};new MutationObserver(decorate).observe(reports,{childList:true,subtree:true});decorate();}
})();

(() => {
 let monthlyReady=false;
 function updateQuantity(){
  const group=document.querySelector('[data-unit-price]');
  const input=document.getElementById('ap-detail-quantity');
  if(!group||!input)return;
  const qty=Number(input.value),unit=Number(group.dataset.unitPrice);
  if(!Number.isInteger(qty)||qty<1||qty>100)return;
  const cents=Math.round(unit*100),tier=window.PureQuantityPricing,rate=tier?.basisPoints(qty)||0,total=(tier?.totalCents(cents,qty)??cents*qty)/100,unitLabel=group.dataset.unitLabel||'vial';
  const format=n=>window.AltaLocale?.price?window.AltaLocale.price(Math.round(n*100),{compact:true}):new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  const estimate=document.querySelector('[data-bundle-estimate]');
  if(estimate)estimate.innerHTML='<strong>'+format(total)+'</strong> for '+qty+' '+unitLabel+(qty===1?'':'s')+(rate?' <span class="pure-tier-saving">SAVE '+rate/100+'% · '+format(unit*qty-total)+' OFF</span>':'');
  const monthly=document.querySelector('.nl-product-saving-card-member');
  if(monthly&&monthlyReady){
   const link=new URL(monthly.href);
   link.pathname='/monthly-orders';link.searchParams.set('qty',String(qty));
   monthly.href=link.pathname+link.search;
   monthly.querySelector('strong').innerHTML='Save 10% · '+format(Math.round(cents*.9)*qty/100);
   monthly.querySelector('small').textContent='Monthly invoice · Review delivery and total';
  }
  const mobile=document.querySelector('[data-mobile-total]');
  if(mobile)mobile.innerHTML=format(total)+(rate?' · save '+rate/100+'%':'');
 }
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-action="detail-quantity"]'))queueMicrotask(updateQuantity);
 });
 document.addEventListener('input',event=>{if(event.target.id==='ap-detail-quantity')updateQuantity();});
 const main=document.getElementById('ap-main');
 let purchaseObserver;
 function mountDetail(){
  updateQuantity();
  purchaseObserver?.disconnect();
  const action=main?.querySelector('.nl-purchase'),bar=main?.querySelector('.ap-mobile-purchase');
  if(!action||!bar||typeof IntersectionObserver==='undefined')return;
  purchaseObserver=new IntersectionObserver(([entry])=>{
   bar.dataset.inView=String(entry.isIntersecting);
  });
  purchaseObserver.observe(action);
 }
 if(main)new MutationObserver(records=>{
  if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('.nl-detail')||n.querySelector?.('.nl-detail')))))mountDetail();
 }).observe(main,{childList:true});
 if(document.querySelector('.nl-product-saving-card-member')){
  fetch('/api/customer-config?repeat_orders=status',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(status=>{
   monthlyReady=status?.available===true;
   if(monthlyReady)updateQuantity();
  }).catch(()=>{});
 }
 window.AltaLocale?.onChange?.(()=>updateQuantity());
 mountDetail();
})();

// The bulk order summary follows the current sticky navigation offset.
(() => {
 const header=document.querySelector('.ap-header');if(!header)return;
 const update=()=>{const top=parseFloat(getComputedStyle(header).top)||0;document.documentElement.style.setProperty('--ap-workspace-sticky-top',Math.ceil(header.getBoundingClientRect().height+top+16)+'px');};
 update();window.addEventListener('resize',update,{passive:true});
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(update).observe(header);
})();
