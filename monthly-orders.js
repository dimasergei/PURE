(async () => {
  'use strict';
  const root = document.getElementById('monthly-content');
  const status = document.getElementById('monthly-status');
  const params = new URLSearchParams(location.search);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
  const when = value => new Date(value).toLocaleDateString(undefined,{dateStyle:'medium'});
  const displayCountry = new Intl.DisplayNames(['en'],{type:'region'});
  const link = (href,label) => '<a class="button" href="'+esc(href)+'">'+esc(label)+'</a>';
  const field = (label,name,value,autocomplete,required=true) => '<label>'+esc(label)+'<input name="'+name+'" autocomplete="'+autocomplete+'" value="'+esc(value)+'" '+(required?'required':'')+'></label>';
  let auth, overview, catalog, user;
  const api = async body => {
    const session = (await auth.auth.getSession()).data.session;
    if (!session) throw Error('Your session expired. Sign in and return to this page.');
    const response = await fetch('/api/customer-config?repeat_orders=1',{method:body?'POST':'GET',cache:'no-store',
      headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Monthly orders are temporarily unavailable.');
    return data;
  };
  const line = (name,value,cls='') => '<div class="line '+cls+'"><span>'+esc(name)+'</span><span>'+esc(value)+'</span></div>';
  function summary(pricing,total) {
    return '<div class="summary"><h2>Monthly invoice</h2>'+pricing.lines.map(row=>line(row.qty+' × '+row.name+' '+row.size,money(row.line_total_cents))).join('')+
      (pricing.bundled_items||[]).map(row=>line(row.qty+' × '+row.name+' '+row.size,'Included')).join('')+
      line('Retail subtotal',money(pricing.subtotal_cents))+line('Monthly savings','−'+money(pricing.discount_cents))+
      line(pricing.delivery.selection.shipping==='express'?'Express shipping':'Economy shipping',money(pricing.delivery.shipping_cents))+
      line('Monthly total (USD)',money(total),'total')+'</div>';
  }
  async function loadPlans() {
    overview = await api();
    root.innerHTML = '<h2>Your invoice plans</h2>'+(overview.plans.length ? overview.plans.map(plan=>{
      const s=plan.snapshot,active=plan.status==='active';
      const action=(id,label)=>'<button type="button" class="secondary" data-action="'+id+'">'+label+'</button>';
      return '<article data-id="'+esc(plan.id)+'"><h2>'+esc(s.kind==='builder'?'Monthly builder':'Monthly product order')+' · '+esc(plan.status)+'</h2>'+
        '<p>'+esc(s.request.items.map(x=>x.qty+' × '+x.name+' '+x.size).join(', '))+'</p>'+line('Monthly total (USD)',money(s.total_cents))+
        (active?line('Next invoice',when(plan.next_due_at)):'')+(plan.pause_reason?'<p>'+esc(plan.pause_reason)+'</p>':'')+
        '<div class="actions">'+link('/account/purchases?id='+encodeURIComponent(plan.invoice_id),'Latest order')+
        (plan.status==='canceled'?'':action('edit','Change plan')+(active?action('skip','Skip next month')+action('pause','Pause'):action('resume','Resume'))+action('cancel','Cancel plan'))+'</div></article>';
    }).join(''):'<p>You have no monthly invoice plans.</p>')+'<p><a href="/shop">Return to catalog</a></p>';
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
    if (params.has('builder')) {
      try {return JSON.parse(sessionStorage.getItem('pure-monthly-builder')||'[]');} catch {return [];}
    }
    return [{id:params.get('product'),size:params.get('size'),qty:Number(params.get('qty')||1)}];
  }
  function formView(plan) {
    const kind=plan?.snapshot.kind||(params.has('builder')?'builder':'product');
    let items=initialItems(plan);
    if (!Array.isArray(items)||!items.length||items.some(i=>!catalog.some(p=>p.id===i.id && p.variants.some(v=>v.size===i.size)))) {
      root.innerHTML='<p>Choose your items to start a monthly order.</p>'+link(kind==='builder'?'/research-builder':'/shop','Choose items');return;
    }
    const previous=plan?.snapshot.request||{};
    const profile=user.user_metadata?.alta_profile||{};
    const address=previous.address||profile.shipping||{};
    const countries=[...new Set(overview.methods.flatMap(m=>m.countries))].sort((a,b)=>displayCountry.of(a).localeCompare(displayCountry.of(b)));
    if (!countries.length) {root.textContent='No monthly payment methods are currently available.';return;}
    const key='pure-repeat-enrollment-'+user.id+'-'+kind+'-'+JSON.stringify(items.map(({id,size,qty})=>[id,size,qty]));
    const id=plan?.id||sessionStorage.getItem(key)||crypto.randomUUID();
    if (!plan) sessionStorage.setItem(key,id);
    root.innerHTML='<a href="/monthly-orders">Your monthly orders</a><h2>'+esc(plan?'Change future invoices':kind==='builder'?'Start your monthly builder':'Start your monthly order')+'</h2>'+
      '<p>You receive a payment link every month. Each order ships after you pay. Skip, pause, change or cancel future invoices in your account.</p>'+
      '<form><fieldset><legend>Items</legend><div data-items></div>'+(kind==='builder'?'<button class="secondary" type="button" data-add>Add an item</button>':'')+'</fieldset>'+
      '<fieldset><legend>Delivery</legend><div class="fields">'+field('Full name','name',previous.name||address.name||user.user_metadata?.full_name,'name')+
      field('Street address','line1',address.line1,'address-line1')+field('Apartment / suite (optional)','line2',address.line2,'address-line2',false)+
      field('City','city',address.city,'address-level2')+field('State / province / region','region',address.region,'address-level1')+
      field('ZIP / postal code','postal_code',address.postal_code,'postal-code')+'<label>Country<select name="country">'+countries.map(c=>'<option value="'+esc(c)+'">'+esc(displayCountry.of(c))+'</option>').join('')+'</select></label></div></fieldset>'+
      '<label>Invoice payment method<select class="method" name="method" required></select></label>'+
      '<p class="muted">Pay each invoice in USD. Your payment provider may show fees or currency conversion before payment.</p>'+
      '<button type="submit">Review monthly total</button><div data-review></div></form>';
    const form=root.querySelector('form'),list=form.querySelector('[data-items]'),review=form.querySelector('[data-review]');
    form.elements.country.value=countries.includes(address.country)?address.country:countries.includes('US')?'US':countries[0];
    const products=catalog.filter(p=>p.category==='injectables'&&p.variants.length);
    function drawItems(){
      list.innerHTML=items.map((item,i)=>{
        const product=products.find(p=>p.id===item.id);
        return '<div class="item-edit" data-index="'+i+'"><label>Product<select data-property="id">'+products.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===item.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><label>Size<select data-property="size">'+product.variants.map(v=>'<option value="'+esc(v.size)+'" '+(v.size===item.size?'selected':'')+'>'+esc(v.size)+'</option>').join('')+'</select></label><label>Quantity<input data-property="qty" type="number" min="1" max="60" required value="'+esc(item.qty)+'"></label>'+
        (kind==='builder'?'<button type="button" data-remove class="secondary">Remove</button>':'')+'</div>';
      }).join('');
    }
    function methods(){
      const country=form.elements.country.value;
      form.elements.method.innerHTML=overview.methods.filter(m=>m.countries.includes(country)).map(m=>'<option value="'+esc(m.id)+'">'+esc([m.label,m.network_label].filter(Boolean).join(' · '))+'</option>').join('');
      if (plan && [...form.elements.method.options].some(o=>o.value===plan.snapshot.method_id)) form.elements.method.value=plan.snapshot.method_id;
    }
    drawItems();methods();
    list.onchange=event=>{
      const i=Number(event.target.closest('[data-index]')?.dataset.index),prop=event.target.dataset.property;
      if (!prop||!items[i])return;
      items[i][prop]=prop==='qty'?Number(event.target.value):event.target.value;
      if(prop==='id'){items[i].size=products.find(p=>p.id===items[i].id).variants[0].size;drawItems();}
    };
    list.onclick=event=>{
      if (event.target.hasAttribute('data-remove')){items.splice(Number(event.target.closest('[data-index]').dataset.index),1);drawItems();invalidate();}
    };
    const add=form.querySelector('[data-add]');
    if(add)add.onclick=()=>{if(items.length>=60)return;const p=products.find(p=>!items.some(x=>x.id===p.id))||products[0];items.push({id:p.id,size:p.variants[0].size,qty:1});drawItems();invalidate();};
    form.elements.country.onchange=methods;
    let revision=0;
    function invalidate(){revision++;review.replaceChildren();status.textContent='';}
    form.addEventListener('input', e=>{if(!review.contains(e.target))invalidate();});
    form.addEventListener('change', e=>{if(!review.contains(e.target))invalidate();});
    form.onsubmit=async event=>{
      event.preventDefault();const revisionAtRequest=revision;
      const data=Object.fromEntries(new FormData(form));
      const request={id,kind,items:items.map(x=>({...x})),name:data.name,
        address:{line1:data.line1,line2:data.line2,city:data.city,region:data.region,postal_code:data.postal_code,country:data.country},method_id:data.method};
      const submit=form.querySelector('[type=submit]');submit.disabled=true;status.textContent='Checking your total…';
      try {
        const q=await api({...request,action:'quote'});
        if(revisionAtRequest!==revision)return;
        review.innerHTML=summary(q.pricing,q.total_cents)+'<p>'+esc(plan?'Changes apply to future invoices.':'The first invoice is issued today, followed by one each month.')+'</p>'+
          '<label class="check"><input type="checkbox" data-agree>I agree to receive monthly invoices for '+esc(money(q.total_cents))+' USD until I cancel. I authorize a separate invoice for each order and will pay it separately.</label>'+
          '<label class="check"><input type="checkbox" data-use>I confirm laboratory research use and agree to the <a href="/terms-and-conditions.html" target="_blank" rel="noopener">store terms</a>.</label><button type="button" data-confirm>'+esc(plan?'Save changes':'Start monthly invoices')+'</button>';
        status.textContent='';review.scrollIntoView({block:'nearest'});
        const confirm=review.querySelector('[data-confirm]');
        confirm.onclick=async()=>{
          if(!review.querySelector('[data-agree]').checked||!review.querySelector('[data-use]').checked){status.textContent='Review and select both confirmations to continue.';return;}
          Array.from(form.elements).forEach(el=>el.disabled=true);status.textContent='Saving your plan…';
          try {const saved=await api({...request,action:plan?'change':'enroll',version:plan?.version,quote:q.quote,terms:q.terms,consent:true,research_use:true});
            if(!plan)sessionStorage.removeItem(key);
            location.assign(saved.invoice_id?'/account/purchases?id='+encodeURIComponent(saved.invoice_id):'/monthly-orders');
          }catch(error){Array.from(form.elements).forEach(el=>el.disabled=false);status.textContent=error.message;}
        };
      }catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
    };
  }
  try{
    const config=await fetch('/api/customer-config',{cache:'no-store'}).then(r=>r.json());
    if (!window.supabase||!config.supabaseUrl)throw Error('Customer accounts are temporarily unavailable.');
    auth=window.supabase.createClient(config.supabaseUrl,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,flowType:'pkce'}});
    const session=(await auth.auth.getSession()).data.session;
    if (!session) {
      root.innerHTML='<p>Sign in to set up or manage your monthly invoice plan.</p>'+link('/account/login?returnTo='+encodeURIComponent(location.pathname+location.search),'Sign in to PURE');return;
    }
    user=session.user;
    if (!params.has('builder')&&!params.has('product')&&!params.has('edit')) {await loadPlans();return;}
    overview=await api();
    catalog=overview.catalog;
    const plan=params.has('edit')?overview.plans.find(p=>p.id===params.get('edit')&&p.status!=='canceled'):null;
    if(params.has('edit')&&!plan) throw Error('This plan is unavailable.');
    formView(plan);
  }catch(error){root.replaceChildren();status.textContent=error.message;}
  finally{root.removeAttribute('aria-busy');}
})();
