(()=>{'use strict';
const el=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(cls)x.className=cls;return x};
const cash=(n,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format((Number(n)||0)/100);
const ref=o=>o.order_number||'AP'+String(o.id).replace(/-/g,'').slice(0,10).toUpperCase();
const type=o=>o.source==='research_subscription'?'Research subscription':o.kind==='membership'?'Membership purchase':o.kind==='bulk'?'Bulk order':o.origin==='research_builder'?'Research Builder product order':o.source==='store'?'Earlier store order':'Product order';
const state=s=>({queued:'Queued',retry:'Retry scheduled',working:'Processing',submitted:'Submitted',blocked:'Needs attention',ordered:'Fulfillment started',accepted:'Awaiting payment',requested:'Pending review',issued:'Payment pending',paid:'Paid',processing:'Processing',awaiting_supplier:'Awaiting fulfillment',unfulfilled:'Unfulfilled',pending:'Pending payment',pending_payment:'Pending payment',active:'Active',past_due:'Past due',cancel_pending:'Cancellation pending',canceled:'Canceled',shipped:'Shipped',delivered:'Delivered',refunded:'Refunded',void:'Canceled'}[s]||String(s||'Pending'));
const orderState=(o,fallback)=>o.cancellation_status==='pending'?'Cancellation pending':o.cancellation_status==='review'?'Cancellation needs payment review':state(fallback||o.status);
const interacRequest=o=>(o.status||o.commerce_status)==='requested'&&o.request_data?.preferred_payment?.provider_key==='interac';
const requestEstimate=o=>o.request_data?.checkout?.usd_estimate;
const priorityOrder=o=>o.source==='commerce'&&['goods','bulk'].includes(o.kind)&&o.priority_fulfillment===true&&typeof o.membership_invoice_id==='string'
 &&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(o.membership_invoice_id)&&['paid','processing'].includes(o.commerce_status||o.status)&&!o.cancellation_requested_at&&!o.cancellation_status;
const priorityBadge=()=>el('span','PURE BLACK / Priority','uc-priority-badge');
let api,root,dlg,orders=[],paging={},page=1,query='',sort='fulfillment_priority',filter='all',archiveView='current',epoch=0,detailVersion=0,poll,timer;
const chosen=new Map(),selectionLimit=25;
const selectable=o=>['commerce','store'].includes(o.source);
const orderKey=o=>o.source+':'+o.id;
const identity=o=>({source:o.source,id:o.id});
const physical=o=>selectable(o)&&o.kind!=='membership';
const lotus=(view,more='')=>'/api/customer-config?lotus=admin&view='+view+more;
const send=(url,body,method='POST')=>api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const write=b=>send(lotus('write'),b);
let orderSession=null,pendingOpenVersion=0;
function showNotice(host,text,bad=false){
 const notice=host?.querySelector('[data-unified-message]');
 if(notice){notice.textContent=text;notice.classList.toggle('failed',bad)}
}
function msg(text,bad=false){showNotice(root,text,bad)}
function controlFeedback(control){
 return control.closest('.uc-order-editor')?orderSession.notice:msg;
}
function btn(text,action,cls='ghost'){
 const x=el('button',text,cls);
 x.type='button';
 x.onclick=async()=>{
  const notify=controlFeedback(x);
  x.disabled=true;
  try{await action()}catch(e){notify(e.message,true)}finally{x.disabled=false}
 };
 return x;
}
function field(k,v){const x=el('div',undefined,'uc-field');x.append(el('span',k),el('strong',v===undefined||v===null||v===''?'—':v));return x}
function input(f,title,name,value='',required=false){const label=el('label',title,'uc-input-field'),x=el('input');x.name=name;x.value=value??'';x.required=required;label.append(x);f.append(label);return x}
function select(f,title,name,options,value){const label=el('label',title,'uc-input-field'),x=el('select');x.name=name;for(const [key,text]of options){const o=el('option',text);o.value=key;x.append(o)}if(value!==undefined)x.value=value;label.append(x);f.append(label);return x}
function form(title,host){const f=el('form',undefined,'uc-action-form');f.append(el('h4',title));host.append(f);return f}
function submit(f,text,action){const x=el('button',text,'primary');x.type='submit';f.append(x);f.onsubmit=async ev=>{ev.preventDefault();const notify=controlFeedback(f);x.disabled=true;try{await action()}catch(e){notify(e.message,true)}finally{x.disabled=false}}}
const when=t=>t?new Date(t).toLocaleString():'—';
const address=a=>[a?.line1,a?.line2,[a?.city,a?.region||a?.state,a?.postal_code].filter(Boolean).join(', '),a?.country].filter(Boolean).join(' · ');
function close() {
 window.PureBulkLabels?.close();
 epoch++;
 detailVersion++;
 pendingOpenVersion=0;
 clearInterval(poll);
 clearTimeout(timer);
 poll = timer = null;
 if (dlg?.open) dlg.close();
 dlg?.remove();
 dlg = orderSession = null;
 root?.replaceChildren();
 const count = document.getElementById('orders-message');
 if (count) count.textContent = '';
 root = api = null;
 orders = [];
 paging = {};
 chosen.clear();
 page = 1;
 query = '';
 sort = 'fulfillment_priority';
 filter = 'all';
 archiveView = 'current';
}
function toggleOrder(order,selected){
 const key=orderKey(order);
 if(selected&&!chosen.has(key)&&chosen.size>=selectionLimit){msg('Select up to '+selectionLimit+' orders at a time.',true);return false;}
 if(selected)chosen.set(key,order);else chosen.delete(key);
 return true;
}
const selectedOrders=()=>[...chosen.values()];
async function archiveSelected(){
 const restoring=archiveView==='archived',action=restoring?'unarchive':'archive';
 const candidates=selectedOrders().filter(o=>restoring?o.archived:o.archive_eligible);
 if(!candidates.length||!window.confirm((restoring?'Restore ':'Archive ')+candidates.length+' selected order(s)?'))return;
 const result=await send('/api/admin-orders',{action,orders:candidates.map(identity)},'PATCH');
 for(const order of result.orders||[])chosen.delete(orderKey(order));
 page=1;await load();
 const reasons={not_closed:'Order still open.',not_found:'Order no longer available.',already_archived:'Order already archived.',already_active:'Order already active.'};
 const skipped=(result.skipped||[]).map(s=>reasons[s.reason]||s.reason).filter(Boolean);
 msg((result.updated||0)+' order(s) '+(restoring?'restored.':'archived.')+(skipped.length?' '+skipped.length+' skipped: '+skipped.join(' '):''),skipped.length>0);
}
function downloadBlob(file,name){
 const url=URL.createObjectURL(file),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadSelectedSheet(format){
 const records=selectedOrders();
 if(!records.length||records.some(o=>!physical(o)||o.archived))return;
 const params=new URLSearchParams({view:'bulk-fulfillment-sheet',orders:records.map(orderKey).join(','),format});
 const file=await api('/api/admin-orders?'+params,{responseType:'blob'});
 downloadBlob(file,'fulfillment-selected-orders.'+format);
 msg('Supplier fulfillment sheet downloaded.');
}
function selectionBar(){
 const host=root?.querySelector('[data-order-selection]');if(!host)return;
 const restoreFocus = host.contains(document.activeElement);
 host.replaceChildren();
 if (!orders.length && !chosen.size) return;
 const visible=orders.filter(selectable),items=selectedOrders(),restoring=archiveView==='archived';
 const label=el('label',undefined,'uc-select-page'),all=el('input');all.type='checkbox';all.setAttribute('aria-label','Select all orders on this page');
 const visibleCount=visible.filter(o=>chosen.has(orderKey(o))).length;
 all.checked=visible.length>0&&visibleCount===visible.length;all.indeterminate=visibleCount>0&&visibleCount<visible.length;all.disabled=!visible.length;
 all.onchange=()=>{
  const desired=all.checked;
  if(desired&&chosen.size+visible.length-visibleCount>selectionLimit){msg('Select up to '+selectionLimit+' orders at a time.',true);selectionBar();return;}
  for(const o of visible)toggleOrder(o,desired);
  rows();selectionBar();
 };
 label.append(all,el('span','Select page'));
 const count=el('strong',items.length+' selected');count.setAttribute('aria-live','polite');host.append(label,count);
 if (restoreFocus) {
  const target = all.disabled ? root.querySelector('.uc-queue-search input') : all;
  target?.focus({preventScroll:true});
 }
 if(!items.length)return;
 const actions=el('div',undefined,'uc-button-row');
 const archiveCount=items.filter(o=>restoring?o.archived:o.archive_eligible).length;
 const archive=btn((restoring?'Restore':'Archive')+' eligible ('+archiveCount+')',archiveSelected);
 archive.disabled=!archiveCount;if(!archiveCount)archive.title='Select completed, refunded or canceled orders.';
 actions.append(archive);
 if(!restoring){
  const ready=items.every(o=>physical(o)&&!o.archived);
  const pdf=btn('Supplier sheet PDF',()=>downloadSelectedSheet('pdf')),csv=btn('Supplier sheet CSV',()=>downloadSelectedSheet('csv'));
  pdf.disabled=csv.disabled=!ready;
  const labels=btn('Bulk shipping labels',()=>window.PureBulkLabels.open({api,orders:selectedOrders()}));
  labels.disabled=!ready||items.length>10||!window.PureBulkLabels;
  labels.title='Select up to 10 physical orders to review shipping and postage.';
  actions.append(pdf,csv,labels);
 }
 actions.append(btn('Clear selection',()=>{chosen.clear();rows();selectionBar()}));host.append(actions);
}
const queueDateFormat = new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric', year:'numeric'});

function rows() {
 const host = root?.querySelector('[data-unified-list]');
 if (!host) return;
 host.replaceChildren();
 if (!orders.length) {
  host.append(el('p', query || filter !== 'all' ? 'No matching orders.' : 'No orders in this view.', 'uc-empty'));
  return;
 }
 for (const order of orders) {
  const card = el('article', undefined, 'uc-order-row');
  const identity = el('div', undefined, 'uc-order-identity');
  const customer = el('span', order.customer_name || order.customer_email || 'Unknown customer', 'uc-row-customer');
  const metadata = el('small', undefined, 'uc-row-meta');
  metadata.append(el('span', type(order)));
  const created = new Date(order.created_at);
  if (order.created_at && Number.isFinite(created.getTime())) {
   const date = el('time', queueDateFormat.format(created));
   date.dateTime = created.toISOString();
   date.title = when(order.created_at);
   metadata.append(date);
  }
  identity.append(el('strong', ref(order)), customer, metadata);
  if (priorityOrder(order)) identity.append(priorityBadge());

  const pendingCad = interacRequest(order);
  const estimate = requestEstimate(order);
  const subscription = order.source === 'research_subscription';
  const status = subscription ? order.research_status : order.source === 'commerce' ? order.commerce_status : order.fulfillment_status;
  const sum = el('div', undefined, 'uc-order-total');
  const amount = pendingCad ? 'CAD quote pending' : cash(order.total_cents, order.currency) + (subscription ? '/mo' : '');
  const summary = pendingCad && Number.isSafeInteger(estimate?.total_cents)
   ? cash(estimate.total_cents, 'USD') + ' USD estimate'
   : orderState(order, status);
  sum.append(el('strong', amount), el('small', summary, 'uc-row-status'));

  const slot = el(selectable(order) ? 'label' : 'span', undefined, 'uc-order-select');
  if (selectable(order)) {
   const box = el('input');
   box.type = 'checkbox';
   box.checked = chosen.has(orderKey(order));
   box.setAttribute('aria-label', 'Select order ' + ref(order));
   box.onchange = () => {
    if (!toggleOrder(order, box.checked)) box.checked = chosen.has(orderKey(order));
    selectionBar();
   };
   slot.append(box);
  }
  const title = subscription ? 'View subscription' : pendingCad ? 'Review CAD order' : 'Manage order';
  const open = btn(title, () => detail(order), 'uc-open-order');
  open.title = title;
  open.dataset.openOrder = orderKey(order);
  open.setAttribute('aria-label', title + ' ' + ref(order));
  open.setAttribute('aria-haspopup', 'dialog');
  card.append(slot, identity, sum, open);
  host.append(card);
 }
}

function queueIcon(path) {
 const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
 svg.setAttribute('viewBox', '0 0 24 24');
 svg.setAttribute('aria-hidden', 'true');
 svg.setAttribute('focusable', 'false');
 const line = document.createElementNS(svg.namespaceURI, 'path');
 line.setAttribute('d', path);
 svg.append(line);
 return svg;
}

function mountQueue() {
 const toolbar = el('div', undefined, 'uc-queue-toolbar');
 const search = el('label', undefined, 'uc-queue-search');
 const q = el('input');
 q.type = 'search';
 q.placeholder = 'Search';
 q.setAttribute('aria-label', 'Search orders or customers');
 q.value = query;
 q.oninput = () => {
  query = q.value;
  page = 1;
  clearTimeout(timer);
  timer = setTimeout(load, 300);
 };
 search.append(queueIcon('M15.5 15.5 21 21 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z'), q);
 const filters = el('div', undefined, 'uc-queue-filters');
 filters.id = 'uc-queue-filters';
 filters.hidden = true;
 const toggle = el('button', undefined, 'uc-filter-toggle');
 toggle.type = 'button';
 toggle.setAttribute('aria-expanded', 'false');
 toggle.setAttribute('aria-controls', filters.id);
 const toggleLabel = el('span');
 toggle.append(queueIcon('M3 7h7m4 0h7M3 17h11m4 0h3M10 4v6m6 4v6'), toggleLabel);
 toggle.onclick = () => {
  filters.hidden = !filters.hidden;
  toggle.setAttribute('aria-expanded', String(!filters.hidden));
 };
 function updateFilters() {
  const count = Number(sort !== 'fulfillment_priority') + Number(filter !== 'all') + Number(archiveView !== 'current');
  toggleLabel.textContent = count ? 'Filters (' + count + ')' : 'Filters';
  toggle.classList.toggle('uc-filter-active', Boolean(count));
 }
 function filterControl(title, name, options, value, change) {
  const label = el('label', title);
  const pick = el('select');
  pick.setAttribute('aria-label', name);
  for (const [key, text] of options) {
   const option = el('option', text);
   option.value = key;
   pick.append(option);
  }
  pick.value = value;
  pick.onchange = () => {
   clearTimeout(timer);
   change(pick.value);
   updateFilters();
   page = 1;
   load();
  };
  label.append(pick);
  filters.append(label);
 }
 filterControl('Sort by', 'Sort orders', [['fulfillment_priority','Fulfillment priority'],['newest','Newest first'],['oldest','Oldest first'],['highest_total','Highest total']], sort, value => {sort = value;});
 filterControl('Order type', 'Filter order type', [['all','All types'],['goods','Product orders'],['bulk','Bulk orders'],['membership','Membership purchases'],['research_subscription','Research subscriptions']], filter, value => {filter = value;});
 filterControl('View', 'Order archive view', [['current','Active orders'],['archived','Archived orders']], archiveView, value => {archiveView = value; chosen.clear();});
 updateFilters();
 const refresh = btn('Refresh',load);
 refresh.className = 'uc-refresh-orders';
 refresh.title = 'Refresh orders';
 refresh.setAttribute('aria-label', refresh.title);
 refresh.replaceChildren(queueIcon('M20 8a8 8 0 1 0 .3 7M20 3v5h-5'));
 toolbar.append(search, toggle, refresh);
 const message = el('p', '', 'uc-message');
 message.setAttribute('data-unified-message', '');
 message.setAttribute('role', 'status');
 const selection = el('div', undefined, 'uc-selection');
 selection.setAttribute('data-order-selection', '');
 const list = el('div', undefined, 'uc-list');
 list.setAttribute('data-unified-list', '');
 const pager = el('nav', undefined, 'uc-pager');
 pager.setAttribute('aria-label', 'Order pages');
 root.replaceChildren(toolbar, filters, message, selection, list, pager);
}

async function load() {
 if (!api || !root) return;
 if (!root.querySelector('[data-unified-list]')) mountQueue();
 const ticket = ++epoch;
 const params = new URLSearchParams({status:archiveView, page:String(page), page_size:'25', sort, search:query, type:filter});
 const list = root.querySelector('[data-unified-list]');
 const selection = root.querySelector('[data-order-selection]');
 const pager = root.querySelector('.uc-pager');
 list.inert = selection.inert = pager.inert = true;
 list.setAttribute('aria-busy', 'true');
 if (!list.hasChildNodes()) list.append(el('p', 'Loading orders…', 'uc-empty'));
 try {
  const result = await api('/api/admin-orders?' + params);
  if (ticket !== epoch) return;
  orders = result.orders || [];
  for (const order of orders) {
   const key = orderKey(order);
   if (chosen.has(key)) chosen.set(key, order);
  }
  paging = result.pagination || {};
  const count = document.getElementById('orders-message');
  const total = paging.total ?? orders.length;
  if (count && !root.closest('[hidden]')) count.textContent = total + (total === 1 ? ' order' : ' orders');
  const message = root.querySelector('[data-unified-message]');
  message.textContent = '';
  message.classList.remove('failed');
  selectionBar();
  rows();
  pager.replaceChildren();
  if (paging.has_previous || paging.has_next) {
   const previous = btn('Previous', () => { page--; return load(); });
   const next = btn('Next', () => { page++; return load(); });
   previous.disabled = !paging.has_previous;
   next.disabled = !paging.has_next;
   pager.append(previous, el('span', 'Page ' + page), next);
  }
 } catch (error) {
  if (ticket !== epoch) return;
  orders = [];
  const count = document.getElementById('orders-message');
  if (count && !root.closest('[hidden]')) count.textContent = '';
  selection.replaceChildren();
  pager.replaceChildren();
  list.replaceChildren(btn('Retry', load));
  const message = root.querySelector('[data-unified-message]');
  message.textContent = error.message;
  message.classList.add('failed');
 } finally {
  if (ticket === epoch) {
   list.inert = selection.inert = pager.inert = false;
   list.removeAttribute('aria-busy');
  }
 }
}
// An action may finish after the operator has closed or switched orders.
function newOrderSession(row){
 const owner=root.querySelector('.uc-queue-toolbar');
 const isCurrent=()=>orderSession===session&&dlg?.open;
 const session={
  notice(text,bad=false){if(isCurrent())showNotice(dlg,text,bad)},
  async refresh(){
   if(!owner?.isConnected)return;
   const version=detailVersion;
   await load();
   if(isCurrent()&&!pendingOpenVersion&&version===detailVersion)await detail(row.id,session);
  },
  async finish(message){
   if(!owner?.isConnected)return;
   const current=isCurrent();
   if(current)dlg.close();
   await load();
   if(current&&owner.isConnected&&!pendingOpenVersion&&!dlg?.open)msg(message);
  }
 };
 return session;
}

function orderDialog(){
 if(dlg)return dlg;
 dlg=el('dialog',undefined,'fh-dialog uc-dialog uc-order-editor');
 dlg.setAttribute('aria-labelledby','uc-editor-title');
 dlg.addEventListener('close',event=>{
  if(event.currentTarget!==dlg||dlg.open||pendingOpenVersion)return;
  const opener=[...root?.querySelectorAll('[data-open-order]')||[]].find(button=>button.dataset.openOrder===dlg.dataset.orderKey);
  (opener||root?.querySelector('.uc-queue-search input'))?.focus({preventScroll:true});
 });
 document.body.append(dlg);
 return dlg;
}

// Keep the panels mounted so switching sections preserves unsaved form input.
function orderPanels(dialog,names,initial){
 const navigation=el('div',undefined,'uc-edit-tabs'),body=el('div',undefined,'uc-edit-body'),panes={},tabs=[];
 navigation.setAttribute('role','tablist');
 navigation.setAttribute('aria-label','Order sections');
 function show(name,focus=false){
  for(const tab of tabs){
   const selected=tab.dataset.panel===name;
   tab.setAttribute('aria-selected',String(selected));
   tab.tabIndex=selected?0:-1;
   panes[tab.dataset.panel].hidden=!selected;
   if(selected&&focus)tab.focus({preventScroll:true});
  }
  dialog.dataset.panel=name;
  body.scrollTop=0;
 }
 for(const name of names){
  const panel=el('section',undefined,'uc-edit-pane'),tab=el('button',name);
  tab.type='button';
  tab.id='uc-tab-'+name;
  tab.dataset.panel=name;
  panel.id='uc-panel-'+name;
  tab.setAttribute('role','tab');
  tab.setAttribute('aria-controls',panel.id);
  panel.setAttribute('role','tabpanel');
  panel.setAttribute('aria-labelledby',tab.id);
  panel.tabIndex=0;
  tab.onclick=()=>show(name);
  tab.onkeydown=event=>{
   const index=names.indexOf(name),last=names.length-1;
   const targets={ArrowRight:(index+1)%names.length,ArrowLeft:(index+last)%names.length,Home:0,End:last};
   if(!Object.hasOwn(targets,event.key))return;
   event.preventDefault();
   show(names[targets[event.key]],true);
  };
  panes[name]=panel;
  tabs.push(tab);
  navigation.append(tab);
  body.append(panel);
 }
 if(names.length===1){
  navigation.hidden=true;
  panes[names[0]].removeAttribute('aria-labelledby');
  panes[names[0]].setAttribute('aria-label',names[0]);
 }
 dialog.append(navigation,body);
 show(names.includes(initial)?initial:names[0]);
 return {panes,show};
}
async function detail(record,origin=null){
 const openVersion=++detailVersion;
 if(!origin)pendingOpenVersion=openVersion;
 const isCurrent=()=>openVersion===detailVersion&&(!origin||(origin===orderSession&&dlg?.open));
 let row=typeof record==='object'?record:orders.find(o=>o.id===record),data;
 try{
  if(!row){
   const result=await api('/api/admin-orders?'+new URLSearchParams({status:'all',search:String(record),page_size:'5'}));
   row=result.orders?.find(o=>o.id===record);
  }
  if(!row)throw Error('Order unavailable. Refresh the list.');
  data=row.source==='commerce'?await api(lotus('detail','&id='+encodeURIComponent(row.id))):{order:row,allocations:[],jobs:[]};
  if(data.manual_pilot_eligible){
   try{data.manual_pilot=await api(lotus('manual_pilot','&id='+encodeURIComponent(row.id)))}
   catch{data.manual_pilot=null}
  }
 }catch(error){
  if(!isCurrent())return;
  throw error;
 }finally{
  if(pendingOpenVersion===openVersion)pendingOpenVersion=0;
 }
 if(!isCurrent())return;
 const o=data.order,dialog=orderDialog(),key=orderKey(row),refresh=dialog.open&&dialog.dataset.orderKey===key;
 if(!refresh)orderSession=newOrderSession(row);
 const initial=refresh?dialog.dataset.panel:'Summary';
 const openTasks=refresh?[...dialog.querySelectorAll('details[data-shipping-task][open]')].map(node=>node.dataset.shippingTask):[];
 dialog.dataset.orderKey=key;
 dialog.replaceChildren();
 const head=el('header',undefined,'uc-dialog-head'),title=el('div');
 const label=el('div',undefined,'uc-editor-meta');
 label.append(el('span',type(row)),el('span',orderState(o,o.status||row.research_status||row.fulfillment_status),'uc-editor-status'));
 const heading=el('h2',ref(row));heading.id='uc-editor-title';
 title.append(label,heading);
 if(priorityOrder({...row,...o,commerce_status:o.status||row.commerce_status}))title.append(priorityBadge());
 const closeButton=el('button','Close','uc-editor-close');
 closeButton.type='button';closeButton.onclick=()=>dialog.close();
 head.append(title,closeButton);
 const notice=el('p','','uc-message');notice.setAttribute('data-unified-message','');notice.setAttribute('role','status');
 dialog.append(head,notice);
 const names=['Summary'];
 if(row.source==='commerce')names.push('Payment');
 if(row.source==='store'||(row.source==='commerce'&&o.kind==='goods'))names.push('Shipping');
 const {panes,show}=orderPanels(dialog,names,initial);
 if(row.source==='commerce')commerceActions(panes.Payment,row,data,panes.Shipping);
 if(row.source==='store')legacyActions(panes.Shipping,row);
 const pendingCad=interacRequest(o),estimate=requestEstimate(o),research=row.source==='research_subscription',currency=o.currency||row.currency;
 const total=pendingCad?(Number.isSafeInteger(estimate?.total_cents)?cash(estimate.total_cents,'USD')+' USD':'Awaiting CAD quote'):
  cash(o.total_cents??row.total_cents,currency)+(research?'/mo':'');
 const info=el('section',undefined,'uc-info');
 const contact=el('div',undefined,'uc-editor-contact');
 const email=field('Email',o.customer_email||row.customer_email);
 email.classList.add('uc-contact-email');
 contact.append(field('Customer',o.customer_name||row.customer_name),email);
 info.append(contact);
 info.append(field('Payment',pendingCad?'CAD order review pending':orderState(o,row.payment_status)));
 if(row.kind!=='membership')info.append(field('Fulfillment',research?state(row.research_status):orderState(o,row.fulfillment_status||o.status)));
 if(row.organization)info.append(field('Organization',row.organization));
 if(row.source==='commerce'&&o.payment_snapshot?.label)info.append(field('Payment method',o.payment_snapshot.label));
 if(row.kind==='membership')info.append(field('Membership plan',({vip:'PURE WHITE',elite:'PURE BLACK'})[o.plan||row.plan]||'Membership'),field('Term',o.request_data?.billing_period==='annual'?'12 months prepaid':o.request_data?.billing_period==='monthly'?'1 month prepaid':'View purchase terms'));
 if(research)info.append(field('Paid cycles',row.paid_cycles),field('Next billing',when(row.next_billing_at)));
 const placedAt=o.created_at||row.created_at;
 const placed=field('Placed');
 if(placedAt){
  const timestamp=new Date(placedAt),date=el('time');
  date.dateTime=placedAt;
  date.className='uc-placed-at';
  date.append(el('bdi',timestamp.toLocaleDateString()),' ',el('bdi',timestamp.toLocaleTimeString()));
  placed.querySelector('strong').replaceChildren(date);
 }
 info.append(placed);
 panes.Summary.append(info);
 const items=el('section',undefined,'uc-items');items.append(el('h3',row.source==='research_subscription'?'Subscription items':'Order items'));
 const recorded=o.pricing?.lines||o.request_data?.items||[];
 const physical=data.physical_items?.map(item=>{
  const charge=recorded.find(line=>line.id===item.id&&line.size===item.size);
  return {...charge,...item,...(item.purchased===0?{line_total_cents:0}:{})};
 });
 if(data.quantity_error)items.append(el('p',data.quantity_error,'uc-hint'));
 const lines=row.source==='commerce'?(physical||recorded):row.source==='research_subscription'?(row.lines||[]):row.store_order_items||[];
 for(const line of lines){const item=el('div',undefined,'uc-item'),name=line.name||line.product_name||line.id||'Product',size=line.size||line.variant_size||'',qty=line.qty||line.quantity||1;
  const description=[name+(size?' · '+size:'')+' × '+qty+(line.free?(line.purchased===0?' (free gift)':' ('+line.purchased+' paid + '+line.free+' free)'):''),row.source==='store'&&line.lot_number?'Lot: '+line.lot_number:''].filter(Boolean).join(' — ');
  item.append(el('span',description));const cents=line.line_total_cents??line.gross_cents??(line.unit_price_cents!=null?line.unit_price_cents*(line.purchased??qty):pendingCad&&Number.isSafeInteger(line.unit_price_usd_cents)?line.unit_price_usd_cents*(line.purchased??qty):null);if(cents!==null)item.append(el('strong',cash(cents,pendingCad?'USD':o.currency||row.currency)+(pendingCad?' USD':'')));items.append(item);
 }
 if(lines.length||data.quantity_error)panes.Summary.append(items);
 if(!research&&!pendingCad){
  const breakdown=el('details',undefined,'uc-order-breakdown'),summary=el('summary');
  summary.append(el('span','Order total'),el('strong',total));
  const totals=el('div',undefined,'uc-total');
  for(const [label,key] of [['Subtotal','subtotal_cents'],['Discounts','discount_cents'],['Shipping','shipping_cents'],['Tax','tax_cents']]){
   totals.append(field(label,(label==='Discounts'?'−':'')+cash(o[key]??row[key],currency)));
  }
  breakdown.append(summary,totals);
  panes.Summary.append(breakdown);
 }else info.append(field(pendingCad?'USD request estimate':'Monthly total',total));
 const addr=row.source==='commerce'?o.kind==='goods'?o.request_data?.address:null:row.shipping_address;
 if(addr&&Object.keys(addr).length){
  const destination=el('section',undefined,'uc-destination'),heading=el('div',undefined,'uc-destination-head');
  heading.append(el('h3','Ship to'));
  const task=panes.Shipping?.querySelector('details[data-shipping-task="address"]');
  if(task){
   const edit=el('button','Edit','uc-address-edit');
   edit.type='button';edit.setAttribute('aria-label','Edit shipping address');
   edit.onclick=()=>{
    show('Shipping');
    task.open=true;
    task.querySelector('summary')?.focus();
   };
   heading.append(edit);
  }
  destination.append(heading,el('p',address(addr),'uc-address'));
  panes.Summary.append(destination);
 }
 if(o.tracking_number||row.tracking_number)panes.Summary.append(field('Tracking',[o.tracking_carrier||row.tracking_carrier,o.tracking_number||row.tracking_number].filter(Boolean).join(' ')));
 if(row.source==='store'&&row.internal_status_history?.length){
  const history=el('details',undefined,'uc-history');history.append(el('summary','Status history'));
  for(const change of row.internal_status_history)history.append(el('p',`${state(change.from)} → ${state(change.to)} · ${when(change.at)}`,'uc-hint'));
  panes.Summary.append(history);
 }
 if(row.source==='commerce')historySection(panes.Summary,data.history||[]);
 if(research)panes.Summary.append(el('p','Read-only record. Recurring checkout is unavailable. Saved research lists are not orders.','uc-hint'));
 for(const task of dialog.querySelectorAll('details[data-shipping-task]')){
  if(openTasks.includes(task.dataset.shippingTask))task.open=true;
 }
 if(!dialog.open)dialog.showModal();
 const activeTab=dialog.querySelector('.uc-edit-tabs:not([hidden]) [aria-selected="true"]');
 (activeTab||closeButton).focus({preventScroll:true});
}
async function downloadSheet(row,format){
 const session=orderSession;
 const params=new URLSearchParams({view:'fulfillment-sheet',id:row.id,source:row.source,format});
 const file=await api('/api/admin-orders?'+params,{responseType:'blob'}),url=URL.createObjectURL(file),a=el('a');
 a.href=url;a.download='fulfillment-'+ref(row)+'.'+format;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 session.notice('Fulfillment sheet downloaded. The order status is unchanged.');
}
function exportSection(host,row,o){const box=el('section',undefined,'uc-export');box.append(el('h4','Fulfillment sheet'));
 if(!['paid','processing'].includes(o.status||row.payment_status))box.append(el('p','This sheet is marked HOLD / DO NOT SHIP until the order is ready for fulfillment.','uc-hint'));
 const buttons=el('div',undefined,'uc-button-row');buttons.append(btn('Download PDF',()=>downloadSheet(row,'pdf'),'primary'),btn('Download CSV',()=>downloadSheet(row,'csv')));box.append(buttons);host.append(box)}
function historySection(host,changes){const box=el('details',undefined,'uc-history');box.append(el('summary','Activity history'));
 if(!changes.length)box.append(el('p','No activity recorded.','uc-hint'));
 for(const change of changes){const item=el('div',undefined,'uc-history-item'),routing=/supplier|lotus|purity|fulfillment_(?:assign|retry|takeover)/i.test(String(change.action||'')),action=routing?'Fulfillment record updated':String(change.action||'Updated').replace(/_/g,' ');item.append(el('strong',action),el('small',when(change.created_at)+' · '+(routing?'fulfillment':change.actor||'system')));
  if(routing){box.append(item);continue}
  if(change.from||change.to)item.append(el('p',[change.from&&state(change.from),change.to&&state(change.to)].filter(Boolean).join(' → ')));
  if(change.note)item.append(el('p',change.note));if(change.reference)item.append(el('p','Reference: '+change.reference));box.append(item)}host.append(box)}
function reportLink(host,report){
 host.replaceChildren();
 if(!report)return;
 let url;
 try{url=new URL(report.verification_url)}catch{return}
 if(url.protocol!=='https:'||url.username||url.password)return;
 const link=el('a','Verify '+report.report_id+(report.lab_name?' · '+report.lab_name:''));
 link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';host.append(link);
}
function pilotReconciliation(host,row,data){
 const session=orderSession;
 const pilot=data.manual_pilot, o=data.order;
 if(!pilot?.eligible){
  const notice=el('p','The packing record could not be loaded. Refresh before dispatch.','uc-hint');
  host.append(notice,btn('Reload packing record',session.refresh));
  return;
 }
 const record=pilot.record, lots=pilot.lots||[];
 const section=el('section',undefined,'uc-pilot');
 section.append(el('h4','Manual fulfillment'));
 section.append(el('p','Tirzepatide 40 mg · '+pilot.paid_qty+' paid + '+pilot.free_qty+' free'+(pilot.gift_qty?' · '+pilot.gift_qty+' recon gift':''),'uc-hint'));
 host.append(section);
 const historical=['shipped','delivered','refunded','void'].includes(o.status);
 const writable=pilot.writable!==false;
 if(!writable&&!record){
  section.append(el('p','No packing record was saved before dispatch.','uc-hint'));
  return;
 }
 const f=el('form',undefined,'uc-action-form uc-pilot-form');
 section.append(f);
 const report=el('p',undefined,'uc-pilot-report');
 const savedDocument=record&&lots.find(l=>l.document_id===record.document_id&&l.lot_number===record.lot_number);
 let chooseLot, gift;
 if(historical||!writable){
  if(record){f.append(field('Packed lot',record.lot_number),field('Lab report',record.report_id));
   if(pilot.gift_qty)f.append(field('Recon gift lot',record.gift_lot_number));
   reportLink(report,record.verification_url?record:savedDocument);f.append(report);}
 }else{
  if(!lots.length){
   f.append(el('p','No released lot has a verified report for this product. Complete lot intake and verify its report before packing.','uc-hint'));
   if(record)f.append(field('Previously recorded lot',record.lot_number));
   return;
  }
  chooseLot=select(f,'Packed lot and lab report','pilot_document_id',[['','Choose the lot printed on every product vial'],...lots.map(l=>[l.document_id,l.lot_number+' · '+l.report_id])],savedDocument?.document_id||'');
  chooseLot.required=true;
  const showReport=()=>reportLink(report,lots.find(l=>l.document_id===chooseLot.value));
  chooseLot.addEventListener('change',showReport);showReport();f.append(report);
  if(pilot.gift_qty){
   const giftLots=pilot.gift_lots||[];
   if(!giftLots.length){f.append(el('p','No released gift lot is available. Receive and release a recon solution lot before packing.','uc-hint'));return;}
   gift=select(f,'Recon gift lot','gift_lot_number',[['','Choose the lot printed on the gift'],...giftLots.map(l=>[l.lot_number,l.lot_number])],record?.gift_lot_number||'');gift.required=true;
  }
 }
 const hasCosts=Number.isSafeInteger(record?.delivered_cost_cents);
 if(hasCosts&&Number.isSafeInteger(record.profit_cents)&&Number.isSafeInteger(record.margin_bps)&&!['refunded','void'].includes(o.status)){
  const result=el('div',undefined,'uc-pilot-result');
  result.append(field('Order profit',cash(record.profit_cents)),field('Margin',(record.margin_bps/100).toFixed(1)+'%'));f.append(result);
 }
 if(hasCosts&&record.profit_cents==null&&writable)f.append(el('p','Margin pending receipt reconciliation.','uc-hint'));
 const costs=el('details',undefined,'uc-pilot-costs');
 costs.append(el('summary',hasCosts?'Recorded costs · USD':'Reconcile order costs · USD'));
 const basis=el('div',undefined,'uc-pilot-result');
 basis.append(field('Receipts excluding tax',Number.isSafeInteger(pilot.receipts_cents)?cash(pilot.receipts_cents):'Pending'),
  field('Commission',Number.isSafeInteger(pilot.commission_cents)?cash(pilot.commission_cents):'Pending'));
 costs.append(basis);
 const entries=[
  ['delivered_cost_cents','Total product and fulfillment cost'],
  ['processing_fee_cents','Payment processing fees'],
  ['overhead_cents','Allocated overhead'],
  ['loss_allowance_cents','Loss allowance']
 ];
 const amounts=new Map(),grid=el('div',undefined,'uc-pilot-inputs');
 for(const [key,title] of entries){
  const value=Number.isSafeInteger(record?.[key])?(record[key]/100).toFixed(2):'';
  const control=input(grid,title,key,value);
  control.type='number';control.min='0';control.step='0.01';control.max='10000000';control.inputMode='decimal';control.readOnly=!writable;
  amounts.set(key,control);
 }
 costs.append(el('p','Include both paid and free units, the gift, labeling, packing and postage in the delivered cost.','uc-hint'),grid);
 const reference=input(costs,'Cost record reference','cost_reference',record?.cost_reference||'');
 reference.maxLength=180;reference.readOnly=!writable;
 function syncCosts(){const required=hasCosts||reference.value.trim()!==''||[...amounts.values()].some(control=>control.value!=='');
  for(const control of amounts.values())control.required=required;
  reference.required=required;return required;
 }
 for(const control of [...amounts.values(),reference]){
  control.addEventListener('input',syncCosts);control.addEventListener('invalid',()=>{costs.open=true});
 }
 syncCosts();f.append(costs);
 if(!writable)return;
 submit(f,historical?'Save order costs':record?'Save packing record':'Record packed lot',async()=>{
  const selected=chooseLot?lots.find(l=>l.document_id===chooseLot.value):record;
  if(!selected)throw Error('Select the verified report for the packed lot.');
  const body={action:'save_manual_pilot',id:o.id,revision:record?.revision||0,lot_number:selected.lot_number,report_id:selected.report_id,document_id:selected.document_id};
  if(pilot.gift_qty){
   body.gift_lot_number=(gift?gift.value:record?.gift_lot_number||'').trim();
   if(!body.gift_lot_number)throw Error('Enter the recon gift lot printed on the vial.');
  }
  if(syncCosts()){
   costs.open=true;
   for(const [key,control] of amounts){
    if(!/^\d+(?:\.\d{1,2})?$/.test(control.value))throw Error('Enter every cost in dollars and cents. Use 0 for a cost that does not apply.');
    const [dollars,cents='']=control.value.split('.');
    body[key]=Number(dollars)*100+Number(cents.padEnd(2,'0'));
    if(!Number.isSafeInteger(body[key]))throw Error('Enter a valid amount in dollars and cents.');
   }
   body.cost_reference=reference.value.trim();if(!body.cost_reference)throw Error('Enter the cost record reference.');
  }
  await write(body);await session.refresh();session.notice('Packing record saved.');
 });
}
function shippingTask(host,key,title,context=''){
 const group=el('details',undefined,'uc-shipping-task'),summary=el('summary');
 group.dataset.shippingTask=key;
 summary.append(el('span',title));
 if(context)summary.append(el('small',context));
 group.append(summary);host.append(group);
 return group;
}
function shippingForm(host,key,title,context,formTitle=title){
 const group=shippingTask(host,key,title,context);
 const f=form(formTitle,group);
 f.classList.add('uc-shipping-form');
 f.setAttribute('aria-label',formTitle);
 f.querySelector('h4').hidden=true;
 return f;
}
function fulfillmentQuote(host,id){
 const box=shippingTask(host,'quote','Check fulfillment quote'),content=el('div',undefined,'uc-shipping-quote');
 box.append(content);
 let loading=false;
 box.addEventListener('toggle',async()=>{
  if(!box.open||loading)return;
  loading=true;
  content.replaceChildren(el('p','Reading payment and commission records…','uc-hint'));
  let basis;
  try{basis=await api(lotus('fulfillment_quote','&id='+encodeURIComponent(id)))}
  catch{loading=false;content.replaceChildren(el('p','Records unavailable. Reopen to retry.','uc-hint'));return}
  if(!basis.available){loading=false;content.replaceChildren(el('p',basis.reason||'No confirmed quote budget.','uc-hint'));return}
  const money=n=>cash(n,basis.currency),info=el('div',undefined,'uc-pilot-result');
  info.append(field('Net receipts',money(basis.receipts_cents)),field('Partner commission',money(basis.commission_cents)));
  const fx=basis.currency==='CAD'&&basis.commission_usd_cents>0?' Commission converted from '+cash(basis.commission_usd_cents,'USD')+' USD at the invoice rate.':'';
  const terms=el('p',basis.paid_units+' paid + '+basis.free_units+' free units (including gifts). Net receipts exclude tax, optional delivery services and membership fees.'+fx,'uc-hint');
  const grid=el('div',undefined,'uc-pilot-inputs'),inputs=[];
  for(const [name,title] of [['processing','Payment fees'],['overhead','Allocated overhead'],['reserve','Loss allowance'],['delivered','Delivered quote']]){
   const control=input(grid,title+' ('+basis.currency+')',name);
   control.type='text';control.inputMode='decimal';control.placeholder='0.00';control.maxLength=12;inputs.push(control);
  }
  const result=el('div',undefined,'uc-pilot-result');result.setAttribute('aria-live','polite');
  const note=el('p','Include all units, gifts, labeling, packing, postage and duties in one delivered quote. Enter shared costs once. This comparison uses a 15% margin target.','uc-hint');
  const read=control=>{
   const value=control.value.trim();
   if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(value))return null;
   const [major,minor='']=value.split('.');
   return Number(major)*100+Number(minor.padEnd(2,'0'));
  };
  function calculate(){
   const [fees,overhead,reserve,quote]=inputs.map(read);result.replaceChildren();
   if([fees,overhead,reserve].includes(null)){result.append(el('p','Enter all three costs to see the spending limit. Enter 0 for a confirmed zero cost.','uc-hint'));return}
   const available=basis.receipts_cents-basis.commission_cents-fees-overhead-reserve;
   const limit=available-Math.ceil(basis.receipts_cents*15/100);
   if(limit<0)result.append(field('15% spending limit','No qualifying quote'));
   else result.append(field('Maximum delivered quote for 15%',money(limit)));
   result.append(field('Break-even delivered quote',available<0?'Already below break-even':money(available)));
   if(quote===null)return;
   const profit=available-quote;
   const decision=quote<=limit?'Meets 15% target':profit<0?'Loss at this quote':'Below 15% target';
   result.append(field(decision,money(profit)+' projected profit'));
  }
  grid.addEventListener('input',calculate);calculate();
  content.replaceChildren(info,terms,grid,note,result);
 });
}
function cardActions(pay,row,data){
 const session=orderSession;
 const order=data.order,id=order.id,version=order.version,attempt=data.card_attempt;
 const statusMessages={awaiting_payment:'Stripe reports that payment is still pending.',paid:'Stripe payment verified.',
  canceled:'Stripe payment and PURE order canceled.',refund_pending:'Stripe is processing this refund.',
  refund_review:'Stripe reports a refund that needs review.',refunded:'Full Stripe refund confirmed and recorded in PURE.',
  review:'The Stripe payment needs review before PURE can update the order.'};
 const run=async body=>{
  const result=await write(body);
  await session.refresh();
  const status=result.payment_state||(result.status==='void'?'canceled':result.status==='refunded'?'refunded':null);
  session.notice(statusMessages[status]||'Payment record refreshed.');
 };
 if(attempt?.error_code==='pure_gateway_test_payment')
  pay.append(el('p','This payment was created in Stripe test mode. It needs sandbox verification before the order can be closed.','uc-hint'));
 if(attempt&&['accepted','paid','processing','shipped','delivered'].includes(order.status))
  pay.append(btn('Sync Stripe status',()=>run({action:'reconcile_card_order',id,version})));
 if(order.status==='accepted')pay.append(btn('Cancel unpaid order',async()=>{
  if(!window.confirm(`Cancel ${ref(row)} and close its unpaid Stripe payment?`))return;
  await run({action:'cancel_order',id,confirm_unpaid:true});
 },'uc-danger'));
 if(['paid','processing','shipped','delivered'].includes(order.status)&&order.total_cents>0&&attempt)
  pay.append(btn('Issue full card refund',async()=>{
   const total=cash(order.total_cents,order.currency)+' '+order.currency;
   if(!window.confirm(`Refund ${total} for ${ref(row)} to the original card? Stripe will process the refund.`))return;
   await run({action:'refund_card_order',id,version,confirm_full_refund:true});
  },'uc-danger'));
}

function commerceActions(host,row,data,shippingPane){const session=orderSession,o=data.order,id=o.id,allocations=data.allocations||[],job=data.jobs?.[0];
 const pay=el('section',undefined,'uc-payment');pay.append(el('h3','Payment'));
 if(interacRequest(o)){
  if(window.PureInteracInvoiceAdmin)window.PureInteracInvoiceAdmin.mount({host:pay,order:o,api,onRefresh:()=>session.refresh(),onIssued:async()=>{await session.refresh();session.notice('CAD order total prepared. The customer must accept it before viewing Interac payment instructions.')}});
  else pay.append(el('p','CAD order review is unavailable. Refresh the Orders page and try again.','uc-hint'));
 }
 else if(data.manual_payment_allowed){const f=form('Confirm received bank payment',pay);f.append(el('p',o.kind==='membership'?'Verify that the full amount has arrived before confirming payment and activating this prepaid membership.':'Verify that the full amount has arrived before confirming payment and preparing this order for fulfillment.','uc-hint'));
  f.append(field('Amount to verify',cash(data.settlement?.amount_cents??o.total_cents,data.settlement?.currency??o.currency)),field('Method',data.payment_method?.label||o.payment_snapshot?.label));
  const reference=input(f,'Bank transaction reference','bank_reference','',true);reference.minLength=8;reference.maxLength=150;
  const check=el('label',undefined,'uc-check'),yes=el('input');yes.type='checkbox';yes.required=true;check.append(yes,el('span','I verified the full amount has arrived in the receiving account.'));f.append(check);
  const receipt=crypto.randomUUID();submit(f,'Mark payment received',async()=>{if(!yes.checked)throw Error('Verify received funds first.');if(!window.confirm('Confirm '+cash(data.settlement?.amount_cents??o.total_cents,data.settlement?.currency??o.currency)+' was received? '+(o.kind==='membership'?'This activates the prepaid membership.':'This makes the order available for fulfillment.')))return;
   const result=await write({action:'record_payment',id,expected_version:o.version,method_id:o.method_id,receipt_id:receipt,external_reference:reference.value,confirm_funds_received:true});await session.refresh();session.notice(o.kind==='membership'?'Payment recorded. The prepaid membership is active.':'Payment recorded. The fulfillment sheet is ready to review.')})}
 else if(['accepted','requested','issued'].includes(o.status))pay.append(el('p',o.kind==='membership'?'Awaiting confirmed payment. Membership benefits stay inactive until payment is verified.':'Awaiting confirmed payment. Shipping stays on hold until this payment is reconciled through its provider.','uc-hint'));
 else pay.append(el('p',o.paid_at?'Payment received '+when(o.paid_at)+'.':state(o.status)+'.','uc-hint'));
 if(o.cancellation_status==='pending')pay.append(el('p','Cancellation requested. Checkout and fulfillment are on hold while the wallet authorization expires and payment is checked automatically. Do not send payment.','uc-hint'));
 if(o.cancellation_status==='review')pay.append(el('p','A crypto transfer was received after cancellation was requested. Fulfillment remains on hold. Review the verified payment and arrange any refund before resolving this order.','uc-hint'));
 if(data.card_reversals)cardActions(pay,row,data);
 else if(o.status==='accepted'&&o.cancellation_status!=='review')pay.append(btn(o.cancellation_status==='pending'?'Check cancellation':'Cancel unpaid order',async()=>{if(!o.cancellation_status&&!window.confirm('Cancel '+ref(row)+'? Verify no payment was sent.'))return;const result=await write({action:'cancel_order',id,confirm_unpaid:true});if(result.status==='void'){await session.finish(ref(row)+' canceled. No refund was issued.')}else if(['pending','review'].includes(result.cancellation_status)){await session.refresh();session.notice(result.cancellation_status==='pending'?'Cancellation requested. Payment checks continue automatically; do not send payment.':'Payment received. Cancellation needs review; fulfillment remains on hold.')}else throw Error('Cancellation was not confirmed.')},'uc-danger'));
 host.append(pay);
 if(o.kind==='goods'){
  const shipment=el('section',undefined,'uc-shipment');
  shipment.setAttribute('aria-label','Fulfillment tasks');
  const manual=allocations.length>0&&allocations.every(a=>a.route==='manual');
  const remote=!!(job?.supplier_id||job?.has_payload||['working','submitted','shipped'].includes(job?.status));
  const unresolved=remote&&!(job?.status==='cancelled'&&job?.provider_status==='cancelled');
  const options=[];
  if(o.status==='paid')options.push(['processing','Processing']);
  if(manual&&!unresolved&&(!data.manual_pilot_eligible||data.manual_pilot?.ready_to_ship===true)&&['paid','processing'].includes(o.status))options.push(['shipped','Shipped']);
  if(o.status==='shipped')options.push(['delivered','Delivered']);
  if(options.length){
   const f=shippingForm(shipment,'status','Update fulfillment',state(o.status),'Update complete order');
   const next=select(f,'Next status','status',options),carrier=input(f,'Carrier','carrier',o.tracking_carrier);
   const tracking=input(f,'Tracking number','tracking',o.tracking_number),note=input(f,'Audit note','note','',true);
   note.minLength=8;
   const requireTracking=()=>{carrier.required=tracking.required=next.value==='shipped'};
   next.addEventListener('change',requireTracking);requireTracking();
   submit(f,'Save fulfillment status',async()=>{
    if(next.value==='shipped'&&(!carrier.value.trim()||!tracking.value.trim()))throw Error('Carrier and tracking required before shipment.');
    await write({action:'update_order',id,version:o.version,status:next.value,note:note.value,tracking_carrier:carrier.value,tracking_number:tracking.value});
    await session.refresh();session.notice('Fulfillment status saved.');
   });
  }
  if(manual&&['shipped','delivered'].includes(o.status)){
   const f=shippingForm(shipment,'tracking','Correct shipment tracking',o.tracking_carrier);
   const carrier=input(f,'Carrier','carrier',o.tracking_carrier,true),tracking=input(f,'Tracking number','tracking',o.tracking_number,true);
   const note=input(f,'Reason for correction','note','',true);note.minLength=8;
   submit(f,'Save tracking correction',async()=>{
    await write({action:'update_tracking',id,version:o.version,tracking_carrier:carrier.value,tracking_number:tracking.value,note:note.value});
    await session.refresh();session.notice('Shipment tracking saved.');
   });
  }
  if(!allocations.length)shipment.append(el('p','Shipment controls become available after payment is confirmed.','uc-hint'));
  else if(!manual&&!['shipped','delivered','void','refunded'].includes(o.status))shipment.append(el('p','An existing fulfillment record needs review. Resolve it before recording another shipment.','uc-hint'));
  if(['paid','processing'].includes(o.status)&&!remote){
   const addr=o.request_data?.address||{},fields={};
   const f=shippingForm(shipment,'address','Edit shipping address',[addr.city,addr.region||addr.state].filter(Boolean).join(', '));
   for(const [title,key]of [['Street','line1'],['Address line 2','line2'],['City','city'],['State / province','region'],['Postal code','postal_code'],['Country code','country']]){
    fields[key]=input(f,title,key,addr[key]||(key==='region'?addr.state:'')||'',key!=='line2');
   }
   fields.country.readOnly=true;
   const note=input(f,'Reason for address change','note','',true);note.minLength=8;
   submit(f,'Save address',async()=>{
    const address=Object.fromEntries(Object.entries(fields).map(([key,control])=>[key,control.value]));
    await write({action:'edit_shipping',id,version:o.version,address,note:note.value});
    await session.refresh();session.notice('Shipping address saved.');
   });
  }else if(remote&&['paid','processing'].includes(o.status))shipment.append(el('p','Fulfillment has already started. Review the existing shipment before changing its destination.','uc-hint'));
  if(data.manual_pilot_eligible&&(data.manual_pilot?.eligible||!['refunded','void'].includes(o.status))){
   const group=shippingTask(shipment,'pilot','Manual packing record');
   pilotReconciliation(group,row,data);
  }
  if(!data.manual_pilot_eligible&&allocations.length&&['paid','processing','shipped','delivered'].includes(o.status)){
   const f=shippingForm(shipment,'lots','Packed lot certificates');
   for(const packed of data.packed_lots||[]){
    const allocation=allocations.find(a=>a.variant_key===packed.variant_key),lotNumber=packed.enterprise_inventory_lots?.lot_number;
    if(allocation&&lotNumber)f.append(el('p',(allocation.item?.name?allocation.item.name+' · '+allocation.item.size:allocation.variant_key)+' — Lot '+lotNumber));
   }
   const variant=select(f,'Fulfilled item','packed_variant',allocations.map(a=>[a.variant_key,a.item?.name?a.item.name+' · '+a.item.size:a.variant_key]));
   const lot=input(f,'Packed lot number','lot_number','',true);lot.maxLength=120;
   submit(f,'Link packed lot',async()=>{await write({action:'record_packed_lot',id,variant_key:variant.value,lot_number:lot.value});await session.refresh();session.notice('Packed lot linked. Verified reports appear in the customer account after shipping.');});
   f.append(btn('Remove packed lot link',async()=>{if(!lot.value.trim())throw Error('Enter the exact lot number to remove.');await write({action:'record_packed_lot',id,variant_key:variant.value,lot_number:lot.value,remove:true});await session.refresh();session.notice('Packed lot link removed.');}));
  }
  if(['paid','processing','shipped','delivered'].includes(o.status)&&!o.cancellation_status)fulfillmentQuote(shipment,id);
  shippingPane.append(shipment);window.PureShippingLabels?.mount({host:shippingPane,row,api});exportSection(shippingPane,row,o)}
 if(!data.card_reversals&&['paid','processing','shipped','delivered'].includes(o.status)){const advanced=el('details',undefined,'uc-history');advanced.append(el('summary','Refund management'));host.append(advanced);const f=form('Record a completed full refund',advanced);f.append(el('p','Complete and verify the refund with the provider first. This records it; it does not return funds.','uc-hint'));
  if(data.settlement)f.append(field('Amount refunded',cash(data.settlement.amount_cents,data.settlement.currency)));
  const transaction=input(f,'Provider refund transaction ID','external_reference','',true);transaction.minLength=8;const check=el('label',undefined,'uc-check'),yes=el('input');yes.type='checkbox';yes.required=true;check.append(yes,el('span','I verified the full external refund.'));f.append(check);
  submit(f,'Record verified refund',async()=>{if(!window.confirm('Record the completed external refund? This does not send money.'))return;await write({action:'record_verified_refund',id,version:o.version,confirm_external_refund:true,external_reference:transaction.value});await session.refresh()})}
 if(o.status==='void')host.append(el('p','Canceled. Reconcile any late payment before refund or fulfillment.','uc-hint'));
 if(o.status==='refunded')host.append(el('p',data.card_gateway?'Full card refund confirmed.':'Full external refund recorded.','uc-hint'));
 if(o.kind==='membership'&&o.status==='paid')host.append(el('p','Membership purchase recorded. No shipping workflow applies.','uc-hint'))}
function legacyActions(host,o){const session=orderSession;host.append(el('p','Earlier store order. Canceling fulfillment does not issue a refund or stop a provider payment.','uc-hint'));
 const transitions={unfulfilled:['processing','awaiting_supplier','canceled'],processing:['awaiting_supplier','partially_shipped','shipped'],awaiting_supplier:['processing','partially_shipped','shipped'],partially_shipped:['shipped'],shipped:['delivered']};
 const allowed=(transitions[o.fulfillment_status]||[]).filter(x=>!['processing','awaiting_supplier','partially_shipped','shipped','delivered'].includes(x)||['paid','partially_refunded'].includes(o.payment_status));
 const f=form('Update order details',host),next=select(f,'Fulfillment status','fulfillment_status',[[o.fulfillment_status,state(o.fulfillment_status)],...allowed.map(x=>[x,state(x)])]),priority=select(f,'Priority','priority',[['low','Low'],['normal','Normal'],['high','High']],o.priority||'normal'),carrier=input(f,'Carrier','tracking_carrier',o.tracking_carrier||''),tracking=input(f,'Tracking number','tracking_number',o.tracking_number||''),notes=input(f,'Internal notes','admin_notes',o.admin_notes||'');
 submit(f,'Save order',async()=>{if(next.value==='canceled'&&!window.confirm('Cancel fulfillment for '+ref(o)+'? No refund or payment cancellation will be issued.'))return;
  const result=await send('/api/admin-orders',{action:'update',order_id:o.id,fulfillment_status:next.value,priority:priority.value,tracking_carrier:carrier.value,tracking_number:tracking.value,admin_notes:notes.value},'PATCH');await session.refresh();
  if(result.notification?.status==='failed')session.notice(result.notification.error||'Order saved, but customer notification failed.',true)});
 window.PureShippingLabels?.mount({host,row:o,api});exportSection(host,o,o)}
function mount(fn) {
 const hub = document.getElementById('fulfillment-hub');
 if (!hub) return;
 if (root && (root !== hub || api !== fn)) close();
 root = hub;
 api = fn;
 if (!poll) poll = setInterval(() => {
  if (root && !document.hidden && !root.closest('[hidden]') && !dlg?.open && !root.contains(document.activeElement)) load();
 }, 60000);
 return load();
}
window.AltaFulfillment={manage:detail,mount,refresh:load,clear:close,openPayments(){},paymentDesk(){}};
})();
