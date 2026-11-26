(()=>{
 'use strict';
 const usdMoney=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(n)||0)/100);
 const money=n=>window.AltaLocale?.price?window.AltaLocale.price(n,{compact:true}):usdMoney(n);
 const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const couponKeys=['ap-checkout-coupon','ap-cart-coupon'];
 const saveCoupon=value=>couponKeys.forEach(key=>value?localStorage.setItem(key,value):localStorage.removeItem(key));
 const storedCoupon=()=>{const code=(localStorage.getItem(couponKeys[0])||localStorage.getItem(couponKeys[1])||'').trim().toUpperCase();const valid=/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(code)&&code!=='BOGO'?code:'';saveCoupon(valid);return valid;};
 let seq=0,config=null;
 const methods=async()=>{
  if(config)return config;
  const r=await fetch('/api/customer-config?checkout=public',{cache:'no-store'});
  if(!r.ok)throw Error('Checkout details are not available.');
  return config=await r.json();
 };
 const cartKey=items=>'ap-v2-cart-extras:'+JSON.stringify(items.map(({id,size,qty})=>({id,size,qty})));
 const protectionKey='ap-checkout-protection';
 const solutionIds=new Set(['bac-3','bac-10']);
 function extras(items){
  let prior=null,choice=null;
  try{
   prior=JSON.parse(sessionStorage.getItem(cartKey(items))||'null');choice=sessionStorage.getItem(protectionKey);
   // Migrate an existing US checkout choice; international carts previously had no protection control.
   if(choice!=='true'&&choice!=='false'&&Array.isArray(prior)&&(prior.includes('protection')||(localStorage.getItem('ap-shipping-country')||'US')==='US')){
    choice=String(prior.includes('protection'));sessionStorage.setItem(protectionKey,choice);
   }
  }catch{}
  if(choice!=='true'&&choice!=='false'){choice='true';try{sessionStorage.setItem(protectionKey,choice);}catch{}}
  const selected=new Set(Array.isArray(prior)?prior.filter(id=>id!=='protection'):[]);
  if(choice!=='false')selected.add('protection');
  return [...selected];
 }
 const giftIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8H8.5A2.5 2.5 0 1 1 11 5.5L12 8Zm0 0h3.5A2.5 2.5 0 1 0 13 5.5L12 8Z"/></svg>';
 function renderRewards(root,quote,country){
  const panel=root.querySelector('.nlc-rewards');
  const service=window.PureSite?.shipping.freeServices[country]?.at(-1);
  const shipping=service?'free '+html(service.replaceAll('_',' '))+' shipping':'';
  const tiers=[
   {kind:'shipping',target:quote.free_shipping_threshold_cents,label:shipping},
   {kind:'recon',target:quote.recon_solution_threshold_cents,label:'free recon solution'},
  ].filter(tier=>tier.label&&Number.isSafeInteger(tier.target)&&tier.target>0).sort((a,b)=>a.target-b.target);
  if(!tiers.length){panel.hidden=true;return;}
  const subtotal=Math.max(0,(quote.pricing?.subtotal_cents??quote.subtotal_cents)-(quote.discount_cents||0));
  const finalTarget=tiers[tiers.length-1].target;
  const progress=Math.min(subtotal,finalTarget);
  const next=tiers.find(tier=>subtotal<tier.target);
  const rewards=shipping&&tiers.length===2?shipping+' + recon solution':tiers[tiers.length-1].label;
  const status=next?'Add <strong>'+money(next.target-subtotal)+'</strong> for <strong>'+next.label+'</strong>.':'<strong>'+rewards[0].toUpperCase()+rewards.slice(1)+'</strong> unlocked.';
  let earnedTarget=0;
  const markers=tiers.map(tier=>{
   const reached=subtotal>=tier.target;
   if(reached)earnedTarget=tier.target;
   const label=tier.kind==='recon'&&shipping?shipping+' + recon solution':tier.label;
   const title=label[0].toUpperCase()+label.slice(1);
   const id='nlc-reward-'+tier.kind;
   return '<span class="nlc-reward-stop" style="left:'+tier.target/finalTarget*100+'%"><button type="button" class="nlc-reward-trigger" data-reached="'+reached+'" aria-label="'+title+'" aria-describedby="'+id+'" aria-expanded="false"><span>'+giftIcon+'</span></button><span id="'+id+'" class="nlc-reward-tip" role="tooltip" hidden>'+money(tier.target)+'+ · '+title+'</span></span>';
  }).join('');
  panel.hidden=false;
  panel.querySelector('[data-nlc-unlock-copy]').innerHTML=status;
  const rail=panel.querySelector('.nlc-reward-rail');
  rail.innerHTML='<div class="nlc-reward-meter" style="--earned-width:'+earnedTarget/finalTarget*100+'%" role="progressbar" aria-label="Cart rewards" aria-valuemin="0" aria-valuemax="'+finalTarget/100+'" aria-valuenow="'+progress/100+'"><span style="width:'+progress/finalTarget*100+'%"></span></div>'+markers;
  rail.querySelector('[role="progressbar"]').setAttribute('aria-valuetext',panel.querySelector('[data-nlc-unlock-copy]').textContent);
  let current=null,pinned=false;
  function show(button){
   if(current){current.setAttribute('aria-expanded','false');current.nextElementSibling.hidden=true;}
   current=button;
   if(button){button.setAttribute('aria-expanded','true');button.nextElementSibling.hidden=false;}
  }
  for(const button of rail.querySelectorAll('.nlc-reward-trigger')){
   button.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'){pinned=false;show(button);}});
   button.parentElement.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse'&&!pinned&&current===button)show(null);});
   button.addEventListener('focus',()=>{pinned=false;show(button);});
   button.addEventListener('blur',()=>{pinned=false;if(current===button)show(null);});
   button.addEventListener('click',()=>{pinned=!(pinned&&current===button);show(pinned?button:null);});
   button.addEventListener('keydown',event=>{if(event.key==='Escape'&&current){event.preventDefault();event.stopPropagation();pinned=false;show(null);}});
  }
 }
 function renderAddOn(root,items,quote){
  const panel=root.querySelector('[data-nlc-add-on]');
  const store=window.AltaStore;
  const alreadyIncluded=items.some(item=>solutionIds.has(item.id))||
   (quote.pricing?.bundled_items||[]).some(item=>item.id==='gift-bac-3');
  const supplies=[];
  if(items.length<60&&!alreadyIncluded&&items.some(item=>store.product(item.id)?.category==='injectables')){
   for(const id of solutionIds){
    const product=store.product(id);
    if(product?.category!=='supplies')continue;
    for(const variant of product.variants||[]){
     if(Number.isFinite(variant.price)&&variant.price>0)supplies.push({product,variant});
    }
   }
  }
  panel.hidden=!supplies.length;
  if(!supplies.length){panel.replaceChildren();return;}
  const controls=supplies.length>1?'<div class="nlc-rec-controls"><button type="button" aria-label="Previous add-on" data-rec-step="-1">‹</button><button type="button" aria-label="Next add-on" data-rec-step="1">›</button></div>':'';
  panel.innerHTML='<header><h3>Optional add-ons</h3>'+controls+'</header><div class="nlc-rec-track">'+supplies.map(({product,variant})=>
   '<div class="nlc-rec"><img src="'+html(store.image(product,variant.size))+'" alt=""><div><strong>'+html(product.name)+'</strong>'
   +'<div class="nlc-rec-prices">Extra '+html(variant.size)+' vial <b>'+money(Math.round(variant.price*100))+'</b></div>'
   +'<button data-action="add" data-id="'+html(product.id)+'" data-size="'+html(variant.size)+'" type="button" aria-label="Add '+html(product.name)+' '+html(variant.size)+' to cart">Add to cart</button></div></div>').join('')+'</div>';
  const rail=panel.querySelector('.nlc-rec-track');
  for(const button of panel.querySelectorAll('[data-rec-step]'))button.onclick=()=>rail.scrollBy({left:Number(button.dataset.recStep)*rail.clientWidth,behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});

 }
 async function offer(root){
  if(!root?.isConnected)return;
  const items=window.AltaStore?.cart||[];
  if(!items.length)return;
  let appliedCoupon=storedCoupon(),hasQuote=false;
  root.innerHTML='<div class="nlc-scrollable-items cart__body" data-testid="cart-product-scroll">'
   +'<section class="nlc-cart-lines">'+items.map(x=>
    '<div class="nlc-line"><img src="'+html(window.AltaStore.image(window.AltaStore.product(x.id),x.size))+'" alt="">'
    +'<div class="nlc-name"><div class="nlc-product-title"><a href="/product/'+encodeURIComponent(x.id)+'?size='+encodeURIComponent(x.size)+'"><strong>'+html(x.name)+'</strong></a><span class="nlc-size">– '+html(x.size)+'</span></div>'
    +'<div class="nlc-product-actions"><div class="nlc-quantity-row"><div class="ap-quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="-1" aria-label="Decrease '+html(x.name)+' quantity">−</button>'
    +'<input value="'+x.qty+'" readonly aria-label="Quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="1" aria-label="Increase '+html(x.name)+' quantity">+</button></div></div>'
    +'<span class="nlc-unit-bonus" data-bonus-product="'+html(x.id)+'" data-bonus-size="'+html(x.size)+'" hidden></span>'
    +'</div></div><div class="nlc-price"><strong>'+money(Math.round(x.price*100)*x.qty)+'</strong><button type="button" data-action="cart-remove" data-key="'+html(x.key)+'" aria-label="Remove '+html(x.name)+'">×</button></div></div>'
   ).join('')+'<div data-nlc-gifts></div></section>'
   +'<section class="nlc-recs" data-nlc-add-on hidden></section>'
   +'<div class="nlc-cart-options"><details class="nlc-coupon"><summary><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true"><path d="M20.5 13.5 13.5 20.5a1.7 1.7 0 0 1-2.4 0L3 12.4V3h9.4l8.1 8.1a1.7 1.7 0 0 1 0 2.4Z"/><circle cx="7.8" cy="7.8" r="1.15"/></svg><span data-nlc-coupon-label>Add coupon code</span><i aria-hidden="true"></i></summary>'
   +'<div class="nlc-coupon-fields"><input type="text" name="nlc_coupon" aria-label="Coupon code" aria-describedby="nlc-coupon-status" placeholder="Enter code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" value="'+html(appliedCoupon)+'"><button type="button" data-nlc-apply>Apply</button><button type="button" data-nlc-remove-coupon hidden>Remove</button></div><p id="nlc-coupon-status" data-nlc-coupon-status role="status"></p></details>'
   +'<p class="nlc-partner-sign-in" data-nlc-partner-sign-in hidden><a href="/account/login?returnTo=%2Fcheckout">Sign in to check your partner offer</a></p></div>'
   +'<section class="nlc-rewards" aria-label="Cart rewards" hidden><p data-nlc-unlock-copy role="status"></p><div class="nlc-reward-rail"></div></section>'
   +'</div><div class="nlc-cart-checkout cart__checkout" data-testid="cart-fixed-footer">'
   +'<p class="nlc-delivery-est" data-nlc-estimate><a href="/shipping-policy.html">Estimated delivery</a> · '+html(window.PureSite?.shipping.combinedEstimate||'See the shipping policy for timing')+'</p>'
   +'<div class="nlc-cart-totals" data-nlc-cart-totals><p role="status">Calculating your order total…</p></div>'
   +'<a class="nlc-proceed" href="/checkout">Proceed to Checkout</a>'
   +'<div class="nlc-wallet-area"><div class="nlc-express" hidden><div class="nlc-pay-divider">OR PAY WITH</div><div class="nlc-wallet-row" data-nlc-wallets>'
   +'<a class="nlc-wallet-link" data-nlc-wallet="apple" role="link" aria-disabled="true" aria-label="Continue with Apple Pay"><span class="nlc-wallet-lockup"><img class="nlc-wallet-logo nlc-apple-mark" src="/assets/payment-brands/apple-mark-clean.svg" width="18" height="23" alt="" aria-hidden="true"><span class="nlc-apple-pay-word">Pay</span></span></a>'
   +'<a class="nlc-wallet-link" data-nlc-wallet="google" role="link" aria-disabled="true" aria-label="Continue with Google Pay"><span class="nlc-wallet-lockup"><img class="nlc-wallet-logo nlc-google-mark" src="/assets/payment-brands/google-g-clean.svg" width="20" height="20" alt="" aria-hidden="true"><span class="nlc-google-pay-word">Pay</span></span></a></div>'
   +'</div><p>21+ · Research use only · <a href="/research-use-policy.html">RUO Agreement</a> · <a href="/commercial-terms.html">Terms</a></p></div></div>';
  const track=root.querySelector('[data-nlc-cart-totals]'),input=root.querySelector('[name=nlc_coupon]'),apply=root.querySelector('[data-nlc-apply]'),remove=root.querySelector('[data-nlc-remove-coupon]'),couponStatus=root.querySelector('[data-nlc-coupon-status]');
  const proceed=root.querySelector('.nlc-proceed');
  const redraw=async(candidate=appliedCoupon,action='refresh')=>{
   const id=++seq;
   apply.disabled=true;remove.disabled=true;
   couponStatus.textContent=action==='remove'?'Removing coupon…':candidate?'Checking coupon…':'';
   input.removeAttribute('aria-invalid');
   try{
    const session=async()=>{
     try{return (await (await window.AltaWorkspace?.authClient?.())?.auth.getSession())?.data?.session;}catch{return null;}
    };
    const locale=window.AltaLocale;
    const [settings,account]=await Promise.all([methods(),session(),window.PurePartnerVisit,locale?.countryReady]);
    if(!input.isConnected||id!==seq)return;
    const savedCountry=account?.user?.user_metadata?.alta_profile?.shipping?.country;
    const country=[savedCountry,locale?.country,localStorage.getItem('ap-shipping-country')].find(code=>/^[A-Z]{2}$/.test(code||''))||'US';
    const availableExtras=(settings.delivery_options||[]).filter(option=>option.kind==='extra'&&option.enabled===true);
    const selectedExtras=extras(items).filter(option=>availableExtras.some(extra=>extra.id===option));
    try{sessionStorage.setItem(cartKey(items),JSON.stringify(selectedExtras));}catch{}
    const quoteBody={items:items.map(({id,size,qty})=>({id,size,qty})),method_id:null,country,
     delivery:{shipping:'economy',extras:selectedExtras.sort()}};
    const fetchQuote=async coupon=>{
     const response=await fetch('/api/customer-config?checkout=cart',{method:'POST',cache:'no-store',
      headers:{'Content-Type':'application/json',...(account?.access_token?{Authorization:'Bearer '+account.access_token}:{})},body:JSON.stringify({...quoteBody,coupon})});
     const result=await response.json().catch(()=>null);
     if(!response.ok||!Number.isSafeInteger(result?.total_cents)){
      throw Object.assign(Error(result?.error||'Cart totals are temporarily unavailable.'),{status:response.status});
     }
     return result;
    };
    let data,rejectedCode='';
    try{data=await fetchQuote(candidate);}
    catch(error){
     // Reprice the same items before discarding a rejected saved code. Unrelated
     // failures (for example an unavailable destination) must retain the code.
     if(id!==seq||!input.isConnected)return;
     if(action!=='refresh'||!candidate||error.status!==400)throw error;
     data=await fetchQuote('');
     rejectedCode=candidate;
    }
    if(id!==seq||!input.isConnected)return;
    const quotedCode=data.pricing?.affiliate_code||data.pricing?.coupon_code||'';
    const winningCode=data.pricing?.coupon_discount_cents>0?quotedCode:'';
    appliedCoupon=data.requested_coupon||(data.automatic_partner_offer?'':quotedCode);
    saveCoupon(appliedCoupon);input.value=appliedCoupon;remove.hidden=!appliedCoupon;
    root.querySelector('[data-nlc-coupon-label]').textContent=appliedCoupon?'Coupon · '+appliedCoupon:data.partner_offer_pending?'Partner link saved · Add coupon':'Add coupon code';
    root.querySelector('[data-nlc-partner-sign-in]').hidden=!data.partner_offer_pending||!!account;
    couponStatus.textContent=data.partner_offer_pending?'First-order eligibility is confirmed when you sign in.':appliedCoupon&&winningCode!==appliedCoupon?'A better eligible offer was applied. Your code is saved.':appliedCoupon?appliedCoupon+' applied.':action==='remove'?'Coupon removed.':'';
    if(rejectedCode)couponStatus.textContent=rejectedCode+' no longer applies.';
    const shipping=data.pricing?.delivery?.shipping_cents||0;
    const features=data.pricing?.delivery?.extras||[];
    const nodes=[['Subtotal',data.subtotal_cents]];
    const discount=data.pricing?.coupon_discount_cents||0;
    if(discount>0)nodes.push([data.pricing?.affiliate_code?(data.partner_offer_pending?'Estimated partner savings':'Partner savings'):'Coupon savings',-discount]);
    if(data.pricing?.membership_discount_cents>0)nodes.push(['Member savings',-data.pricing.membership_discount_cents]);
    if(data.pricing?.second_unit_discount_cents>0)nodes.push(['Second-unit savings',-data.pricing.second_unit_discount_cents]);
    if(data.pricing?.quantity_discount_cents>0)nodes.push(['Quantity savings',-data.pricing.quantity_discount_cents]);
    const bonuses=data.pricing?.bogo_campaign?.free_units||[];
    for(const badge of root.querySelectorAll('[data-bonus-product]')){
     const bonus=bonuses.find(line=>line.id===badge.dataset.bonusProduct&&line.size===badge.dataset.bonusSize);
     badge.hidden=!bonus;
     badge.textContent=bonus?'+'+bonus.qty+' free':'';
    }
    root.querySelector('[data-nlc-gifts]').innerHTML=(data.pricing?.bundled_items||[]).map(gift=>
     '<div class="nlc-included-gift"><strong>'+html(gift.name)+' <span>'+html(gift.size)+'</span></strong><b>Free gift</b></div>'
    ).join('');
    renderAddOn(root,items,data);
    const shippingLabel=['US','CA'].includes(country)?'Domestic shipping estimate':'International shipping estimate';
    nodes.push([shippingLabel,shipping]);
    for(const feature of features)nodes.push([feature.label,feature.amount_cents]);
    if(data.tax_cents>0)nodes.push(['Tax',data.tax_cents]);
    track.innerHTML=nodes.map(([label,price],index)=>'<div class="'+(index===0?'nlc-first-subtotal':label==='Shipping Protection'?'nlc-protection-static':'')+'"><span>'+html(label)+'</span><strong>'+(price<0?'−'+money(-price):label===shippingLabel&&price===0?'FREE':money(price))+'</strong></div>').join('');
    renderRewards(root,data,country);
    proceed.innerHTML='Proceed to Checkout ('+money(data.total_cents)+')';
    const hostedCard=(settings.methods||[]).find(method=>method.native_provider==='rampex'&&method.rampex_provider==='hosted'&&method.active!==false&&method.countries?.includes(country));
    root.querySelector('.nlc-express').hidden=!hostedCard;
    root.querySelectorAll('[data-nlc-wallet]').forEach(link=>{
     if(hostedCard)link.href='/checkout?wallet='+link.dataset.nlcWallet;
     else link.removeAttribute('href');
     link.setAttribute('aria-disabled',String(!hostedCard));
    });
    hasQuote=true;
    window.PureFunnel?.mark('cart');
   }catch(error){
    if(!input.isConnected||id!==seq)return;
    if(action==='apply'&&error.status===400){
     input.setAttribute('aria-invalid','true');
     couponStatus.textContent=error.message;
    }else if(action!=='refresh')couponStatus.textContent='Please try again.';
    if(!hasQuote){
     const subtotal=items.reduce((sum,item)=>sum+Math.round(item.price*100)*item.qty,0);
     track.innerHTML='<div class="nlc-first-subtotal"><span>Items subtotal</span><strong>'+money(subtotal)+'</strong></div>'+
      '<p role="status">'+html(error.status===400?error.message:'Shipping and total unavailable.')+' <button type="button" data-nlc-retry>Retry</button></p>';
     track.querySelector('[data-nlc-retry]').onclick=()=>redraw();
    }
   }finally{if(input.isConnected&&id===seq){apply.disabled=false;remove.disabled=false;}}
  };
  apply.addEventListener('click',()=>redraw(input.value.trim().toUpperCase(),'apply'));
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply.click();}});
  remove.addEventListener('click',()=>redraw('','remove'));
  await redraw();
 }
 window.AltaCartNmi=Object.assign(window.AltaCartNmi||{},{offer});
})();
