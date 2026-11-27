(async () => {
  'use strict';
  const root = document.getElementById('monthly-content');
  const status = document.getElementById('monthly-status');
  const params = new URLSearchParams(location.search);
  const builderRoute=location.pathname.replace(/\/$/,'')==='/subscribe-and-save/checkout'||params.has('builder');
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
  const when = value => new Date(value).toLocaleDateString(undefined,{dateStyle:'medium'});
  const displayCountry = new Intl.DisplayNames(['en'],{type:'region'});
  const link = (href,label) => '<a class="button" href="'+esc(href)+'">'+esc(label)+'</a>';
  const field = (label,name,value,autocomplete,required=true) => '<label>'+esc(label)+'<input name="'+name+'" autocomplete="'+autocomplete+'" value="'+esc(value)+'" '+(required?'required':'')+'></label>';
  let auth, overview, catalog, user;
  const api = async (body,publicView=false) => {
    const session = (await auth.auth.getSession()).data.session;
    if (!publicView && !session) throw Error('Sign in to continue.');
    const response = await fetch('/api/customer-config?repeat_orders='+(publicView?'checkout':'1'),{method:body?'POST':'GET',cache:'no-store',
      headers:{...(session?{Authorization:'Bearer '+session.access_token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Subscription details are temporarily unavailable.');
    return data;
  };
  const line = (name,value,cls='') => {
    const amountTag = cls === 'retail-value' ? 'del' : 'span';
    return `<div class="line ${cls}"><span>${esc(name)}</span><${amountTag}>${esc(value)}</${amountTag}></div>`;
  };
  const deliveryTimeline = '<ol class="monthly-deliveries" aria-label="Delivery schedule">'+
    [1,2,3].map(month=>'<li><span aria-hidden="true">'+month+'</span> Month '+month+'</li>').join('')+'</ol>';
  function orderItem(item, bundled = false) {
    const store = window.AltaStore;
    const product = store?.product(item.id === 'gift-bac-3' ? 'bac-3' : item.id);
    const image = product ? store.image(product,item.size) : '';
    const retail = bundled ? bundledValue([item]) : item.gross_cents;
    const crossedPrice = Number.isSafeInteger(retail) && retail > item.line_total_cents ? '<del>'+esc(money(retail))+'</del>' : '';
    return '<li class="monthly-summary-item'+(bundled?' monthly-included':'')+'">'+
      (image?'<img src="'+esc(image)+'" width="52" height="52" alt="">':'<span class="monthly-item-placeholder" aria-hidden="true"></span>')+
      '<div><strong>'+esc(item.name)+'</strong><small>'+esc(item.size)+' · Qty '+esc(item.qty)+'</small>'+
      (bundled?'<small>With every delivery</small>':'')+'</div>'+
      '<span class="monthly-price-stack"><strong class="monthly-item-amount">'+esc(bundled?'Bundled':money(item.line_total_cents))+'</strong>'+crossedPrice+'</span></li>';
  }
  function bundledValue(items) {
    const recon = window.AltaStore?.product('bac-3');
    return items.reduce((sum,item)=>{
      const variant = item.id === 'gift-bac-3' && recon?.variants.find(entry=>entry.size===item.size);
      return sum+(variant&&Number.isFinite(variant.price)?Math.round(variant.price*100)*item.qty:0);
    },0);
  }
  function orderedPlanUnits(lines, draftOrder) {
    const key = ({id, size}) => JSON.stringify([id, size]);
    const unit = line => ({...line, qty: 1, gross_cents: line.gross_cents / line.qty, line_total_cents: line.line_total_cents / line.qty});
    const canonical = lines.flatMap(line => Array.from({length: line.qty}, () => unit(line)));
    if (!Array.isArray(draftOrder) || draftOrder.length !== canonical.length) return canonical;
    const available = new Map(lines.map(line => [key(line), {line, remaining: line.qty}]));
    const ordered = [];
    for (const item of draftOrder) {
      const entry = item && available.get(key(item));
      if (!entry?.remaining) return canonical;
      entry.remaining--;
      ordered.push(unit(entry.line));
    }
    return ordered;
  }
  function planSets(lines, bundledItems, draftOrder) {
    const size = 4;
    const units = orderedPlanUnits(lines, draftOrder);
    const bundles = bundledItems.flatMap(item => Array.from({length: item.qty}, () => ({...item, qty: 1})));
    return Array.from({length: Math.ceil(units.length / size)}, (_, set) => {
      const rows = units.slice(set * size, (set + 1) * size).map(item => orderItem(item)).join('');
      const bundled = bundles[set] ? orderItem(bundles[set], true) : '';
      return `<section class="monthly-set" aria-labelledby="monthly-set-${set + 1}"><h3 id="monthly-set-${set + 1}">Set ${set + 1}</h3><ul class="monthly-summary-items">${rows}${bundled}</ul></section>`;
    }).join('');
  }
  function readDraftOrder() {
    try { return JSON.parse(sessionStorage.getItem('pure-monthly-builder-order')); }
    catch { return null; }
  }
  const threeDeliveryPlan = plan => Boolean(overview.builder_terms && plan?.snapshot.terms === overview.builder_terms);
  const hasUnfinishedTerm = () => overview.plans.some(plan => threeDeliveryPlan(plan) && !plan.can_restart);
  const methodLabel=m=>[m.label,m.network_label].filter(Boolean).join(' · ');
  const paymentOptions=(methods,selected)=>methods.map((m,i)=>'<label class="payment-option"><input type="radio" name="method" required value="'+esc(m.id)+'" '+((selected?m.id===selected:i===0)?'checked':'')+'>'+esc(methodLabel(m))+'</label>').join('');
  function renderPayment(data) {
    document.querySelector('main h1').textContent='Monthly invoice';
    root.innerHTML='<h2>'+esc(data.reference||'Invoice')+'</h2>'+line('Invoice total (USD)',money(data.total_cents),'total');
    if(data.closed) {root.insertAdjacentHTML('beforeend',link('/account/purchases?id='+encodeURIComponent(data.id),'View order'));return;}
    if(data.transfer){
      const t=data.transfer;
      root.insertAdjacentHTML('beforeend','<h2>Interac e-Transfer</h2>'+line('Send in CAD',new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',currencyDisplay:'code'}).format(t.amount_cents/100))+line('Payee',t.payee)+line('Reference',t.reference)+'<p class="transfer-instructions">'+esc(t.instructions)+'</p>');return;
    }
    if(data.payment_path){location.assign(data.payment_path);return;}
    const form=document.createElement('form');
    form.innerHTML='<fieldset><legend>Payment</legend>'+paymentOptions(data.methods)+'</fieldset><button type="submit">Continue</button>';
    root.append(form);
    form.onsubmit=async event=>{
      event.preventDefault();const btn=form.querySelector('button');btn.disabled=true;
      try{renderPayment(await api({action:'select_payment',id:data.id,total_cents:data.total_cents,method_id:new FormData(form).get('method')}));status.textContent='';}
      catch(e){status.textContent=e.message;btn.disabled=false;}
    };
  }
  async function loadPlans() {
    overview = await api();
    root.innerHTML = '<h2>Your subscription plans</h2>'+(overview.plans.length ? overview.plans.map(plan=>{
      const s=plan.snapshot,active=plan.status==='active';
      const threeDelivery=threeDeliveryPlan(plan);
      const action=(id,label)=>'<button type="button" class="secondary" data-action="'+id+'">'+label+'</button>';
      const actions=threeDelivery
        ? (plan.can_edit?action('edit','Change future selections'):'')+
          (plan.can_cancel?action('cancel','Cancel plan'):'')+
          (plan.status==='completed'&&!hasUnfinishedTerm()?link('/subscribe-and-save','Start another plan'):'')
        : (plan.status==='canceled'?'':action('edit','Change plan')+(active?action('skip','Skip next month')+action('pause','Pause'):action('resume','Resume'))+action('cancel','Cancel plan'));
      return '<article data-id="'+esc(plan.id)+'"><h2>'+esc(s.kind==='builder'?'Subscribe & Save':'Monthly product order')+' · '+esc(plan.status)+'</h2>'+
        '<p>'+esc(s.request.items.map(x=>x.qty+' × '+x.name+' '+x.size).join(', '))+'</p>'+line('Monthly total (USD)',money(s.total_cents))+
        (threeDelivery?line('Deliveries completed',plan.delivered_count+' of 3'):'')+
        (active&&plan.next_due_at?line('Next invoice',when(plan.next_due_at)):'')+(plan.pause_reason?'<p>'+esc(plan.pause_reason)+'</p>':'')+
        '<div class="actions">'+link('/account/purchases?id='+encodeURIComponent(plan.invoice_id),'Latest order')+
        actions+'</div>'+
        (threeDelivery&&plan.status!=='completed'&&plan.status!=='canceled'?'<p class="muted">For help with your plan or to request early cancellation, <a href="/contact">contact PURE support</a>.</p>':'')+'</article>';
    }).join(''):'<p>You have no subscription plans.</p>')+'<p><a href="/shop">Return to catalog</a></p>';
    root.onclick=async event=>{
      const btn=event.target.closest('button[data-action]');
      if (!btn) return;
      const plan = overview.plans.find(p=>p.id===btn.closest('article').dataset.id);
      const action=btn.dataset.action;
      if (action==='edit') {location.assign('/monthly-orders?edit='+encodeURIComponent(plan.id));return;}
      const labels={pause:'Pause future invoices?',resume:'Resume invoicing in one month?',skip:'Skip the next monthly invoice?',cancel:'Cancel all future invoices for this plan?'};
      if (!window.confirm(labels[action]+' Previously issued orders can be reviewed separately in your account.')) return;
      btn.disabled=true;
      try {await api({action,id:plan.id,version:plan.version});await loadPlans();status.textContent='Your plan has been updated.';}
      catch(error){status.textContent=error.message;btn.disabled=false;}
    };
  }
  function initialItems(plan) {
    if (plan) return plan.snapshot.request.items.map(({id,size,qty})=>({id,size,qty}));
    if (builderRoute) {
      try {return JSON.parse(sessionStorage.getItem('pure-monthly-builder')||'[]');} catch {return [];}
    }
    return [{id:params.get('product'),size:params.get('size'),qty:Number(params.get('qty')||1)}];
  }
  async function formView(plan) {
    const kind=plan?.snapshot.kind||(builderRoute?'builder':'product');
    const threeDelivery=kind==='builder'&&(!plan||threeDeliveryPlan(plan));
    if (threeDelivery&&!overview.builder_terms) {
      root.textContent='Monthly checkout is updating. Refresh and try again.';
      return;
    }
    if (!plan&&threeDelivery&&hasUnfinishedTerm()) {
      root.innerHTML='<p>Finish your current Subscribe &amp; Save plan before starting another.</p>'+link('/monthly-orders','View your plan');
      return;
    }
    let items=initialItems(plan);
    const draftOrder = builderRoute && !plan ? readDraftOrder() : null;
    if (!Array.isArray(items)||!items.length||items.some(i=>!catalog.some(p=>p.id===i.id && p.variants.some(v=>v.size===i.size)))) {
      root.innerHTML='<p>Choose your items to start a monthly order.</p>'+link(kind==='builder'?'/subscribe-and-save':'/shop','Choose items');return;
    }
    const previous=plan?.snapshot.request||{};
    const profile=user?.user_metadata?.alta_profile||{};
    const address=previous.address||profile.shipping||{};
    const countries=[...new Set(overview.methods.flatMap(m=>m.countries))].sort((a,b)=>displayCountry.of(a).localeCompare(displayCountry.of(b)));
    if(!countries.length){root.textContent='Monthly checkout is temporarily unavailable.';return;}
    const key='pure-repeat-enrollment-'+(user?.id||'guest')+'-'+kind+'-'+JSON.stringify(items.map(({id,size,qty})=>[id,size,qty]));
    const id=plan?.id||sessionStorage.getItem(key)||crypto.randomUUID();
    if(!plan) sessionStorage.setItem(key,id);
    const billing=previous.billing?.address||address;
    const title=plan?'Change your monthly plan':kind==='builder'?'Start your Subscribe & Save plan':'Start your monthly order';
    document.querySelector('main h1').textContent=title;
    const fields=(prefix,a,name)=>{
      const nameField=(label,n,v,auto,required=true)=>field(label,prefix+n,v,(prefix?'shipping ':'billing ')+auto,required);
      const country=countries.includes(a.country)?a.country:countries.includes('US')?'US':countries[0];
      return nameField('Full name','name',name,'name')+'<label>Country / region<select name="'+prefix+'country">'+countries.map(c=>'<option value="'+esc(c)+'" '+(c===country?'selected':'')+'>'+esc(displayCountry.of(c))+'</option>').join('')+'</select></label>'+
        nameField('Street address','line1',a.line1,'address-line1')+nameField('Apartment / suite (optional)','line2',a.line2,'address-line2',false)+
        nameField('City','city',a.city,'address-level2')+nameField('State / province','region',a.region,'address-level1')+nameField('ZIP / postal code','postal_code',a.postal_code,'postal-code');
    };
    root.innerHTML='<a class="monthly-back" href="'+(kind==='builder'?'/subscribe-and-save':'/shop')+'">← Back to '+(kind==='builder'?'Subscribe &amp; Save':'products')+'</a>'+
      '<form class="monthly-checkout-layout"><div class="monthly-details">'+
      (threeDelivery?'<section class="plan-card"><h2>Your delivery schedule</h2>'+deliveryTimeline+
        '<p>Pay each monthly invoice separately. Change future selections after the first shipment. You can start another plan after delivery three.</p></section>':'')+
      (plan?'<fieldset><legend>Edit selections</legend><div data-edit-items></div>'+(kind==='builder'?'<button type="button" class="secondary" data-add>Add an item</button>':'')+'</fieldset>':'')+
      '<fieldset><legend>Billing details</legend>'+ (user?'<p>'+esc(user.email)+'</p>':'')+'<div class="fields">'+fields('',billing,previous.billing?.name||previous.name||billing.name||user?.user_metadata?.full_name)+'</div></fieldset>'+
      '<label class="check"><input type="checkbox" name="separate" '+(previous.billing?'checked':'')+'>Ship to a different address</label>'+
      '<fieldset data-shipping><legend>Delivery address</legend><div class="fields">'+fields('ship_',address,previous.name||address.name)+'</div></fieldset></div>'+
      '<aside class="monthly-checkout-summary" aria-labelledby="monthly-summary-title"><div class="monthly-summary-heading"><h2 id="monthly-summary-title">Order summary</h2><span data-item-count></span></div>'+
      (Number.isSafeInteger(overview.protection_cents)?'<div class="protection"><label class="check"><input name="protection" type="checkbox" '+((plan?plan.snapshot.pricing.delivery.selection.extras.includes('protection'):true)?'checked':'')+'><span>Shipment protection</span><strong>'+esc(money(overview.protection_cents))+'</strong></label><a href="/shipping-protection.html" target="_blank" rel="noopener">Coverage details</a></div>':'')+
      '<div class="monthly-summary-plan" data-plan aria-label="Products in your monthly delivery"></div>'+
      '<div class="monthly-summary-pricing" data-review role="status"></div><fieldset><legend>Payment</legend><div data-methods></div></fieldset>'+
      (threeDelivery?'<p class="monthly-legal">Three monthly deliveries, paid one invoice at a time. Change future selections after your first delivery ships. The plan ends at delivery three. Any applicable fees are shown before payment. <a href="/commercial-terms.html#subscribe-and-save-plan" target="_blank" rel="noopener">Plan terms</a></p>':'')+
      '<label class="check"><input type="checkbox" data-agree required>'+(
        threeDelivery?'I agree to the three-delivery plan and its monthly invoices.':'I agree to receive a monthly invoice until I cancel.')+'</label>'+
      '<label class="check"><input type="checkbox" data-use required>I confirm laboratory research use and accept the <a href="/commercial-terms.html" target="_blank" rel="noopener">checkout terms</a>.</label>'+
      (user?'<button type="submit" data-confirm disabled>'+esc(plan?'Save changes':'Start my monthly plan')+'</button>':link('/account/login?returnTo='+encodeURIComponent(location.pathname+location.search),'Sign in to start my plan'))+
      '<p class="monthly-legal monthly-privacy">See how PURE handles your checkout information in the <a href="/privacy-policy.html" target="_blank" rel="noopener">privacy policy</a>.</p></aside></form>';
    const form=root.querySelector('form'), review=form.querySelector('[data-review]'), confirm=form.querySelector('[data-confirm]');
    const shipping=form.querySelector('[data-shipping]');
    const supplied=(data,prefix)=>Object.fromEntries(['line1','line2','city','region','postal_code','country'].map(n=>[n,data.get(prefix+n)]));
    const destination=()=>form.elements[form.elements.separate.checked?'ship_country':'country'].value;
    let revision=0,displayed=null,saving=false;
    async function refresh() {
      const current=++revision;displayed=null;
      shipping.disabled=shipping.hidden=!form.elements.separate.checked;
      const methods=overview.methods.filter(m=>m.countries.includes(destination()));
      const prev=form.querySelector('[name=method]:checked')?.value;
      form.querySelector('[data-methods]').innerHTML=paymentOptions(methods,methods.some(m=>m.id===prev)?prev:null);
      if(confirm)confirm.disabled=true;
      review.textContent='Calculating total…';
      try{
        const q=await api({action:'preview',kind,items,country:destination(),protection:!!form.elements.protection?.checked},true);
        if(current!==revision)return;
        const p=q.pricing;
        const giftValue = bundledValue(p.bundled_items);
        const count = p.lines.reduce((sum,item)=>sum+item.qty,0);
        form.querySelector('[data-item-count]').textContent=count===1?'1 item':count+' items';
        form.querySelector('[data-plan]').innerHTML=kind==='builder' ? planSets(p.lines,p.bundled_items,draftOrder) :
          '<ul class="monthly-summary-items">'+p.lines.map(item=>orderItem(item)).join('')+'</ul>';
        review.innerHTML=line('Retail value',money(p.subtotal_cents+giftValue),'retail-value')+
          line(kind==='builder'?'Monthly savings (40%)':'Monthly savings','−'+money(p.discount_cents),'monthly-savings')+
          (giftValue?line('Bundled reconstitution solution','−'+money(giftValue),'monthly-savings'):'')+
          line(p.delivery.selection.shipping==='express'?'Express shipping':'Economy shipping',p.delivery.shipping_cents?money(p.delivery.shipping_cents):'Free',p.delivery.shipping_cents?'':'monthly-savings')+
          (p.delivery.extras_cents?line('Shipment protection',money(p.delivery.extras_cents)):'')+line('Per month (USD)',money(q.total_cents),'total');
        displayed=q.total_cents;if(confirm)confirm.disabled=!methods.length;
      }catch(e){if(revision===current)review.textContent=e.message;}
    }
    if(plan) {
      const editor=form.querySelector('[data-edit-items]');
      function draw() {
        editor.innerHTML=items.map((item,i)=>{
          const product=catalog.find(p=>p.id===item.id);
          const opts=(rows,current)=>rows.map(([value,label])=>'<option value="'+esc(value)+'" '+(value===current?'selected':'')+'>'+esc(label)+'</option>').join('');
          return '<div class="item-edit" data-index="'+i+'"><label>Product<select data-prop="id">'+opts(catalog.map(p=>[p.id,p.name]),item.id)+'</select></label>'+
            '<label>Size<select data-prop="size">'+opts(product.variants.map(v=>[v.size,v.size]),item.size)+'</select></label>'+
            '<label>Quantity<input data-prop="qty" type="number" value="'+esc(item.qty)+'" min="1" max="60" required></label>'+
            (kind==='builder'?'<button type="button" class="secondary" data-remove>Remove</button>':'')+'</div>';
        }).join('');
      }
      editor.onchange=e=>{
        const prop=e.target.dataset.prop,row=items[Number(e.target.closest('[data-index]')?.dataset.index)];
        if(!row||!prop)return;
        row[prop]=prop==='qty'?Number(e.target.value):e.target.value;
        if(prop==='id'){row.size=catalog.find(p=>p.id===row.id).variants[0].size;draw();}
        refresh();
      };
      editor.onclick=e=>{if(e.target.hasAttribute('data-remove')){items.splice(Number(e.target.closest('[data-index]').dataset.index),1);draw();refresh();}};
      const add=form.querySelector('[data-add]');
      if(add)add.onclick=()=>{if(items.length>=60)return;const p=catalog[0];items.push({id:p.id,size:p.variants[0].size,qty:1});draw();refresh();};
      draw();
    }
    const draftKey='pure-checkout-contact-'+location.pathname+location.search;
    if(!user){
      form.querySelector('a[href^="/account/login"]').addEventListener('click',()=>{
        const values=Object.fromEntries(new FormData(form));
        try{sessionStorage.setItem(draftKey,JSON.stringify({values,separate:form.elements.separate.checked,protection:form.elements.protection?.checked}));}catch{}
      });
    }else{
      try{
        const stored=sessionStorage.getItem(draftKey);
        if(stored){
          const draft=JSON.parse(stored);sessionStorage.removeItem(draftKey);
          for(const [key,value] of Object.entries(draft.values||{})) {
            const el=form.elements.namedItem(key);
            if(el && (el.type==='text'||el.type==='select-one'))el.value=value;
          }
          form.elements.separate.checked=draft.separate===true;
          if(form.elements.protection)form.elements.protection.checked=draft.protection===true;
        }
      }catch{}
    }
    form.onchange=e=>{if(['separate','country','ship_country','protection'].includes(e.target.name))refresh();};
    form.onsubmit=async event=>{
      event.preventDefault();if(!user||saving||displayed===null||!form.reportValidity())return;
      const data=new FormData(form),sep=form.elements.separate.checked,prefix=sep?'ship_':'';
      const request={id,kind,items,...(plan?{version:plan.version}:{}),...(threeDelivery?{plan_terms:overview.builder_terms}:{}),name:data.get(prefix+'name'),address:supplied(data,prefix),method_id:data.get('method'),protection:!!form.elements.protection?.checked,
        ...(sep?{billing:{name:data.get('name'),address:supplied(data,'')}}:{})};
      const expected=displayed; saving=true;
      const controls=Array.from(form.elements).filter(el=>!el.disabled); controls.forEach(el=>el.disabled=true);
      status.textContent='Preparing your invoice…';
      try{
        const q=await api({...request,action:'quote'});
        if(threeDelivery&&q.terms!==overview.builder_terms)throw Error('Refresh checkout and review the current plan terms.');
        if(q.total_cents!==expected){controls.forEach(el=>el.disabled=false);await refresh();throw Error('Your total changed. Review it and submit again.');}
        const saved=await api({...request,action:plan?'change':'enroll',quote:q.quote,terms:q.terms,consent:true,research_use:true});
        if(!plan) sessionStorage.removeItem(key);
        if(!saved.invoice_id){location.assign('/monthly-orders');return;}
        const invoicePath='/monthly-orders?invoice='+encodeURIComponent(saved.invoice_id);
        history.replaceState(null,'',invoicePath);
        try{renderPayment(await api({action:'select_payment',id:saved.invoice_id,total_cents:expected,method_id:request.method_id}));status.textContent='';}
        catch{location.assign(invoicePath);}
      }catch(e){status.textContent=e.message;}
      finally{controls.forEach(el=>el.disabled=false);if(confirm)confirm.disabled=displayed===null;saving=false;}
    };
    await refresh();
  }
  try{
    const config=await fetch('/api/customer-config',{cache:'no-store'}).then(r=>r.json());
    if (!window.supabase||!config.supabaseUrl)throw Error('Customer accounts are temporarily unavailable.');
    auth=window.supabase.createClient(config.supabaseUrl,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,flowType:'pkce'}});
    const session=(await auth.auth.getSession()).data.session;
    if (!session && (!builderRoute&&!params.has('product')||params.has('edit')||params.has('invoice'))) {
      root.innerHTML='<p>Sign in to set up or manage your subscription.</p>'+link('/account/login?returnTo='+encodeURIComponent(location.pathname+location.search),'Sign in to PURE');return;
    }
    user=session?.user;
    if(params.has('invoice')){renderPayment(await api({action:'payment_options',id:params.get('invoice')}));return;}
    if (!builderRoute&&!params.has('product')&&!params.has('edit')) {await loadPlans();return;}
    overview=await api(null,!user);
    catalog=overview.catalog;
    const plan=params.has('edit')?overview.plans.find(p=>p.id===params.get('edit')&&p.status!=='canceled'):null;
    if(params.has('edit')&&!plan) throw Error('This plan is unavailable.');
    if(threeDeliveryPlan(plan)&&!plan.can_edit) {
      root.innerHTML='<p>You can edit future selections after your first shipment and before the final invoice.</p>'+link('/monthly-orders','View your plan');
      return;
    }
    await formView(plan);
  }catch(error){root.replaceChildren();status.textContent=error.message;}
  finally{root.removeAttribute('aria-busy');}
})();
