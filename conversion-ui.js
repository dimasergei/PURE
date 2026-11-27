/* Cart estimates are server-calculated. No wallet is advertised until an approved route exists. */
(()=>{
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
 async function request(path,body,auth,signal){const headers={'Content-Type':'application/json'};if(auth){const {data}=await auth.auth.getSession();if(data.session)headers.Authorization='Bearer '+data.session.access_token;}const r=await fetch('/api/customer-config?'+path,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',keepalive:path==='partner=visit',headers,signal,...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'Please try again.');return data;}
 async function cart(root){return window.AltaCartNmi?.offer?.(root);}
 function dateLabel(value){const date=new Date(value);return value&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(date):null;}
 function membershipCards(config,period='monthly',active=null){return window.PureMemberships?.renderCards(config,period,{active,context:'account'})||'';}
 async function mountMembership(root,auth){
  root.innerHTML='<p class="cv-program-loading" role="status">Loading your membership…</p>';
  try{
   const data=await request('checkout=account',null,auth),config=data.terms?.conversion;
   if(!config?.plans||!window.PureMemberships)throw Error('Membership details could not be loaded. Please refresh the page.');
   const record=data.membership,expiry=record?.expires_at?new Date(record.expires_at).getTime():0;
   const active=record&&['vip','elite'].includes(record.plan)&&!record.revoked_at&&expiry>Date.now()?record:null;
   const pending=active?null:data.membership_pending;
   const tier=active?.plan||'member',plan=config.plans[tier],name=window.PureMemberships.displayName(tier);
   const benefits=window.PureMemberships.benefits(config,tier),expires=dateLabel(active?.expires_at);
   root.innerHTML=`<div class="cv-programs">
    <section class="cv-member-status cv-member-${tier==='elite'?'black':tier==='vip'?'white':'free'}">
     <div class="cv-member-summary">
      <div class="cv-program-heading"><span class="cv-program-kicker">YOUR MEMBERSHIP</span><span class="cv-program-badge">${active?'ACTIVE':'FREE ACCOUNT'}</span></div>
      <h2><button class="cv-member-toggle" type="button" aria-expanded="false" aria-controls="cv-member-details" aria-label="${esc(name)} membership details">${esc(name)}</button></h2>
      <a class="cv-program-primary cv-member-shop" href="/shop" aria-label="Shop with your account">Shop</a>
     </div>
     <div class="cv-member-details" id="cv-member-details" hidden>
      <p>${active?`Your paid benefits are active${expires?' through '+esc(expires):''}. Sign in at checkout to use your eligible member savings.`:'Your account brings your orders, tracking, points and store credit together. Choose a paid tier for more benefits.'}</p>
      <div class="cv-member-metrics">
       <div><strong>${plan.discount_bps?plan.discount_bps/100+'%':'—'}</strong><span>${plan.discount_bps?'Eligible merchandise savings':'Paid tier savings available'}</span></div>
       <div><strong>${plan.points_per_dollar||0}×</strong><span>Points per eligible $1</span></div>
       <div><strong>${active?'Paid':'Free'}</strong><span>${active?'Current membership term':'No membership fee'}</span></div>
      </div>
      ${active?`<ul class="cv-member-benefits">${benefits.map(benefit=>`<li><span aria-hidden="true">✓</span><span>${esc(benefit.text)}${benefit.creditTerms?'<a class="mx-benefit-footnote" href="/membership-terms.html#pure-black-credit" aria-label="Read the PURE BLACK monthly credit terms"><span aria-hidden="true">†</span></a>':benefit.detail?'<small>'+esc(benefit.detail)+'</small>':''}</span></li>`).join('')}</ul>`:''}
      <div class="cv-program-actions"><a class="cv-program-link" href="/account/points">View points & credit</a></div>
     </div>
    </section>
    ${active?`<section class="cv-program-note"><h3>Your paid term</h3><p>Your benefits are available until ${esc(expires||'the end of your paid term')}. To continue, purchase a new term when this one ends.</p><a href="/membership-terms.html">Membership terms ↗</a></section><details class="cv-tier-options"><summary>Compare membership tiers <span aria-hidden="true">+</span></summary><div data-cv-memberships></div></details>`:'<section class="cv-tier-options"><h2>Choose your membership</h2><p class="cv-program-intro">Choose a monthly or annual term. Benefits start when your payment is confirmed; extend with another invoice at term end.</p><div data-cv-memberships></div></section>'}
   </div>`;
   const toggle=root.querySelector('.cv-member-toggle'),details=root.querySelector('#cv-member-details');
   toggle.addEventListener('click',()=>{
    const expanded=details.hidden;
    toggle.setAttribute('aria-expanded',String(expanded));
    details.hidden=!expanded;
   });
   if(pending){
    const pendingName=pending.name||window.PureMemberships.displayName(pending.plan),needsReview=pending.expired===true||pending.requires_review===true;
    const pendingExpiry=dateLabel(pending.expires_at)?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(pending.expires_at)):null;
    const amount=Number.isSafeInteger(pending.total_cents)&&pending.total_cents>0&&['USD','CAD'].includes(pending.currency)?new Intl.NumberFormat('en-US',{style:'currency',currency:pending.currency,currencyDisplay:'code'}).format(pending.total_cents/100):null;
    root.querySelector('.cv-programs').insertAdjacentHTML('afterbegin',`<section class="cv-pending-membership"><div class="cv-program-heading"><span class="cv-program-kicker">MEMBERSHIP PURCHASE</span><span class="cv-program-badge">${needsReview?'NEEDS ATTENTION':'AWAITING PAYMENT'}</span></div><h2>${esc(pendingName)}</h2><p>${amount?esc(amount)+' · ':''}${pending.billing_period==='annual'?'One prepaid year':'One prepaid month'}.</p>${needsReview?'<p><strong>Unpaid membership needs attention.</strong> Open your saved order to check its status. If you have not sent payment, cancel the unpaid order before starting again. If you sent payment, contact PURE so it can be checked.</p>':'<p>Your benefits begin after this payment is confirmed.</p>'}${pendingExpiry&&!needsReview?'<p class="cv-pending-expiry">Complete this payment before '+esc(pendingExpiry)+'.</p>':''}<a class="cv-program-primary" href="/account/purchases${pending.invoice_id?'?id='+encodeURIComponent(pending.invoice_id):''}">${needsReview?'Review membership order':'Continue payment'} <span aria-hidden="true">↗</span></a></section>`);
    const heading=root.querySelector('.cv-tier-options>h2'),intro=root.querySelector('.cv-tier-options>.cv-program-intro');if(heading)heading.textContent='Membership tiers';if(intro)intro.textContent=needsReview?'Review your saved membership order before choosing another tier. Your account benefits have not changed.':'Your membership purchase is awaiting payment. Complete the existing purchase to activate your paid benefits.';
   }
   window.PureMemberships.mount(root.querySelector('[data-cv-memberships]'),config,{active,pending,context:'account',period:active?.period==='annual'||pending?.billing_period==='annual'?'annual':'monthly'});
  }catch(error){root.innerHTML=`<section class="cv-program-error"><h2>Membership details</h2><p role="alert">${esc(error.message)}</p><a href="/account/membership">Try again ↗</a></section>`;}
 }
 const partnerDisclosure = 'I earn a commission when you buy through my PURE link or code.';

 function referralTools(partner, codes) {
  if (partner.status !== 'active') {
   return `<section class="ae-panel rd-referral"><small>PARTNER DASHBOARD · ${esc(partner.status)}</small><h2>Referral sharing is paused</h2><p>Contact <a href="mailto:support@getpurelabs.com">support@getpurelabs.com</a> about your partner account.</p></section>`;
  }
  const products = [...(window.AltaStore?.catalog || [])].sort((a, b) => a.name.localeCompare(b.name));
  function variantOptions(list, bulk = false) {
   return list.flatMap(product => product.variants.map(variant => {
    const params = new URLSearchParams();
    if (bulk) params.set('product', product.id);
    params.set('size', variant.size);
    const path = (bulk ? '/bulk-orders' : '/product/' + encodeURIComponent(product.id)) + '?' + params;
    return `<option value="${esc(path)}">${esc(product.name)} · ${esc(variant.size)}</option>`;
   })).join('');
  }
  const productOptions = variantOptions(products);
  const bulkOptions = variantOptions([...(window.AltaWorkspace?.bulkCatalog || [])].sort((a, b) => a.name.localeCompare(b.name)), true);
  return `<section class="ae-panel rd-referral" data-partner-links>
   <small>PARTNER DASHBOARD · ${esc(partner.status)}</small>
   <h2>Your referral link</h2>
   <p>Choose a destination. Copy the link or a caption with your commission disclosure.</p>
   <div class="rd-referral-fields">
    <label>Destination<select data-link-destination><option value="/">PURE homepage</option><option value="/shop">Full catalog</option><option value="/bulk-orders">Bulk order builder</option>${productOptions ? '<optgroup label="Products">'+productOptions+'</optgroup>' : ''}</select></label>
    ${bulkOptions ? `<label data-bulk-link-field hidden>Product and strength<select data-bulk-link-variant><option value="/bulk-orders">All bulk products</option>${bulkOptions}</select></label>` : ''}
    ${codes.length > 1 ? `<label>Referral code<select data-link-code>${codes.map(c => `<option${c.code === partner.code ? ' selected' : ''}>${esc(c.code)}</option>`).join('')}</select></label>` : ''}
   </div>
   <input data-referral-url readonly aria-label="Your referral link">
   <div class="rd-referral-actions">
    <button type="button" class="ap-button" data-copy-link>Copy link</button>
    <button type="button" class="ap-button ap-button-secondary" data-copy-caption>Copy caption</button>
   </div>
   <details class="pure-partner-disclosure"><summary>Caption &amp; disclosure</summary>
    <textarea data-referral-caption aria-label="Referral caption" readonly rows="5"></textarea>
    <button type="button" data-copy-disclosure>Copy disclosure only</button>
   </details>
   <p role="status" data-referral-message></p>
  </section>`;
 }

 function mountReferralTools(root, primaryCode) {
  const panel = root.querySelector('[data-partner-links]');
  if (!panel) return;
  const destination = panel.querySelector('[data-link-destination]');
  const bulkField = panel.querySelector('[data-bulk-link-field]');
  const bulkVariant = panel.querySelector('[data-bulk-link-variant]');
  const code = panel.querySelector('[data-link-code]');
  const link = panel.querySelector('[data-referral-url]');
  const caption = panel.querySelector('[data-referral-caption]');
  const message = panel.querySelector('[data-referral-message]');
  let disclosure = partnerDisclosure;

  function update() {
   const bulk = destination.value === '/bulk-orders';
   disclosure = bulk ? 'I earn a commission on qualifying purchases made through this PURE link.' : partnerDisclosure;
   if (bulkField) bulkField.hidden = !bulk;
   const page = bulk && bulkVariant ? bulkVariant.selectedOptions[0] : destination.selectedOptions[0];
   const url = new URL(page.value, location.origin);
   url.searchParams.set('ref', code?.value || primaryCode);
   link.value = url.href;
   let intro = 'Browse the PURE research catalog.';
   if (bulk) {
    const subject = url.searchParams.has('product') ? ' for ' + page.textContent : '';
    intro = 'Explore PURE bulk pricing' + subject + '. Save 50% at 10 units or 60% at 50 units of the same compound. Strengths can be combined.';
   } else if (page.parentElement.tagName === 'OPTGROUP') {
    intro = 'Product information for ' + page.textContent + ' at PURE.';
   }
   caption.value = disclosure + '\n\n' + intro + ' For laboratory research use only.\n' + url.href;
   message.textContent = '';
  }
  async function copy(field, label, text = field.value) {
   try {
    await navigator.clipboard.writeText(text);
    message.textContent = label + ' copied.';
   } catch {
    const details = field.closest('details');
    if (details) details.open = true;
    field.focus();
    field.setSelectionRange(0, text.length);
    message.textContent = label + ' selected. Use your device’s copy command.';
   }
  }
  destination.addEventListener('change', update);
  bulkVariant?.addEventListener('change', update);
  code?.addEventListener('change', update);
  panel.querySelector('[data-copy-link]').onclick = () => copy(link, 'Link');
  panel.querySelector('[data-copy-caption]').onclick = () => copy(caption, 'Caption');
  panel.querySelector('[data-copy-disclosure]').onclick = () => copy(caption, 'Disclosure', disclosure);
  update();
 }

 function partnerMetrics(items){
  return `<dl class="rd-stat-grid">${items.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
 }

 function partnerActivity(stats){
  if(!stats)return '<section class="ae-panel"><h3>Last 30 days</h3><p>Partner activity is temporarily unavailable.</p></section>';
  return `<section class="ae-panel"><h3>Last 30 days</h3>
    ${partnerMetrics([['New link starts',stats.starts],['Paid orders',stats.paid_orders],['Commissionable sales · USD',money(stats.merchandise_cents)]])}
    <p>${esc(stats.first_orders)} first orders · ${esc(stats.repeat_orders)} repeat · ${esc(stats.delivered_orders)} delivered</p>
    <details><summary>How activity is counted</summary><p>Link counting began on ${esc(stats.tracking_since)} (UTC). A start counts when a referral link issues a fresh cookie. A new device or cleared cookie can count again. Privacy opt-outs and recognized automated visits are excluded.</p>
    <p>Orders include link and code referrals, grouped by payment date in UTC. Reversals are excluded. Commissionable sales are the merchandise amount used to calculate commission.</p></details>
   </section>`;
 }

 function partnerCodes(codes,primaryCode,sharing,codeField){
  return `<section class="ae-panel rd-partner-codes"><h3>Your referral codes</h3>
   ${sharing?'<p>Use up to three codes. Each code tracks referrals to this account.</p>':''}
   <div class="rd-code-list">${codes.map(({code})=>`<div><span><code>${esc(code)}</code>${code===primaryCode?'<small>Primary</small>':''}</span>${sharing?`<button type="button" data-copy="${esc(code)}" aria-label="Copy ${esc(code)}">Copy</button>`:''}</div>`).join('')}</div>
   <p role="status" data-code-status></p>
   ${sharing&&codes.length<3?`<form class="ap-form rd-code-form">${codeField}<button class="ap-button">Create code</button><p role="status"></p></form>`:''}
  </section>`;
 }

 function partnerCommissions(summary,events){
  return `<section class="ae-panel"><h3>Commission summary</h3>
    ${partnerMetrics([['Total commission',money(summary.earned_cents||0)],['Eligible for payout',money(summary.eligible_cents||0)],['Paid',money(summary.paid_cents||0)]])}
    ${partnerMetrics([['First-order commission','40%'],['Repeat-order commission','10%'],['Lifetime orders incl. reversals',summary.orders||0]])}
   </section>
   <section class="ae-panel"><h3>Referral activity</h3>
    ${events.length?`<div class="rd-table"><table><thead><tr><th scope="col">Order</th><th scope="col">Commission</th><th scope="col">Status</th></tr></thead>
      <tbody>${events.map(event=>`<tr><td>${esc(event.invoice_id.slice(0,8).toUpperCase())}</td><td>${money(event.amount_cents)} (${event.rate_bps/100}%)</td><td>${esc(event.status)}</td></tr>`).join('')}</tbody></table></div>`:
      '<div class="rd-empty"><strong>No commissions yet</strong><p>Verified referred orders appear here after payment.</p></div>'}
   </section>`;
 }

 function partnerWallet(d,summary,notice){
  return `<section class="ae-panel"><h3>Payout balances</h3>
    ${partnerMetrics([['Accruing / on hold',money(summary.pending_cents||0)],['Eligible for payout',money(summary.eligible_cents||0)],['Total paid',money(summary.paid_cents||0)]])}
   </section>
   <section class="ae-panel"><h3>Payout method</h3>
    ${d.bank?`<p>Direct deposit · ${esc(d.bank.bank_name)} · ${esc(d.bank.account_type)} ending in ${esc(d.bank.last4)}</p>`:'<p>Add your US bank details to receive partner commissions.</p>'}
    <p role="status">${esc(notice)}</p>
    ${d.bank_setup_available?'':'<p>Secure bank setup is temporarily unavailable.</p>'}
    <details><summary>${d.bank?'Change payout details':'Set up payout details'}</summary>
     <form class="ap-form rd-bank-form">
      <div class="rd-bank-fields">
       <label>Name on bank account<input name="holder" maxlength="120" required autocomplete="name"></label>
       <label>Phone<input name="phone" maxlength="40" minlength="7" required type="tel" autocomplete="tel"></label>
       <label>Bank name<input name="bank_name" maxlength="120" required></label>
       <label>Account type<select name="account_type"><option value="checking">Checking</option><option value="savings">Savings</option></select></label>
       <input type="hidden" name="country" value="US">
       <label class="rd-bank-address">Account holder address<input name="address" maxlength="300" minlength="5" required autocomplete="street-address"></label>
       <label class="rd-bank-address">Routing number<input name="routing_number" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" required autocomplete="off"></label>
       <label>Account number<input name="account_number" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" required autocomplete="off"></label>
       <label>Confirm account number<input name="confirm_account" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" required autocomplete="off"></label>
      </div>
      <label class="ap-checkbox-label"><input name="authorized" type="checkbox" required> I confirm that I control this account and authorize PURE to use these details for partner commission deposits.</label>
      <p class="dc-note">Bank details are encrypted and displayed with only the last four account digits. Saving does not initiate a transfer or debit. For a bank outside the US, contact support for payout setup.</p>
      <button class="ap-button" ${d.bank_setup_available?'':'disabled data-unavailable="true"'}>Save payout details</button>
      <p role="status"></p>
     </form>
    </details>
   </section>
   <section class="ae-panel"><h3>Payout schedule</h3><p>Monthly manual payouts, minimum $100. Delivered orders become eligible on the first day of the following month (UTC). Refunded commissions reverse; refunds after payout offset later earnings.</p><a href="/partner-terms.html">Program terms →</a></section>`;
 }

 const partnerTabs=[['overview','Overview'],['commissions','Commissions'],['wallet','Wallet']];

 function mountPartnerTabs(root){
  const tabs=[...root.querySelectorAll('[data-partner-tab]')];
  const panels=[...root.querySelectorAll('[data-partner-panel]')];

  function select(index){
   tabs.forEach((tab,i)=>{
    tab.setAttribute('aria-selected',String(i===index));
    tab.tabIndex=i===index?0:-1;
    panels[i].hidden=i!==index;
   });
  }
  tabs.forEach((tab,index)=>{
   tab.onclick=()=>select(index);
   tab.onkeydown=event=>{
    let next;
    switch(event.key){
     case 'ArrowLeft':next=(index+tabs.length-1)%tabs.length;break;
     case 'ArrowRight':next=(index+1)%tabs.length;break;
     case 'Home':next=0;break;
     case 'End':next=tabs.length-1;break;
     default:return;
    }
    event.preventDefault();
    select(next);
    tabs[next].focus();
   };
  });
 }

 async function partner(root,auth,activeTab='overview',notice=''){
  root.textContent='Loading your partner dashboard…';
  try{
   const d=await request('partner=dashboard',null,auth);
   const codeField='<label>Choose your referral code<input name="code" maxlength="24" minlength="3" pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,23}" placeholder="YOURNAME" required autocomplete="off"><small>3–24 letters, numbers, hyphens or underscores.</small></label>';
   if(!d.partner){
    root.innerHTML=`<section class="ae-panel"><h2>Become a PURE partner</h2><p>Join free, choose your code and receive a referral link immediately. No application review.</p><p>Earn 40% on eligible first orders and 10% on future orders.</p><form class="ap-form rd-partner-form">${codeField}<label class="ap-checkbox-label"><input type="checkbox" required> I accept the <a href="/partner-terms.html" target="_blank" rel="noopener">partner terms</a>.</label><button class="ap-button">Join and Get My Code</button><p role="status"></p></form></section>`;
    root.querySelector('form').onsubmit=async event=>{
     event.preventDefault();
     const form=event.target,button=form.querySelector('button');
     button.disabled=true;
     try{
      await request('partner=dashboard',{action:'join',code:form.elements.code.value,accepted:true,terms_version:d.terms.version},auth);
      await partner(root,auth);
     }catch(error){
      form.querySelector('[role=status]').textContent=error.message;
      button.disabled=false;
     }
    };
    return;
   }

   const codes=d.codes?.length?d.codes:[{code:d.partner.code}];
   const summary=d.summary||{},sharing=d.partner.status==='active';
   const panels={
    overview:`${referralTools(d.partner,codes)}<div class="rd-partner-overview">${partnerCodes(codes,d.partner.code,sharing,codeField)}${partnerActivity(d.performance)}</div>`,
    commissions:partnerCommissions(summary,d.events),
    wallet:partnerWallet(d,summary,notice)
   };
   root.innerHTML=`<div class="rd-partner-dashboard">
    <div class="rd-partner-tabs" role="tablist" aria-label="Partner dashboard">
     ${partnerTabs.map(([id,label])=>`<button type="button" role="tab" id="rd-partner-tab-${id}" data-partner-tab="${id}" aria-controls="rd-partner-panel-${id}" aria-selected="${id===activeTab}" tabindex="${id===activeTab?0:-1}">${label}</button>`).join('')}
    </div>
    ${partnerTabs.map(([id])=>`<section role="tabpanel" tabindex="0" id="rd-partner-panel-${id}" data-partner-panel="${id}" aria-labelledby="rd-partner-tab-${id}"${id===activeTab?'':' hidden'}>${panels[id]}</section>`).join('')}
   </div>`;
   mountPartnerTabs(root);
   mountReferralTools(root,d.partner.code);

   const codeStatus=root.querySelector('[data-code-status]');
   root.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{
    try{
     await navigator.clipboard.writeText(button.dataset.copy);
     codeStatus.textContent='Referral code copied.';
    }catch{
     codeStatus.textContent='Select the code and copy it manually.';
    }
   });

   const codesForm=root.querySelector('.rd-code-form');
   if(codesForm){
    codesForm.onsubmit=async event=>{
     event.preventDefault();
     const button=codesForm.querySelector('button');
     button.disabled=true;
     try{
      await request('partner=dashboard',{action:'add_code',code:codesForm.elements.code.value},auth);
      await partner(root,auth);
     }catch(error){
      codesForm.querySelector('[role=status]').textContent=error.message;
      button.disabled=false;
     }
    };
   }

   const bank=root.querySelector('.rd-bank-form');
   bank.onsubmit=async event=>{
    event.preventDefault();
    const button=bank.querySelector('button');
    if(button.disabled)return;
    button.disabled=true;
    try{
     await request('partner=dashboard',{...Object.fromEntries(new FormData(bank)),action:'save_bank',authorized:bank.elements.authorized.checked},auth);
     bank.reset();
     await partner(root,auth,'wallet','Payout details saved securely.');
     root.querySelector('[data-partner-tab=wallet]')?.focus();
    }catch(error){
     bank.querySelector('[role=status]').textContent=error.message;
     button.disabled=false;
    }
   };
  }catch(error){
   root.textContent=error.message;
  }
 }
 let campaignRequest;
 let holidayOffer=null;
 function requestCampaign(path,body){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),4500);
  return request(path,body,null,controller.signal).finally(()=>clearTimeout(timeout));
 }
 function readCampaign(){
  campaignRequest ||= requestCampaign('campaign=window').catch(error=>{campaignRequest=null;throw error;});
  return campaignRequest;
 }
 let eligibleVariants=new Set(),campaignStatus='loading',discountPercent=0;
 function publishCampaign(status,variants=[],percent=0){
  eligibleVariants=new Set(variants);
  campaignStatus=status;
  discountPercent=percent;
  window.dispatchEvent(new Event('pure:campaign'));
 }
 function secondUnitOffer(campaign){
  const offer=campaign?.second_unit;
  if(!offer?.eligible_variants?.length||!Number.isInteger(offer.discount_bps)||
     offer.discount_bps<=0||offer.discount_bps>=10000)return null;
  return offer;
 }
 function mountPromoLoop(announcement,fallback){
  const viewport=document.createElement('div'),track=document.createElement('div'),set=document.createElement('div');
  const pause=document.createElement('button');
  viewport.className='pure-promo-window';
  track.className='pure-promo-track';
  set.className='pure-promo-set';
  fallback.before(viewport);
  set.append(fallback);
  const threshold=Number(announcement.dataset.freeShippingCents);
  if(Number.isSafeInteger(threshold)&&threshold>0){
   const shipping=document.createElement('a');
   const amount=money(threshold).replace(/\.00$/,'')+'+';
   shipping.className='pure-offer-trigger pure-shipping-slide';
   shipping.href='/shipping-policy';
   shipping.setAttribute('aria-label','Free shipping '+amount+'. See shipping details.');
   shipping.innerHTML='<span class="pure-offer-buy">Free shipping</span><strong class="pure-offer-free"><span>'+esc(amount)+'</span></strong><span class="pure-offer-action">Details</span>';
   set.append(shipping);
  }
  track.append(set);
  viewport.append(track);
  pause.type='button';
  pause.className='pure-promo-pause';
  pause.setAttribute('aria-label','Pause promotions');
  pause.textContent='Ⅱ';
  pause.addEventListener('click',()=>{
   const paused=announcement.classList.toggle('pure-promo-paused');
   pause.setAttribute('aria-label',paused?'Play promotions':'Pause promotions');
   pause.textContent=paused?'▶':'Ⅱ';
  });
  viewport.addEventListener('focusout',event=>{
   if(!viewport.contains(event.relatedTarget))viewport.scrollLeft=0;
  });
  announcement.append(pause);
  let copies=[],width=0,period=0;
  function sizeLoop(removedWidth=0,rebuild=false){
   const nextWidth=set.getBoundingClientRect().width;
   const needed=nextWidth?Math.max(1,Math.ceil((viewport.clientWidth+4)/nextWidth)):1;
   if(!rebuild&&nextWidth===width&&copies.length===needed)return;
   const elapsed=set.getAnimations?.()[0]?.currentTime;
   const cycles=period&&Number.isFinite(elapsed)?Math.floor(elapsed/period):0;
   const offset=period&&Number.isFinite(elapsed)?(elapsed-cycles*period)/period*width:0;
   if(rebuild)while(copies.length)copies.pop().remove();
   while(copies.length>needed)copies.pop().remove();
   while(copies.length<needed){
    const repeat=set.cloneNode(true);
    repeat.classList.add('pure-promo-repeat');
    repeat.setAttribute('aria-hidden','true');
    repeat.querySelectorAll('a,button').forEach(control=>control.tabIndex=-1);
    repeat.querySelectorAll('[role=status]').forEach(status=>status.removeAttribute('role'));
    const copied=repeat.querySelector('[data-copy-offer].is-copied');
    if(copied){
     copied.classList.remove('is-copied');
     copied.querySelector('span').textContent=copied.dataset.copyOffer;
     repeat.querySelector('[data-offer-status]').textContent='';
    }
    copies.push(repeat);
    track.append(repeat);
   }
   if(!nextWidth)return;
   width=nextWidth;
   period=Math.max(6000,width*1000/64);
   const sets=[set,...copies];
   track.style.setProperty('--promo-entry',copies.length*width+'px');
   track.style.setProperty('--promo-exit',-width+'px');
   track.style.setProperty('--promo-duration',sets.length*period+'ms');
   // Each repeat restarts past the clipped edges while the other repeats stay in motion.
   sets.forEach((group,index)=>group.style.setProperty('--promo-delay',(index-copies.length)*period+'ms'));
   const phase=cycles*period+Math.max(0,offset-removedWidth)%width/width*period;
   for(const group of sets){
    const animation=group.getAnimations?.()[0];
    if(animation)animation.currentTime=phase;
   }
  }
  function refresh(removedWidth){
   sizeLoop(removedWidth,true);
  }
  function start(){
   announcement.classList.add('pure-promo-loop');
   const resize=()=>sizeLoop();
   if(window.ResizeObserver){
    const observer=new ResizeObserver(resize);
    observer.observe(viewport);
    observer.observe(set);
   }else window.addEventListener('resize',resize);
   sizeLoop();
  }
  return {set,track,refresh,start};
 }
 // Midnight at the start of Christmas Day in Toronto (EST).
 const christmas=Date.parse('2026-12-25T00:00:00-05:00');
 async function readChristmasOffer(campaign){
  const end=Date.parse(campaign?.ends_at),serverTime=Date.parse(campaign?.server_time);
  const variants=Array.isArray(campaign?.eligible_variants)?campaign.eligible_variants:[];
  const key=variants[0],separator=typeof key==='string'?key.indexOf(':'):-1;
  if(!Number.isFinite(serverTime)||end!==christmas||serverTime>=end||separator<=0)return null;
  const offset=serverTime-Date.now();
  const id=key.slice(0,separator),size=key.slice(separator+1);
  // Read the estimate from the same pricing engine used by checkout.
  const quote=await requestCampaign('checkout=cart',{items:[{id,size,qty:1}],country:'US',coupon:'BLACKFRIDAY10'}).catch(()=>null);
  const bonus=quote?.pricing?.bogo_campaign;
  if(!(quote?.pricing?.coupon_discount_cents>0)||bonus?.ends_at!==campaign.ends_at||
     !Array.isArray(bonus.free_units)||!bonus.free_units.some(item=>item?.id===id&&item.size===size&&item.qty===1)||
     Date.now()+offset>=end)return null;
  return {end,offset,campaign:Object.freeze({endsAt:campaign.ends_at,eligibleVariants:Object.freeze([...variants])})};
 }
 function mountChristmasOffer(loop,{end,offset}){
  const slide=document.createElement('a'),countdown=document.createElement('time'),snowflake=document.createElement('span');
  slide.className='pure-offer-trigger pure-christmas-slide';
  slide.href='/shop';
  slide.innerHTML='<span class="pure-christmas-snowflake" aria-hidden="true">❄</span><span class="pure-offer-buy pure-christmas-title"><i class="pure-christmas-hat" aria-hidden="true"></i>Christmas</span><strong class="pure-offer-free"><span>BOGO Sale</span></strong>';
  countdown.dateTime=new Date(end).toISOString();
  countdown.title='Ends at the end of December 24, Toronto time';
  countdown.append(document.createElement('span'));
  slide.append(countdown);
  snowflake.className='pure-christmas-snowflake pure-promo-divider';
  snowflake.setAttribute('aria-hidden','true');
  snowflake.textContent='❄';
  loop.set.prepend(slide,snowflake);
  function tick(){
   const remaining=Math.ceil((end-Date.now()-offset)/1000);
   if(remaining<=0){
    clearInterval(clock);
    holidayOffer=null;
    const removedWidth=slide.getBoundingClientRect().width+snowflake.getBoundingClientRect().width;
    if(document.activeElement===slide)loop.set.querySelector('[data-copy-offer]')?.focus();
    slide.remove();
    snowflake.remove();
    if(loop.track.isConnected&&loop.track.closest('.pure-promo-loop'))loop.refresh(removedWidth);
    window.dispatchEvent(new Event('pure:campaign'));
    return;
   }
   const days=Math.floor(remaining/86400);
   const time=[Math.floor(remaining/3600)%24,Math.floor(remaining/60)%60,remaining%60].map(value=>String(value).padStart(2,'0')).join(':');
   for(const display of loop.track.querySelectorAll('.pure-christmas-slide time span'))display.textContent=(days?days+'d ':'')+time;
  }
  const clock=setInterval(tick,1000);
  tick();
 }
 async function mountCampaignStrip(){
  const announcement=document.querySelector('.ap-announcement');
  const fallback=announcement?.querySelector('[data-default-offer]');
  const campaign=await readCampaign().catch(()=>null);
  const holiday=fallback&&await readChristmasOffer(campaign);
  const offer=holiday?null:secondUnitOffer(campaign);
  const percent=offer?offer.discount_bps/100:0;
  const active=fallback?.contains(document.activeElement)?document.activeElement:null;
  // Keep the static coupon visible until the complete initial offer set can move together.
  const loop=fallback&&mountPromoLoop(announcement,fallback);
  if(holiday){
   holidayOffer=holiday.campaign;
   mountChristmasOffer(loop,holiday);
  }
  if(offer&&fallback){
   const trigger=document.createElement('a');
   trigger.href='/shop?offer=second-unit';
   trigger.className='pure-offer-trigger';
   trigger.textContent=percent+'% off the second unit on eligible pairs';
   announcement.classList.add('pure-offer-active');
   fallback.replaceWith(trigger);
  }
  loop?.start();
  if(active?.isConnected)active.focus({preventScroll:true});
  publishCampaign(campaign?(offer?'active':'inactive'):'unavailable',offer?.eligible_variants,percent);
 }
 async function mountCountdown(root){
  if(!root)return;
  try{
   const offer=secondUnitOffer(await readCampaign());
   if(!root.isConnected||!offer?.eligible_variants.includes(root.dataset.campaignProduct))return;
   root.textContent='Buy two of this strength and get '+offer.discount_bps/100+'% off the second unit.';
   root.hidden=false;
  }catch{root.hidden=true;}
 }
 let dispatchRequest;
 async function mountDispatch(root){
  if(!root)return;
  try {
   dispatchRequest ||= request('dispatch=1').catch(()=>null);
   const cutoff=(await dispatchRequest)?.cutoff;
   if(!cutoff)return;
   root.textContent='Same-day US dispatch for eligible paid orders before '+cutoff.time+' ('+cutoff.time_zone+'), Monday to Friday.';
   root.hidden=false;
  }catch{}
 }
 window.PureCampaign={mountCountdown,mountDispatch,eligible:(id,size)=>eligibleVariants.has(id+':'+size),get status(){return campaignStatus;},get discountPercent(){return discountPercent;},get holiday(){return holidayOffer;}};
 function startCampaignStrip(){
  mountCampaignStrip().catch(()=>{
   holidayOffer=null;
   publishCampaign('unavailable');
  });
 }
 if(document.querySelector('.ap-announcement [data-default-offer]')){
  startCampaignStrip();
 }else if(/^\/(?:$|index(?:\.html)?$|shop(?:\.html)?\/?$|product\/)/.test(location.pathname)){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startCampaignStrip,{once:true});
  else startCampaignStrip();
 }
 if(/^\/(?:$|shop(?:\/|$)|product\/)/.test(location.pathname)){
  document.addEventListener('mouseout',function exitOffer(event){
   if(event.relatedTarget||event.clientY>0||document.querySelector('dialog[open]'))return;
   try{
    if(sessionStorage.getItem('pure-exit-offer-shown'))return;
    sessionStorage.setItem('pure-exit-offer-shown','1');
   }catch{}
   document.removeEventListener('mouseout',exitOffer);
   const dialog=document.createElement('dialog');dialog.className='ap-dialog cv-discount-dialog';
   dialog.setAttribute('aria-labelledby','pure-discount-heading');
   dialog.innerHTML=`
    <header class="cv-discount-hero">
     <span class="pure-wordmark" role="img" aria-label="PURE"></span>
     <button type="button" class="cv-discount-close" data-close aria-label="Close offer">×</button>
     <h2 id="pure-discount-heading">GET <strong>10% OFF</strong></h2>
     <p>Save on eligible items at checkout.</p>
    </header>
    <div class="cv-discount-body">
     <form class="ap-form">
      <label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254"></label>
      <label class="ap-checkbox-label"><input name="consent" type="checkbox" required> I agree to receive PURE offers by email.</label>
      <button class="ap-button">Unlock 10% off</button>
     </form>
     <p role="status"></p>
    </div>`;
   const form=dialog.querySelector('form'),status=dialog.querySelector('[role=status]');
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   dialog.addEventListener('close',()=>dialog.remove(),{once:true});
   form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector('button');button.disabled=true;
    try{
     const result=await request('campaign=signup',{email:form.elements.email.value,consent:form.elements.consent.checked});
     form.hidden=true;
     status.classList.add('cv-discount-code');
     const code=document.createElement('strong');code.textContent=result.code;
     status.replaceChildren('Your checkout code',code);
     try{
      const keys=['ap-checkout-coupon','ap-cart-coupon'];
      const existing=keys.map(key=>localStorage.getItem(key)).find(Boolean);
      if(result.code==='BLACKFRIDAY10'&&(!existing||existing===result.code)){
       for(const key of keys)localStorage.setItem(key,result.code);
       status.replaceChildren('10% off saved to your cart',code);
      }
     }catch{}
    }catch(error){status.textContent=error.message;button.disabled=false;}
   };
   document.body.append(dialog);dialog.showModal();
  });
 }
 const ref=new URLSearchParams(location.search).get('ref');if(ref&&/^[A-Z0-9][A-Z0-9_-]{2,23}$/i.test(ref)){
  const countStart=navigator.globalPrivacyControl!==true && navigator.doNotTrack!=='1' && window.doNotTrack!=='1' && navigator.webdriver!==true && !document.prerendering;
  window.PurePartnerVisit=request('partner=visit',{action:'visit',code:ref,count_start:countStart}).catch(()=>{});
 }
 window.ConversionUI={cart,partner,membershipCards,mountMembership};
})();
