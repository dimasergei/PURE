/* Customer-editable contact information is never used as payment or entitlement authority. */
(() => {
 'use strict';
 const legacyRewardsPage=['/my-account','/account'].includes(location.pathname.replace(/\/$/,''));
 if(legacyRewardsPage && ['#rewards','#rewards-and-credit'].includes(location.hash)){
  history.replaceState(history.state,'','/my-account/points'+location.search);
 }
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v/100);
 const field=(label,name,value='',auto='',extra='')=>`<label>${label}<input name="${name}" value="${esc(value)}" autocomplete="${auto}" ${extra}></label>`;
 const notice=(el,text,error=false)=>{el.textContent=text;el.className=error?'account-error':'account-message';};
 function addressFields(kind,a={}){
  const listId='ae-'+kind+'-countries';
  const countries=window.PureSite?.shipping?.countries||[];
  let regionNames;
  try{regionNames=new Intl.DisplayNames([document.documentElement.lang||'en'],{type:'region'});}catch{}
  const suggestions='<datalist id="'+listId+'">'+countries.map(code=>'<option value="'+esc(code)+'">'+esc(regionNames?.of(code)||code)+'</option>').join('')+'</datalist>';
  return `<fieldset class="ae-panel"><legend>${kind==='shipping'?'Shipping address':'Billing address'}</legend><p class="account-muted">${kind==='shipping'?'Used to fill your delivery details at checkout.':'Saved for your billing records.'}</p><div class="ae-fields">${field('Recipient name',kind+'_name',a.name,'section-'+kind+' name','maxlength="120"')}${field('Company / laboratory',kind+'_organization',a.organization,'section-'+kind+' organization','maxlength="180"')}${field('Street address',kind+'_line1',a.line1,'section-'+kind+' address-line1','maxlength="180"')}${field('Apartment, suite, etc. (optional)',kind+'_line2',a.line2,'section-'+kind+' address-line2','maxlength="180"')}${field('City',kind+'_city',a.city,'section-'+kind+' address-level2','maxlength="80"')}${field('State / province',kind+'_region',a.region,'section-'+kind+' address-level1','maxlength="80"')}${field('ZIP / postal code',kind+'_postal_code',a.postal_code,'section-'+kind+' postal-code','maxlength="20"')}${field('Country code',kind+'_country',a.country,'section-'+kind+' country','maxlength="2" pattern="[A-Za-z]{2}" list="'+listId+'" placeholder="US"')}${suggestions}</div></fieldset>`;}
 function profilePayload(values){
  const text=(key,max)=>String(values[key]||'').trim().slice(0,max);
  const full_name=text('full_name',120);if(full_name.length<2)throw Error('Enter a display name of at least two characters.');
  const address=kind=>Object.fromEntries(['name','organization','line1','line2','city','region','postal_code','country'].map(k=>[k,k==='country'?text(kind+'_'+k,2).toUpperCase():text(kind+'_'+k,k==='name'?120:k==='organization'||k.startsWith('line')?180:k==='postal_code'?20:80)]));
  return {full_name,first_name:text('first_name',60),last_name:text('last_name',60),alta_profile:{phone:text('phone',40),organization:text('organization',180),shipping:address('shipping'),billing_same_as_shipping:values.billing_same==='on',billing:values.billing_same==='on'?address('shipping'):address('billing')}};
 }
 async function profile(root,auth,user,callbackUrl=path=>new URL(path,location.origin).href){
  try{const result=await auth.auth.getUser();if(result.error||!result.data?.user)throw Error('Please sign in again.');user=result.data.user;}catch(e){root.textContent=e.message;return;}
  const meta=user.user_metadata||{},p=meta.alta_profile||{};
  root.innerHTML=`<form id="ae-profile" class="ae-form"><section class="ae-panel"><h2>Contact details</h2><p class="account-muted">Keep your contact information and delivery addresses up to date.</p><div class="ae-fields">${field('First name','first_name',meta.first_name,'given-name','maxlength="60"')}${field('Last name','last_name',meta.last_name,'family-name','maxlength="60"')}${field('Display name','full_name',meta.full_name,'nickname','required minlength="2" maxlength="120"')}${field('Phone number','phone',p.phone,'tel','type="tel" maxlength="40"')}${field('Company / laboratory','organization',p.organization,'organization','maxlength="180"')}</div></section>${addressFields('shipping',p.shipping)}<label class="ap-checkbox-label ae-billing-check"><input type="checkbox" name="billing_same" ${p.billing_same_as_shipping?'checked':''}> Billing address is the same as shipping</label><div id="ae-billing">${addressFields('billing',p.billing)}</div><div class="ae-actions"><button class="ap-button" type="submit">Save profile and addresses</button><p role="status" aria-live="polite"></p></div></form><section class="ae-panel ae-security"><h2>Sign-in &amp; security</h2><form id="ae-email" class="ae-form"><div class="ae-fields">${field('Email address','email',user.email,'email','required type="email" maxlength="254"')}</div><p class="account-muted">Changing your sign-in email requires email confirmation. Earlier guest orders are linked by the email used at purchase; contact support if you need help finding them after a change.</p><button class="ap-button ap-button-secondary" type="submit">Update email address</button><p role="status" aria-live="polite"></p></form><hr><h3>Password</h3><p>Use a secure email link to set or change your password.</p><button id="ae-password" type="button" class="ap-button ap-button-secondary">Send password change link</button><p id="ae-password-status" role="status" aria-live="polite"></p></section>`;
  const form=root.querySelector('#ae-profile'),billing=root.querySelector('#ae-billing');
  const toggle=()=>{billing.hidden=form.elements.billing_same.checked;for(const el of billing.querySelectorAll('input'))el.disabled=form.elements.billing_same.checked;};
  form.elements.billing_same.onchange=toggle;toggle();
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button'),out=form.querySelector('[role="status"]');button.disabled=true;try{const payload=profilePayload(Object.fromEntries(new FormData(form)));const result=await auth.auth.updateUser({data:payload});if(result.error)throw result.error;notice(out,'Your profile and addresses are saved. Existing orders keep their original delivery details.');}catch(e){notice(out,e.message||'Your profile could not be saved.',true);}finally{button.disabled=false;}};
  const emailForm=root.querySelector('#ae-email');emailForm.onsubmit=async e=>{e.preventDefault();const email=emailForm.elements.email.value.trim(),button=emailForm.querySelector('button'),out=emailForm.querySelector('[role="status"]');if(email.toLowerCase()===String(user.email).toLowerCase())return notice(out,'This is already your sign-in email.');button.disabled=true;try{const result=await auth.auth.updateUser({email},{emailRedirectTo:callbackUrl('/account')});if(result.error)throw result.error;notice(out,'Email change requested. Follow the confirmation instructions sent to your email addresses before using the new sign-in address.');}catch(e){notice(out,e.message||'Email change could not be requested.',true);}finally{button.disabled=false;}};
  root.querySelector('#ae-password').onclick=async e=>{const button=e.currentTarget,out=root.querySelector('#ae-password-status');button.disabled=true;try{const result=await auth.auth.resetPasswordForEmail(user.email,{redirectTo:callbackUrl('/account/reset-password')});if(result.error)throw result.error;notice(out,'Check your account email for the secure password change link.');}catch(e){notice(out,e.message||'The email could not be sent. Please try again.',true);}finally{button.disabled=false;}};
 }
 function reorderLines(items, catalog){
  if(!Array.isArray(items)||!items.length)throw Error('No catalog items are available to reorder.');
  const grouped=new Map();
  for(const item of items){
   const id=item.id||item.product_id, name=item.name||item.product_name;
   const match=id?catalog.filter(p=>p.id===id):catalog.filter(p=>p.name===name);
   const size=item.size||item.variant_size,qty=item.qty??item.quantity;
   if(match.length!==1||!match[0].variants.some(v=>v.size===size)||!Number.isSafeInteger(qty)||qty<1)throw Error('One or more original selections are unavailable. Review the current catalog to choose a replacement.');
   const key=match[0].id+'|'+size,units=(grouped.get(key)?.qty||0)+qty;
   if(units>100)throw Error('Select up to 100 units of each strength for your regular cart.');
   grouped.set(key,{id:match[0].id,size,qty:units});
  }
  return [...grouped.values()];
 }
 function addReorderButton(card, readItems){
  if(!card||!window.AltaStore?.addItems)return;
  const button=document.createElement('button'), status=document.createElement('p');
  button.type='button';button.className='ap-button ap-button-secondary';button.textContent='Add items to regular cart';status.setAttribute('role','status');
  card.append(button,status);
  button.onclick=async()=>{
   button.disabled=true;status.textContent='Checking current products and strengths…';
   try{
    const items=await readItems();
    window.AltaStore.addItems(reorderLines(items,window.AltaStore.catalog));
    location.assign('/cart');
   }catch(error){status.textContent=error.message||'Could not add these items. Please try again.';button.disabled=false;}
  };
 }
 async function orders(root,auth,user,legacyApi,legacyCard){
  const query=new URLSearchParams(location.search),view=['history','tracking','pending'].includes(query.get('view'))?query.get('view'):'all';
  root.innerHTML=`<nav class="ae-subnav" aria-label="Order views">${[['all','All orders'],['pending','Awaiting payment'],['tracking','Tracking'],['history','Earlier orders']].map(([id,label])=>`<a href="/account/purchases${id==='all'?'':'?view='+id}" ${id===view?'aria-current="page"':''}>${label}</a>`).join('')}</nav><div class="ae-order-tools"><label>Search orders<input id="ae-order-search" type="search" placeholder="Order number, product or carrier"></label><a class="ap-button ap-button-secondary" href="/shop">Continue shopping</a></div><p id="ae-search-count" role="status"></p><section id="ae-current-orders"></section><section id="ae-earlier-orders"></section>`;
  const review=query.get('review');
  if(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(review||'')){
   const panel=document.createElement('section');panel.className='ae-panel';
   panel.innerHTML='<h2>Review your order</h2><p>Share an honest rating. Eligible customers receive US$50 store credit regardless of rating, once every 90 days.</p><form class="ae-form"><label>Rating <select name="rating" required><option value="">Select a rating</option><option value="5">5 out of 5</option><option value="4">4 out of 5</option><option value="3">3 out of 5</option><option value="2">2 out of 5</option><option value="1">1 out of 5</option></select></label><button class="ap-button">Submit review</button></form><p role="status"></p>';
   root.prepend(panel);
   const form=panel.querySelector('form'),status=panel.querySelector('[role=status]');
   async function reviewRequest(body){
    const {data}=await auth.auth.getSession();
    if(!data.session)throw Error('Sign in to continue.');
    const response=await fetch('/api/customer-config?reviews=credit',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error);
    return result;
   }
   form.onsubmit=async event=>{
    event.preventDefault();
    const submit=form.querySelector('button');submit.disabled=true;
    try{
     const result=await reviewRequest({action:'submit',invoice_id:review,rating:Number(form.elements.rating.value)});
     form.hidden=true;status.textContent='Review submitted.';
     if(result.code&&!result.redeemed){
      const redeem=document.createElement('button');redeem.className='ap-button';redeem.type='button';redeem.textContent='Redeem US$50 store credit';
      panel.append(redeem);
      redeem.onclick=async()=>{redeem.disabled=true;try{await reviewRequest({action:'redeem',code:result.code});status.textContent='US$50 store credit added to your account.';redeem.remove();}catch(error){status.textContent=error.message;redeem.disabled=false;}};
     }
    }catch(error){status.textContent=error.message;submit.disabled=false;}
   };
  }
  const current=root.querySelector('#ae-current-orders'),earlier=root.querySelector('#ae-earlier-orders');
  let earlierRows=[];
  const tasks=[];
  if(view!=='history')tasks.push(window.DirectCheckout.orders(current,auth,user,{view}));
  if(view!=='pending'&&!query.get('id'))tasks.push((async()=>{try{const result=await legacyApi(),rows=(result.orders||[]).filter(o=>view!=='tracking'||o.tracking_number||o.tracking_url);earlierRows=rows;earlier.innerHTML='<h2>Earlier orders</h2>'+(rows.length?rows.map(legacyCard).join(''):'<p class="account-muted">'+(view==='tracking'?'No earlier orders have tracking yet.':'No earlier orders are linked to this email.')+'</p>');}catch(e){earlier.innerHTML='<p role="alert">Earlier orders could not be loaded. Please refresh to try again.</p>';}})());
  await Promise.all(tasks);
  const historicalCards=[...earlier.querySelectorAll('article')];
  earlierRows.forEach((order,i)=>{if(order.items?.length)addReorderButton(historicalCards[i],()=>order.items);});
  for(const card of current.querySelectorAll('article.dc-clean-order')){
   if(!card.querySelector('.dc-clean-items'))continue;
   const label=card.querySelector('h2')?.textContent.trim().replace(/^Order /,'');
   if(!label)continue;
   addReorderButton(card,async()=>{
    const session=(await auth.auth.getSession()).data?.session;
    if(!session?.access_token)throw Error('Sign in again to view your order.');
    const endpoint=new URL('/api/customer-config',location.origin);
    endpoint.searchParams.set('commerce','customer');
    if(query.get('id'))endpoint.searchParams.set('id',query.get('id'));
    const response=await fetch(endpoint.href,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
    if(!response.ok)throw Error('Your order could not be retrieved. Refresh and try again.');
    const data=await response.json();
    const matches=(data.invoices||[]).filter(row=>(row.public_order_number||'AP'+String(row.id||'').replaceAll('-','').slice(0,10).toUpperCase())===label);
    if(matches.length!==1||matches[0].kind!=='goods')throw Error('This order cannot be reordered in the regular cart.');
    return matches[0].request_data?.items||matches[0].pricing?.lines;
   });
  }
  const input=root.querySelector('#ae-order-search');input.oninput=()=>{const term=input.value.trim().toLowerCase();let count=0;for(const card of root.querySelectorAll('article')){card.hidden=!!term&&!card.textContent.toLowerCase().includes(term);if(!card.hidden)count++;}root.querySelector('#ae-search-count').textContent=term?count+' matching order'+(count===1?'':'s'):'';};
 }
 async function rewards(root,auth,path){root.innerHTML=`<nav class="ae-subnav" aria-label="Rewards views"><a href="/account/points" ${path.endsWith('points')?'aria-current="page"':''}>Points</a><a href="/account/store-credit" ${path.endsWith('store-credit')?'aria-current="page"':''}>Store credit</a></nav><div id="ae-balance"></div>`;await window.DirectCheckout.balance(root.querySelector('#ae-balance'),auth,path);}
 window.AccountExperience={profile,profilePayload,orders,rewards,reorderLines};
})();
