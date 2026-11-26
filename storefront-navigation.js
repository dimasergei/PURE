/* Shared disclosure menus: hover, touch, keyboard, and outside/Escape dismissal. */
(() => {
 'use strict';
 const fallback=document.querySelector('[data-default-offer][data-ends-at]');
 if(fallback){
  const expire=()=>{
   if(!fallback.isConnected)return;
   const remaining=Date.parse(fallback.dataset.endsAt)-Date.now();
   if(remaining>0){setTimeout(expire,Math.min(remaining,2147483647));return;}
   fallback.parentElement.hidden=true;
  };
  expire();
 }
 const copyTimers=new WeakMap();
 document.addEventListener('click',async event=>{
  const coupon=event.target.closest('button[data-copy-offer]');
  if(!coupon)return;
  const code=coupon.dataset.copyOffer,label=coupon.querySelector('span'),status=coupon.parentElement.querySelector('[data-offer-status]');
  if(!code||!label||!status)return;
  try{
   await navigator.clipboard.writeText(code);
   label.textContent='Copied ✓';status.textContent='Discount code copied.';coupon.classList.add('is-copied');
   clearTimeout(copyTimers.get(coupon));
   copyTimers.set(coupon,setTimeout(()=>{label.textContent=code;status.textContent='';coupon.classList.remove('is-copied');},1800));
  }catch{
   const range=document.createRange();range.selectNodeContents(label);
   const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
   status.textContent='Discount code selected. Use your device’s copy command.';
  }
 });
 const menus=[...document.querySelectorAll('[data-header-menu]')].map(root=>({root,trigger:root.querySelector('[data-menu-trigger]'),panel:root.querySelector('.ap-header-popover'),timer:0,suppressFocus:false})).filter(m=>m.trigger&&m.panel);
 function close(m){clearTimeout(m.timer);m.panel.hidden=true;m.trigger.setAttribute('aria-expanded','false');m.root.classList.remove('ap-menu-open');}
 function open(m){for(const other of menus)if(other!==m)close(other);clearTimeout(m.timer);m.panel.hidden=false;m.trigger.setAttribute('aria-expanded','true');m.root.classList.add('ap-menu-open');}
 for(const m of menus){
  m.root.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch'&&window.matchMedia('(min-width: 1191px) and (hover: hover)').matches)open(m);});
  m.root.addEventListener('pointerleave',()=>{m.timer=setTimeout(()=>{if(!m.root.contains(document.activeElement))close(m);},150);});
  m.root.addEventListener('focusin',()=>{if(!m.suppressFocus)open(m);});
  m.root.addEventListener('focusout',e=>{if(!m.root.contains(e.relatedTarget))close(m);});
  m.trigger.addEventListener('pointerdown',()=>{m.pointerWasOpen=!m.panel.hidden;});
  m.trigger.addEventListener('click',e=>{if(m.trigger.tagName==='A')return;e.preventDefault();const wasOpen=e.detail?m.pointerWasOpen:!m.panel.hidden;wasOpen?close(m):open(m);});
  m.trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open(m);const links=[...m.panel.querySelectorAll('a')];(e.key==='ArrowUp'?links.at(-1):links[0])?.focus();}});
  m.panel.addEventListener('keydown',e=>{const links=[...m.panel.querySelectorAll('a')],i=links.indexOf(document.activeElement);if(i<0)return;let next;if(e.key==='ArrowDown')next=(i+1)%links.length;else if(e.key==='ArrowUp')next=(i+links.length-1)%links.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=links.length-1;if(next!==undefined){e.preventDefault();links[next].focus();}});
 }
 document.addEventListener('pointerdown',e=>{for(const m of menus)if(!m.root.contains(e.target))close(m);});
 document.addEventListener('keydown',e=>{
  if(e.key!=='Escape'||e.defaultPrevented||document.querySelector('dialog[open]'))return;
  const opened=menus.filter(m=>!m.panel.hidden),focused=opened.find(m=>m.root.contains(document.activeElement));
  if(opened.length){
   for(const m of opened)close(m);
   e.preventDefault();
   if(focused){focused.suppressFocus=true;focused.trigger.focus();focused.suppressFocus=false;}
   return;
  }
 });
 const mobileMenu=document.getElementById('ap-mobile-menu');
 const mobileToggle=document.querySelector('[aria-controls="ap-mobile-menu"]');
 if(mobileMenu&&mobileToggle){
  mobileToggle.addEventListener('click',()=>{
   if(mobileMenu.open)return;
   mobileMenu.showModal();
   mobileToggle.setAttribute('aria-expanded','true');
  });
  mobileMenu.querySelector('[data-mobile-menu-close]').addEventListener('click',()=>mobileMenu.close());
  mobileMenu.querySelector('[data-mobile-menu-cart]')?.addEventListener('click',()=>{
   mobileMenu.close();
   document.querySelector('.ap-header-actions [data-action="cart"]')?.click();
  });
  mobileMenu.addEventListener('close',()=>mobileToggle.setAttribute('aria-expanded','false'));
  window.matchMedia('(min-width: 1191px)').addEventListener?.('change',event=>{
   if(event.matches&&mobileMenu.open)mobileMenu.close();
  });
 }
 const footerSections = document.querySelectorAll('.pure-footer-links');
 if(footerSections.length){
  const mobile = window.matchMedia('(max-width: 700px)');
  const updateFooter = () => footerSections.forEach(section => { section.open = !mobile.matches; });
  updateFooter();
  mobile.addEventListener?.('change', updateFooter);
 }
})();
