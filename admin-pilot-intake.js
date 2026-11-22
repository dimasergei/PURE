(() => {
 'use strict';
 const endpoint='/api/admin-suppliers';
 const skus=new Map([['tirzepatide-40mg','Tirzepatide 40 mg'],['bac-3-3-ml','Recon solution 3 mL']]);
 const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
 const storageKey='pure-received-pilot-lot';
 let dialog;
 function node(tag,text,cls){
  const element=document.createElement(tag);
  if(text!=null)element.textContent=text;
  if(cls)element.className=cls;
  return element;
 }
 function field(parent,caption,control,name){
  const label=node('label',caption,'uc-input-field');
  control.name=name;control.required=true;label.append(control);parent.append(label);return control;
 }
 function input(parent,caption,name,max){
  const control=field(parent,caption,node('input'),name);control.maxLength=max;return control;
 }
 function options(parent,caption,name,rows){
  const control=field(parent,caption,node('select'),name);
  for(const [value,label] of rows){const option=node('option',label);option.value=value;control.append(option);}
  return control;
 }
 function button(text,primary=false){
  const result=node('button',text,primary?'primary':'ghost');result.type='button';return result;
 }
 function remembered(){
  try{return sessionStorage.getItem(storageKey)||'';}catch{return '';}
 }
 function remember(id){
  try{sessionStorage.setItem(storageKey,id);}catch{}
 }
 function close(){dialog?.close();dialog?.remove();dialog=null;}
 function open(api){
  if(dialog?.open){dialog.focus();return;}
  close();
  const box=node('dialog',null,'fh-dialog uc-dialog uc-pilot-intake');dialog=box;
  box.setAttribute('aria-labelledby','uc-pilot-receive-title');
  const title=node('h2','Receive pilot stock');title.id='uc-pilot-receive-title';
  const header=node('div',null,'uc-dialog-head'),cancel=button('Close');cancel.onclick=close;
  header.append(title,cancel);
  const status=node('p','','uc-message');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const panel=node('div');
  box.append(header,status,panel);document.body.append(box);box.showModal();
  let suppliers=[],lots=[],documents=[],busy=false;
  const post=body=>api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const message=(text,bad=false)=>{status.textContent=text;status.classList.toggle('failed',bad);};
  const storeLot=lot=>{lots=[lot,...lots.filter(x=>x.id!==lot.id)];remember(lot.id);};
  const lotLabel=lot=>[skus.get(lot.sku_key),lot.lot_number,lot.fulfillment_site,lot.status].filter(Boolean).join(' · ');
  function bind(form,action,label){
   const submit=button(label,true);submit.type='submit';form.append(submit);
   form.onsubmit=async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;
    busy=true;submit.disabled=true;message('');
    try{await action();}catch(error){message(error.message||'Could not save. Please retry.',true);}
    finally{busy=false;submit.disabled=false;}
   };
  }
  function render(selectedId=''){
   panel.replaceChildren();
   const picker=options(panel,'Receipt','receipt', [['','Receive a new lot'],...lots.map(l=>[l.id,lotLabel(l)])]);
   picker.value=lots.some(l=>l.id===selectedId)?selectedId:'';
   const body=node('div');panel.append(body);
   function show(){
    body.replaceChildren();
    const lot=lots.find(l=>l.id===picker.value);
    if(!lot){receive(body);return;}
    remember(lot.id);
    const reports=documents.filter(r=>r.lot_id===lot.id);
    const reportsBox=node('section',null,'uc-intake-record');
    reportsBox.append(node('h4','Received lot'),node('p',lotLabel(lot),'uc-hint'));
    for(const report of reports)
     reportsBox.append(node('p',report.report_id+' · '+report.lab_name+' · '+report.status,'uc-hint'));
    body.append(reportsBox);
    const form=node('form',null,'uc-action-form');
    form.append(node('h4','Attach a lab report'));
    const reportId=input(form,'Report number','report_id',120),lab=input(form,'Issuing lab','lab_name',180);
    reportId.minLength=2;lab.minLength=2;
    const url=input(form,'Lab verification URL','source_url',450);url.type='url';url.placeholder='https://';url.pattern='https://.+';
    form.append(node('p','A reviewer verifies the report and releases the lot separately.','uc-hint'));
    bind(form,async()=>{
     const result=await post({action:'intake_supplier_coa_reference',report:{lot_id:lot.id,report_id:reportId.value.trim(),lab_name:lab.value.trim(),source_url:url.value.trim()}});
     if(!result.saved||!result.report)throw Error('The report was not saved. The received lot is still recorded.');
     documents=[...documents,{...result.report,lab_name:lab.value.trim()}];
     render(lot.id);message('Report attached. Awaiting human review.');
    },'Submit report for review');
    body.append(form);
   }
   picker.onchange=()=>{message('');show();};show();
  }
  function receive(host){
   const form=node('form',null,'uc-action-form');form.append(node('h4','Stock receipt'));
   const grid=node('div',null,'uc-pilot-inputs');form.append(grid);
   const sku=options(grid,'Item received','sku_key',[['','Select item'],...skus]);
   const supplier=options(grid,'Supplier on receipt','supplier_id',[['','Select supplier'],...suppliers.map(s=>[s.id,s.name]),['new','Add confirmed supplier…']]);
   const newName=input(grid,'Supplier name on invoice','new_supplier_name',120);
   function supplierMode(){newName.parentElement.hidden=supplier.value!=='new';newName.disabled=supplier.value!=='new';}
   supplierMode();supplier.onchange=supplierMode;
   const printedLot=input(grid,'Printed lot number','lot_number',120);
   const units=input(grid,'Vials received','on_hand',7);units.type='number';units.step='1';units.min='1';units.max='1000000';units.inputMode='numeric';
   const site=input(grid,'US receiving location','fulfillment_site',120);
   const reference=input(grid,'Packing slip or invoice reference','supplier_evidence_reference',200);
   const label=node('label',null,'uc-check'),yes=node('input');yes.name='confirm_receipt';yes.type='checkbox';yes.required=true;
   label.append(yes,node('span','I checked the physical vials against the receipt, including the item, strength or volume, lot and quantity.'));form.append(label);
   bind(form,async()=>{
    let supplierId=supplier.value;
    if(supplierId==='new'){
     const name=newName.value.trim();
     const match=suppliers.find(s=>s.name.toLowerCase()===name.toLowerCase());
     let record=match;
     if(!record){
      const result=await post({name});record=result.supplier;
      if(!uuid.test(record?.id||'')||!record.active)throw Error('Supplier could not be confirmed. Review the active supplier records.');
      suppliers.push(record);
     }
     const option=node('option',record.name);option.value=record.id;supplier.add(option);supplier.value=record.id;supplierMode();
     supplierId=record.id;
    }
    const row={supplier_id:supplierId,sku_key:sku.value,lot_number:printedLot.value.trim(),fulfillment_site:site.value.trim(),on_hand:Number(units.value),
     supplier_evidence_reference:reference.value.trim(),composition_confirmed:yes.checked,strength_confirmed:yes.checked};
    if(!yes.checked||!skus.has(row.sku_key)||!uuid.test(supplierId)||!row.lot_number||!row.fulfillment_site||!row.supplier_evidence_reference)throw Error('Confirm the physical shipment and complete each receipt field.');
    const duplicate=lots.find(l=>l.supplier_id===row.supplier_id&&l.sku_key===row.sku_key&&l.lot_number===row.lot_number&&l.fulfillment_site===row.fulfillment_site);
    if(duplicate){render(duplicate.id);message('This lot already has a receipt. Review its reports below.');return;}
    const result=await post({action:'commit_inventory_intake',rows:[row],confirm_quarantine_only:true});
    if(!result.saved||!uuid.test(result.lot?.id||'')||result.lot.status!=='quarantine')throw Error('No confirmed receipt was returned. Reload the recorded lots before retrying.');
    const lot={...row,...result.lot};storeLot(lot);render(lot.id);message('Stock received in quarantine. Attach its lab report below.');
   },'Receive into quarantine');
   host.append(form);
  }
  async function load(){
   panel.replaceChildren();message('Loading receipts…');
   try{
    const [directory,inventory]=await Promise.all([api(endpoint),api(endpoint+'?inventory=1')]);
    if(dialog!==box)return;
    if(!Array.isArray(directory.suppliers)||!Array.isArray(inventory.lots)||!Array.isArray(inventory.quality_reports))throw Error('Receipt records unavailable.');
    suppliers=directory.suppliers.filter(s=>s.active===true&&uuid.test(s.id));
    lots=inventory.lots.filter(l=>skus.has(l.sku_key)&&uuid.test(l.id));
    documents=inventory.quality_reports;
    render(remembered());message('');
   }catch{message('Could not load the supplier and lot records.',true);const retry=button('Retry');retry.onclick=load;panel.replaceChildren(retry);}
  }
  load();
 }
 window.PurePilotIntake={open,close};
})();
