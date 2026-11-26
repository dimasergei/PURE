(()=>{
 'use strict';
 const path='/api/admin-orders',el=(tag,text)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;return x};
 const identity=o=>({id:o.id,source:o.source}),key=o=>o.source+':'+o.id;
 const money=(n,c)=>new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(n/100)+' '+c;
 const address=a=>[a?.name,a?.street1,a?.city,a?.state,a?.zip,a?.country].filter(Boolean).join(', ');
 let dialog;
 function close(){dialog?.close();dialog?.remove();dialog=null;}
 async function open({api,orders}){
  close();if(!orders.length||orders.length>10)throw Error('Select up to 10 orders for shipping labels.');
  const modal=dialog=el('dialog');modal.className='fh-dialog uc-dialog uc-batch-labels';modal.setAttribute('aria-labelledby','bulk-label-title');
  const header=el('div'),title=el('h2','Bulk shipping labels'),dismiss=el('button','Close');header.className='uc-dialog-head';title.id='bulk-label-title';dismiss.onclick=close;header.append(title,dismiss);
  const body=el('div'),notice=el('p','Checking shipping eligibility…');notice.setAttribute('role','status');body.append(notice);modal.append(header,body);document.body.append(modal);modal.showModal();
  const send=(action,data,blob=false)=>api(path,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data}),...(blob?{responseType:'blob'}:{})});
  const selected=new Map(orders.map(o=>[key(o),o])),name=r=>selected.get(key(r))?.order_number||r.id;
  const section=r=>{const x=el('section');x.className='uc-section';x.append(el('h3',name(r)));return x};
  const reset=message=>{body.replaceChildren(notice);notice.textContent=message};
  const fail=e=>{notice.textContent=e.message||'Shipping request could not be confirmed.'};
  function action(text,run){const b=el('button',text);b.type='button';b.onclick=async()=>{b.disabled=true;try{await run()}catch(e){fail(e)}finally{if(b.isConnected)b.disabled=false}};return b;}
  function saveFile(blob,filename){
   const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=filename;
   document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function labelLink(host,r,label,kind='label'){
   host.append(action(kind==='customs'?'Download customs invoice':'Download '+(label.test?'test ':'')+'label PDF',async()=>{
    const query=new URLSearchParams({view:'shipping-label-file',...identity(r),label_id:label.id,kind,download:'1'});
    saveFile(await api(path+'?'+query,{responseType:'blob'}),'pure-'+kind+'-'+name(r)+'.pdf');
   }));
  }
  function fileAction(files){return action('Download combined label PDF',async()=>{
   const blob=await send('shipping_label_bulk_file',{orders:files},true);
   saveFile(blob,'pure-shipping-labels.pdf');
  });}
  function showResults(rows){
   reset('Shipping label results');const files=[];
   for(const r of rows){const item=section(r),label=r.label;body.append(item);
    if(!r.ok||label?.status!=='created'){item.append(el('p',r.error||'Label not confirmed. Check the order before retrying.'));continue;}
    item.append(el('p',label.test?'Test label generated. It cannot be mailed.':'Label purchased. Mark the order shipped after dispatch.'));
    if(label.tracking_number)item.append(el('p','Tracking: '+label.tracking_number));
    if(label.has_label||label.label_url){labelLink(item,r,label);files.push({...identity(r),label_id:label.id});}
    if(label.has_customs||label.customs_url)labelLink(item,r,label,'customs');
   }
   if(files.length)body.append(fileAction(files));
  }
  function showQuotes(rows){
   reset('Choose the postage rate for each label you want to buy.');const controls=[];
   function getSelected(){return controls.flatMap(({r,rates,select})=>{const rate=rates.find(x=>x.id===select.value);return rate?[{...identity(r),label_id:r.label.id,rate_id:rate.id,amount_cents:rate.amount_cents,currency:rate.currency,test:r.test_mode===true}]:[]});}
   const totals=list=>{const out={};for(const rate of list)out[rate.currency]=(out[rate.currency]||0)+rate.amount_cents;return out};
   const totalText=list=>Object.entries(totals(list)).map(([c,n])=>money(n,c)).join(' + ');
   const buy=action('Buy selected labels',async()=>{
    const list=getSelected();if(!list.length)return;const testMode=list[0].test;
    if(list.some(r=>r.test!==testMode))throw Error('Generate test labels and buy live postage in separate batches.');
    if(!window.confirm(testMode?`Generate ${list.length} test label(s)? They are not valid postage.`:`Buy ${list.length} shipping label(s) for ${totalText(list)}? Your shipping account will be charged.`))return;
    reset('Waiting for carrier confirmation…');
    try{const r=await send('shipping_label_bulk_buy',{orders:list.map(({test,...rate})=>rate),totals:totals(list),test_mode:testMode,confirm_purchase:true});if(dialog===modal)showResults(r.results||[]);}
    catch(e){fail(Error((e.message||'Purchase response could not be confirmed.')+' Check saved labels before retrying.'));}
   });
   const total=el('p');function update(){const list=getSelected();total.textContent=list.length?list.length+' selected · '+totalText(list):'No rates selected.';buy.disabled=!list.length;buy.textContent=list.length&&list.every(r=>r.test)?'Generate selected test labels':'Buy selected labels';}
   for(const r of rows){const item=section(r);body.append(item);if(!r.ok){item.append(el('p',r.error));continue;}const label=r.label,select=el('select'),empty=el('option','Skip this order');empty.value='';select.append(empty);select.setAttribute('aria-label','Postage rate for '+name(r));
    const rates=(label.rates||[]).filter(x=>Number.isSafeInteger(x.amount_cents)&&['USD','CAD'].includes(x.currency));
    for(const rate of rates){const opt=el('option',`${rate.carrier} · ${rate.service} · ${money(rate.amount_cents,rate.currency)}`);opt.value=rate.id;select.append(opt);}
    select.disabled=r.purchase_enabled!==true||!rates.length;select.onchange=update;
    item.append(el('p','Ship from: '+address(label.sender)),el('p','Ship to: '+address(label.recipient)));
    if(label.parcel){const p=label.parcel;item.append(el('p',`${p.length} × ${p.width} × ${p.height} ${p.distance_unit} · ${p.weight} ${p.mass_unit}`));}
    for(const warning of label.warnings||[])item.append(el('p',warning));
    if(r.test_mode)item.append(el('p','Test mode. Labels are not valid postage.'));
    if(select.disabled)item.append(el('p',rates.length?'Purchases are disabled for this order.':'No supported rates are available.'));
    item.append(select);controls.push({r,rates,select});
   }
   body.append(total,buy);update();
  }
  try{
   const r=await send('shipping_label_bulk_state',{orders:orders.map(identity)});if(dialog!==modal)return;
   reset('Confirm the parcel dimensions and enter each measured packed weight.');
   const form=el('form'),editors=[],files=[];body.append(form);
   function field(host,title,value,options){const label=el('label',title),input=el(options?'select':'input');
    if(options){for(const unit of options){const opt=el('option',unit);opt.value=unit;input.append(opt);}}
    else{input.type='number';input.min='0.0001';input.step='any';input.required=true;}
    input.value=value??'';label.append(input);host.append(label);return input;
   }
   for(const row of r.results||[]){const item=section(row);form.append(item);if(!row.ok){item.append(el('p',row.error));continue;}
    const state=row.state,labels=state.labels||[],prior=labels.find(x=>x.status==='created'&&x.test===state.test_mode&&(x.has_label||x.label_url));
    if(prior){item.append(el('p','An existing label is available.'));labelLink(item,row,prior);files.push({...identity(row),label_id:prior.id});continue;}
    const sender=state.shipping_preferences?.sender;
    if(!state.configured||!state.eligible||!state.payment_confirmed||!sender||!state.recipient||labels.some(x=>x.test===state.test_mode&&['review','purchasing'].includes(x.status))){item.append(el('p',state.purchase_reason||state.configuration_error||state.reason||'Open the order to finish shipping setup or review its existing label.'));continue;}
    const international=sender.country!==state.recipient.country,customs=international?state.draft?.customs:undefined;
    if(international&&!customs){item.append(el('p','Complete this order’s customs declaration in its shipping panel first.'));continue;}
    const fields=el('div');fields.className='uc-batch-parcel';const p={...(state.is_bulk?{}:state.shipping_preferences?.package_defaults),...state.draft?.parcel};
    item.append(el('p','Ship from: '+address(sender)),el('p','Ship to: '+address(state.recipient)),fields);
    editors.push({row,customs,fields:{length:field(fields,'Length',p.length),width:field(fields,'Width',p.width),height:field(fields,'Height',p.height),weight:field(fields,'Packed weight',''),distance_unit:field(fields,'Dimension unit',p.distance_unit||'in',['in','cm','mm']),mass_unit:field(fields,'Weight unit',p.mass_unit||'oz',['oz','lb','g','kg'])}});
   }
   if(files.length)body.append(fileAction(files));
   if(editors.length){const quote=el('button','Get batch rates');quote.type='submit';form.append(quote);form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;quote.disabled=true;
    try{const response=await send('shipping_label_bulk_quote',{orders:editors.map(({row,fields,customs})=>({...identity(row),parcel:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])),...(customs?{customs}:{})}))});if(dialog===modal)showQuotes(response.results||[]);}
    catch(error){fail(error)}finally{if(quote.isConnected)quote.disabled=false;}
   };}
  }catch(error){fail(error);}
 }
 window.PureBulkLabels={open,close};
})();
