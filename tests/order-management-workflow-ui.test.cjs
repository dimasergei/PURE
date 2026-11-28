'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('admin-fulfillment.js','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const id='00000000-0000-4000-8000-000000000091';
function fixture(status='accepted',overrides={}){
 const row={id,source:'commerce',kind:'goods',commerce_status:status,payment_status:status==='accepted'?'pending':'paid',order_number:'ORD-TEST91',customer_name:'Fixture customer',customer_email:'fixture@example.test',total_cents:12255,currency:'USD',created_at:'2026-11-16T06:27:25Z'};
 const order={...row,status,version:7,checkout_version:2,method_id:'wire-us',pricing:{lines:[{name:'BPC-157',size:'10mg',qty:4,line_total_cents:10800}]},request_data:{items:[{id:'bpc-157',size:'10mg',qty:4}],address:{line1:'123 Example Street',city:'Miami',region:'FL',postal_code:'33101',country:'US'}},tracking_carrier:status==='shipped'?'UPS':'',tracking_number:status==='shipped'?'TRACK-EXISTING':''};
 return{row,detail:{order,allocations:[],jobs:[],mappings:[],supplier_enabled:false,manual_payment_allowed:false,history:[],...overrides}};
}
async function setup(t,{row,detail,fetchDetail},writeImpl){
 const dom=new JSDOM('<p id="orders-message"></p><div id="fulfillment-hub"></div>',{url:'https://altapurelabs.com/admin-orders.html',runScripts:'outside-only'}),w=dom.window,calls=[],downloads=[],objectURLs=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;
 w.URL.createObjectURL=blob=>{objectURLs.push(blob);return'blob:fixture-'+objectURLs.length};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,href:this.href})};
 w.eval(source);w.AltaFulfillment.mount(async(url,options)=>{calls.push({url,options});if(options?.body)return writeImpl?writeImpl(JSON.parse(options.body),calls):{saved:true};if(options?.responseType==='blob')return new w.Blob(['fixture document']);if(url.includes('view=fulfillment_quote'))return detail.quoteBasis;if(url.includes('view=manual_pilot')){if(detail.pilotResult instanceof Error)throw detail.pilotResult;return detail.pilotResult}if(url.includes('view=detail'))return fetchDetail?fetchDetail(url):detail;return{orders:[row],pagination:{page:1,total:1}}});
 t.after(()=>{w.AltaFulfillment.clear();w.close()});await tick();await w.AltaFulfillment.manage(row);
 return{w,calls,downloads,objectURLs,form:title=>[...w.document.querySelectorAll('dialog form')].find(f=>f.querySelector('h4')?.textContent===title),button:title=>[...w.document.querySelectorAll('dialog button')].find(b=>b.textContent===title),writes:()=>calls.filter(c=>c.options?.body).map(c=>JSON.parse(c.options.body))};
}
const submit=f=>f.onsubmit({preventDefault(){}});
const field=(f,name,value)=>{f.elements.namedItem(name).value=value};
function manual(status='pending'){return[{variant_key:'bpc-157|10mg',route:'manual',supplier_name:'99Purity Peptides',status,version:4},{variant_key:'ghk-cu|50mg',route:'manual',supplier_name:'99Purity Peptides',status,version:3}]}

test('received-payment control requires server permission, not merely an unpaid invoice',async t=>{
 const denied=await setup(t,fixture());assert.equal(denied.form('Confirm received bank payment'),undefined);assert.match(denied.w.document.querySelector('dialog').textContent,/Awaiting confirmed payment/);
 const allowed=await setup(t,fixture('accepted',{manual_payment_allowed:true,payment_method:{label:'US wire'}}));const f=allowed.form('Confirm received bank payment');assert.ok(f);assert.match(f.textContent,/\$122\.55/);assert.match(f.textContent,/US wire/);assert.equal(f.querySelector('input[type=checkbox]').required,true);
});
test('accepted card orders can reconcile or cancel without a separate payment dashboard',async t=>{
 const ctx=await setup(t,fixture('accepted',{card_gateway:true,card_reversals:true,card_attempt:{state:'redirected'}}),body=>
  body.action==='cancel_order'?{status:'void',payment_state:'canceled'}:{status:'accepted',payment_state:'awaiting_payment'});
 await ctx.button('Sync Stripe status').onclick();
 assert.deepEqual(ctx.writes(),[{action:'reconcile_card_order',id,version:7}]);
 ctx.w.confirm=()=>false;
 await ctx.button('Cancel unpaid order').onclick();
 assert.equal(ctx.writes().length,1);
 ctx.w.confirm=()=>true;
 await ctx.button('Cancel unpaid order').onclick();
 assert.deepEqual(ctx.writes()[1],{action:'cancel_order',id,confirm_unpaid:true});
 assert.match(ctx.w.document.querySelector('dialog [data-unified-message]').textContent,/Stripe payment and PURE order canceled/);
});
test('paid card orders confirm the exact amount before an actual Stripe refund',async t=>{
 const ctx=await setup(t,fixture('paid',{card_gateway:true,card_reversals:true,card_attempt:{state:'paid'}}),()=>({status:'paid',payment_state:'refund_pending'}));
 assert.equal(ctx.button('Cancel unpaid order'),undefined);
 assert.equal(ctx.form('Record a completed full refund'),undefined);
 ctx.w.confirm=()=>false;
 await ctx.button('Issue full card refund').onclick();
 assert.equal(ctx.writes().length,0);
 ctx.w.confirm=message=>{assert.match(message,/\$122\.55 USD.*ORD-TEST91/);return true;};
 await ctx.button('Issue full card refund').onclick();
 assert.deepEqual(ctx.writes(),[{action:'refund_card_order',id,version:7,confirm_full_refund:true}]);
 assert.match(ctx.w.document.querySelector('dialog [data-unified-message]').textContent,/Stripe is processing this refund/);
});
test('payment action verifies confirmation and retains receipt across a failed retry',async t=>{
 let attempts=0;const ctx=await setup(t,fixture('accepted',{manual_payment_allowed:true}),()=>{attempts++;if(attempts===1)throw Error('Temporary connection failure');return{saved:true}}),f=ctx.form('Confirm received bank payment');field(f,'bank_reference','BANK-EXAMPLE-123');
 await submit(f);assert.equal(ctx.writes().length,0);assert.match(ctx.w.document.querySelector('[data-unified-message]').textContent||ctx.w.document.querySelector('dialog').textContent,/Verify received funds first/);
 f.querySelector('input[type=checkbox]').checked=true;ctx.w.confirm=()=>false;await submit(f);assert.equal(ctx.writes().length,0);
 ctx.w.confirm=()=>true;await submit(f);await submit(f);const writes=ctx.writes();assert.equal(writes.length,2);assert.equal(writes[0].receipt_id,writes[1].receipt_id);assert.match(writes[0].receipt_id,/^[0-9a-f-]{36}$/i);
 assert.deepEqual({...writes[0],receipt_id:undefined},{action:'record_payment',id,expected_version:7,method_id:'wire-us',receipt_id:undefined,external_reference:'BANK-EXAMPLE-123',confirm_funds_received:true});
});
test('separately opened payment forms use independent receipt identifiers',async t=>{
 const ctx=await setup(t,fixture('accepted',{manual_payment_allowed:true}),()=>{throw Error('Fixture failure')});let f=ctx.form('Confirm received bank payment');field(f,'bank_reference','BANK-FIRST');f.querySelector('[type=checkbox]').checked=true;await submit(f);
 await ctx.w.AltaFulfillment.manage(fixture().row);f=ctx.form('Confirm received bank payment');field(f,'bank_reference','BANK-SECOND');f.querySelector('[type=checkbox]').checked=true;await submit(f);
 assert.notEqual(ctx.writes()[0].receipt_id,ctx.writes()[1].receipt_id);
});
test('generic fulfillment sheets use the authenticated API wrapper with blob responses and no writes',async t=>{
 const ctx=await setup(t,fixture());await ctx.button('Download PDF').onclick();await ctx.button('Download CSV').onclick();
 assert.equal(ctx.writes().length,0);assert.equal(ctx.objectURLs.length,2);assert.deepEqual(ctx.downloads.map(d=>d.name),['fulfillment-ORD-TEST91.pdf','fulfillment-ORD-TEST91.csv']);
 const exports=ctx.calls.filter(c=>c.options?.responseType==='blob');assert.equal(exports.length,2);for(const c of exports){const url=new URL(c.url,'https://altapurelabs.com');assert.equal(url.pathname,'/api/admin-orders');assert.equal(url.searchParams.get('view'),'fulfillment-sheet');assert.equal(url.searchParams.get('source'),'commerce');assert.equal(url.searchParams.get('id'),id)}assert.match(ctx.w.document.querySelector('.uc-export').textContent,/HOLD \/ DO NOT SHIP/);assert.equal(ctx.w.document.querySelector('.uc-export h4').textContent,'Fulfillment sheet');assert.doesNotMatch(ctx.w.document.querySelector('.uc-export').textContent,/99Purity|Lotus|supplier/i);
});
test('manual shipment is a complete-order transition and refuses blank tracking',async t=>{
 const ctx=await setup(t,fixture('paid',{allocations:manual()})),f=ctx.form('Update complete order');assert.ok(f);assert.deepEqual([...f.elements.namedItem('status').options].map(o=>o.value),['processing','shipped']);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/Update line ·|Save line status/);
 field(f,'status','shipped');field(f,'note','Shipment handed to carrier');await submit(f);assert.equal(ctx.writes().length,0);
 field(f,'carrier','UPS');field(f,'tracking','1Z-FIXTURE-123');await submit(f);assert.deepEqual(ctx.writes()[0],{action:'update_order',id,version:7,status:'shipped',note:'Shipment handed to carrier',tracking_carrier:'UPS',tracking_number:'1Z-FIXTURE-123'});
});
test('shipped manual order supports delivery and tracking correction separately',async t=>{
 const ctx=await setup(t,fixture('shipped',{allocations:manual('shipped')}));let f=ctx.form('Correct shipment tracking');assert.ok(f);field(f,'carrier','UPS');field(f,'tracking','1Z-CORRECTED-456');field(f,'note','Correct transposed tracking number');await submit(f);
 assert.deepEqual(ctx.writes()[0],{action:'update_tracking',id,version:7,tracking_carrier:'UPS',tracking_number:'1Z-CORRECTED-456',note:'Correct transposed tracking number'});
 f=ctx.form('Update complete order');assert.deepEqual([...f.elements.namedItem('status').options].map(o=>o.value),['delivered']);field(f,'note','Delivery confirmed by carrier');await submit(f);assert.equal(ctx.writes()[1].action,'update_order');assert.equal(ctx.writes()[1].status,'delivered');
});
test('historical integration orders cannot offer a duplicate manual shipment',async t=>{
 const allocations=[{variant_key:'bpc-157|10mg',route:'lotus',supplier_name:'Lotus',status:'pending',version:1}],jobs=[{supplier_id:'lotus-fixture',status:'submitted',provider_status:'owed',reference:'ALTA-FIXTURE',has_payload:true}];
 const pending=await setup(t,fixture('processing',{allocations,jobs}));assert.equal(pending.form('Update complete order'),undefined);assert.equal(pending.form('Correct shipment tracking'),undefined);assert.equal(pending.form('Send shipping label to Lotus'),undefined);assert.doesNotMatch(pending.w.document.querySelector('dialog').textContent,/Update line ·/);
 const shipped=await setup(t,fixture('shipped',{allocations:[{...allocations[0],status:'shipped'}],jobs:[{...jobs[0],status:'shipped',provider_status:'shipped'}]}));assert.equal(shipped.form('Correct shipment tracking'),undefined);assert.deepEqual([...shipped.form('Update complete order').elements.namedItem('status').options].map(o=>o.value),['delivered']);
});
test('historical supplier data remains hidden while duplicate shipment controls stay blocked',async t=>{
 const ctx=await setup(t,fixture('processing',{supplier_enabled:true,allocations:[{variant_key:'bpc-157|10mg',route:'lotus',status:'pending',version:1}],jobs:[{supplier_id:'lotus-fixture',status:'submitted',provider_status:'paid',reference:'ALTA-FIXTURE',has_payload:true}]}));
 const text=ctx.w.document.querySelector('dialog').textContent;
 assert.equal(ctx.w.document.querySelector('.uc-supplier'),null);assert.doesNotMatch(text,/Previous supplier record|ALTA-FIXTURE|99Purity|Lotus/i);assert.match(text,/existing fulfillment record needs review/i);assert.match(text,/Fulfillment has already started/);
 for(const label of ['Check Lotus availability & cost','Attach label to Lotus order','Assign complete order to Lotus','Retry Lotus job','Request supplier cancellation'])assert.equal(ctx.button(label),undefined,label);
 assert.equal(ctx.form('Assign complete order to 99Purity Peptides'),undefined);assert.equal(ctx.form('Update complete order'),undefined);assert.equal(ctx.writes().length,0);
});
test('activity history treats notes, references and actor names as text',async t=>{
 const payload='<img src=x onerror="window.INJECTED=1">',ctx=await setup(t,fixture('paid',{history:[{action:'payment_received',actor:payload,note:payload,reference:payload,from:'accepted',to:'paid',created_at:'2026-11-16T07:00:00Z'}]}));
 const history=[...ctx.w.document.querySelectorAll('details.uc-history')].find(x=>x.querySelector('summary')?.textContent==='Activity history');assert.ok(history);assert.match(history.textContent,/Activity history/);assert.ok(history.textContent.includes(payload));assert.equal(history.querySelector('img'),null);assert.equal(ctx.w.INJECTED,undefined);assert.match(history.textContent,/Awaiting payment → Paid/);
});
test('supplier assignment history uses a generic summary while retaining ordinary order history',async t=>{
 const ctx=await setup(t,fixture('paid',{history:[
  {action:'fulfillment_assign',actor:'Lotus worker',note:'Send full order to 99Purity Peptides',reference:'99P-SUPPLIER-123',created_at:'2026-11-16T07:00:00Z'},
  {action:'lotus_manual_takeover',actor:'Lotus',note:'Lotus cancellation was confirmed',reference:'LOTUS-123',created_at:'2026-11-16T07:01:00Z'},
  {action:'edit_shipping',actor:'admin',note:'Apartment number corrected',created_at:'2026-11-16T07:02:00Z'},
  {action:'payment_received',actor:'admin',reference:'BANK-ORDER-123',from:'accepted',to:'paid',created_at:'2026-11-16T07:03:00Z'}
 ]}));
 const history=[...ctx.w.document.querySelectorAll('details.uc-history')].find(x=>x.querySelector('summary')?.textContent==='Activity history');
 assert.equal(history.querySelectorAll('.uc-history-item').length,4);assert.match(history.textContent,/Fulfillment record updated/);assert.match(history.textContent,/Apartment number corrected/);assert.match(history.textContent,/BANK-ORDER-123/);assert.match(history.textContent,/Awaiting payment → Paid/);assert.doesNotMatch(history.textContent,/99Purity|Lotus|99P-SUPPLIER-123/i);assert.equal(ctx.writes().length,0);
});
function apiWrapper(fetch,logout=()=>{}){const html=fs.readFileSync('admin-orders.html','utf8'),start=html.indexOf('    async function api(path, options = {}) {'),end=html.indexOf('    async function loadOrders()',start);assert.ok(start>=0&&end>start);return new Function('window','logout',html.slice(start,end)+'\nreturn api;')({PureAdminAuth:{fetch}},logout)}
test('admin API blob mode uses the shared authenticated client without forwarding responseType',async()=>{
 const blob={fixture:true};let seen;const api=apiWrapper(async(path,options)=>{seen={path,options};return{ok:true,status:200,blob:async()=>blob,json:()=>{throw Error('Do not parse a binary download as JSON')}}});
 assert.equal(await api('/api/admin-orders?view=fulfillment-sheet',{responseType:'blob',headers:{Accept:'application/pdf'}}),blob);assert.equal(seen.path,'/api/admin-orders?view=fulfillment-sheet');assert.equal(seen.options.headers.Accept,'application/pdf');assert.equal('responseType'in seen.options,false);
});
test('admin API binary download errors still enforce logout and readable JSON errors',async()=>{
 let loggedOut=false;const expired=apiWrapper(async()=>({ok:false,status:401,json:async()=>({error:'Unauthorized'})}),()=>{loggedOut=true});await assert.rejects(()=>expired('/export',{responseType:'blob'}),/Session rejected/);assert.equal(loggedOut,true);
 const rejected=apiWrapper(async()=>({ok:false,status:409,json:async()=>({error:'No physical fulfillment order'})}));await assert.rejects(()=>rejected('/export',{responseType:'blob'}),/No physical fulfillment order/);
});
test('unpaid orders keep generic preparation and payment controls without supplier panels or writes',async t=>{
 const ctx=await setup(t,fixture('accepted',{supplier_enabled:true,manual_payment_allowed:true}));
 assert.equal(ctx.w.document.querySelector('.uc-supplier'),null);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/99Purity|Lotus|supplier/i);assert.match(ctx.w.document.querySelector('.uc-export').textContent,/HOLD \/ DO NOT SHIP/);
 assert.match(ctx.form('Confirm received bank payment').textContent,/Verify that the full amount has arrived/);assert.equal(ctx.form('Update complete order'),undefined);assert.equal(ctx.button('Check Lotus availability & cost'),undefined);assert.equal(ctx.writes().length,0);
});
test('stale Lotus enable flag and mappings cannot expose supplier submission actions',async t=>{
 const allocations=manual(),ctx=await setup(t,fixture('paid',{supplier_enabled:true,allocations,mappings:allocations.map(a=>({variant_key:a.variant_key,verified_at:'2026-11-11'}))}));
 const labels=[...ctx.w.document.querySelectorAll('dialog button')].map(b=>b.textContent).join(' | ');
 assert.doesNotMatch(labels,/Lotus|supplier cancellation/);assert.equal(ctx.form('Assign complete order to 99Purity Peptides'),undefined);assert.equal(ctx.w.document.querySelector('.uc-supplier'),null);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/99Purity|Lotus|supplier/i);assert.equal(ctx.writes().length,0);
});
test('confirmed previous cancellation allows complete manual shipment without restoring supplier assignment',async t=>{
 const ctx=await setup(t,fixture('processing',{allocations:manual().map(a=>({...a,supplier_name:'Previous supplier'})),jobs:[{supplier_id:'old-lotus',reference:'OLD-LOTUS',has_payload:true,status:'cancelled',provider_status:'cancelled',takeover_requested:true}],mappings:[{variant_key:'bpc-157|10mg',verified_at:'2026-11-11'},{variant_key:'ghk-cu|50mg',verified_at:'2026-11-11'}]}));
 const f=ctx.form('Update complete order');assert.ok(f,'Manual dispatch should remain manageable after confirmed supplier cancellation');assert.deepEqual([...f.elements.namedItem('status').options].map(o=>o.value),['shipped']);assert.equal(ctx.form('Assign complete order to 99Purity Peptides'),undefined);assert.equal(ctx.form('Route complete order to Lotus'),undefined);assert.equal(ctx.form('Edit shipping address'),undefined);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/Previous supplier|OLD-LOTUS|99Purity/i);
});
test('manual fulfillment with no named supplier can record actual dispatch with tracking',async t=>{
 const ctx=await setup(t,fixture('processing',{allocations:manual().map(a=>({...a,supplier_name:''}))})),f=ctx.form('Update complete order');assert.ok(f);assert.deepEqual([...f.elements.namedItem('status').options].map(o=>o.value),['shipped']);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/assign.*supplier/i);
 field(f,'carrier','Canada Post');field(f,'tracking','CA-FIXTURE-123');field(f,'note','All items packed and dispatched');await submit(f);assert.deepEqual(ctx.writes(),[{action:'update_order',id,version:7,status:'shipped',note:'All items packed and dispatched',tracking_carrier:'Canada Post',tracking_number:'CA-FIXTURE-123'}]);
});


const pilotLot={lot_number:'LAB-07',report_id:'LAB-426',document_id:'00000000-0000-4000-8000-000000000007',verification_url:'https://example.test/report/426',lab_name:'Example Lab'};
function pilotOrder(status, overrides={}){
 const details={eligible:true,writable:true,lots:[pilotLot],gift_lots:[{lot_number:'BW-05'}],record:null,paid_qty:1,free_qty:1,gift_qty:1,receipts_cents:16158,commission_cents:6145,ready_to_ship:false,...overrides};
 return fixture(status,{allocations:[{variant_key:'tirzepatide|40mg',route:'manual'}],manual_pilot_eligible:true,pilotResult:details});
}
test('eligible orders save an exact lot and gift with no placeholder costs, and retain paid/free counts',async t=>{
 const ctx=await setup(t,pilotOrder('paid')),section=ctx.w.document.querySelector('.uc-pilot'),f=section.querySelector('form');
 assert.match(section.textContent,/1 paid \+ 1 free · 1 recon gift/);
 assert.equal(ctx.form('Packed lot certificates'),undefined);
 assert.deepEqual([...ctx.form('Update complete order').elements.namedItem('status').options].map(o=>o.value),['processing']);
 assert.equal(f.elements.namedItem('delivered_cost_cents').value,'');
 const choose=f.elements.namedItem('pilot_document_id');
 choose.value=pilotLot.document_id;choose.dispatchEvent(new ctx.w.Event('change'));
 assert.equal(section.querySelector('a').href,pilotLot.verification_url);
 field(f,'gift_lot_number','BW-05');await submit(f);
 assert.deepEqual(ctx.writes(),[{action:'save_manual_pilot',id,revision:0,lot_number:pilotLot.lot_number,report_id:pilotLot.report_id,document_id:pilotLot.document_id,gift_lot_number:'BW-05'}]);
});
test('unverified, withdrawn and unavailable lot evidence keeps dispatch off the status menu',async t=>{
 for(const testResult of [null,new Error('Unable to read evidence')]){
  const fix=pilotOrder('processing',{lots:[],record:{revision:4,lot_number:'OLD'}});
  if(testResult)fix.detail.pilotResult=testResult;
  const ctx=await setup(t,fix);
  assert.equal(ctx.form('Update complete order'),undefined);
  assert.match(ctx.w.document.querySelector('dialog').textContent,/No released lot|packing record could not be loaded/);
  assert.equal(ctx.writes().length,0);
 }
});
test('cost reconciliation requires all amounts, includes explicit zero, and keeps the recorded shipment lot fixed',async t=>{
 const record={revision:4,...pilotLot,gift_lot_number:'BW-05'};
 const ctx=await setup(t,pilotOrder('shipped',{record,ready_to_ship:true})),f=ctx.w.document.querySelector('.uc-pilot form');
 assert.equal(f.elements.namedItem('pilot_document_id'),null);assert.equal(f.elements.namedItem('gift_lot_number'),null);
 assert.equal(ctx.form('Update complete order').elements.namedItem('status').value,'delivered');
 field(f,'delivered_cost_cents','56.35');await submit(f);
 assert.equal(ctx.writes().length,0);
 for(const [key,value] of [['processing_fee_cents','5.96'],['overhead_cents','30'],['loss_allowance_cents','0'],['cost_reference','INV-123; payout F002']])field(f,key,value);
 await submit(f);
 assert.deepEqual(ctx.writes(),[{action:'save_manual_pilot',id,revision:4,lot_number:'LAB-07',report_id:'LAB-426',document_id:pilotLot.document_id,gift_lot_number:'BW-05',delivered_cost_cents:5635,processing_fee_cents:596,overhead_cents:3000,loss_allowance_cents:0,cost_reference:'INV-123; payout F002'}]);
});
test('only server-ready pilot orders expose dispatch and a recorded margin, untrusted report links cannot navigate',async t=>{
 const item={...pilotLot,verification_url:'javascript:alert(1)'},record={...item,revision:4,gift_lot_number:'BW-05',delivered_cost_cents:5635,processing_fee_cents:596,overhead_cents:3000,loss_allowance_cents:0,cost_reference:'REF',profit_cents:783,margin_bps:485};
 const ctx=await setup(t,pilotOrder('processing',{lots:[item],record,ready_to_ship:true}));
 assert.equal(ctx.form('Update complete order').elements.namedItem('status').value,'shipped');
 assert.match(ctx.w.document.querySelector('.uc-pilot-result').textContent,/\$7.83.*4.8|\$7.83.*4.9/);
 assert.equal(ctx.w.document.querySelector('.uc-pilot-report a'),null);assert.equal(ctx.writes().length,0);
});
test('other orders use the existing packed lots path without requesting pilot details',async t=>{
 const ctx=await setup(t,fixture('paid',{allocations:manual()}));
 assert.ok(ctx.form('Packed lot certificates'));assert.equal(ctx.w.document.querySelector('.uc-pilot'),null);
 assert.equal(ctx.calls.filter(c=>c.url.includes('view=manual_pilot')).length,0);
});

test('a paid order opens one private quote check with explicit costs, a whole-cent margin limit and no writes',async t=>{
 const ctx=await setup(t,fixture('paid',{quoteBasis:{available:true,currency:'CAD',receipts_cents:10001,commission_cents:4000,commission_usd_cents:2857,paid_units:2,free_units:3}}));
 const box=[...ctx.w.document.querySelectorAll('dialog details')].find(d=>d.querySelector('summary')?.textContent==='Check fulfillment quote');
 assert.ok(box);assert.equal(box.open,false);assert.ok(!ctx.calls.some(c=>c.url.includes('view=fulfillment_quote')));
 box.open=true;box.dispatchEvent(new ctx.w.Event('toggle'));await tick();
 const set=(name,value)=>{const input=box.querySelector('[name="'+name+'"]');input.value=value;input.dispatchEvent(new ctx.w.Event('input',{bubbles:true}))};
 assert.match(box.textContent,/2 paid \+ 3 free/);assert.match(box.textContent,/USD at the invoice rate/);assert.match(box.textContent,/Enter all three costs/);
 set('processing','0');set('overhead','10.00');set('reserve','0');
 assert.match(box.textContent,/Maximum delivered quote for 15%CA\$35.00/);
 set('delivered','35.00');assert.match(box.textContent,/Meets 15% targetCA\$15.01/);
 set('delivered','35.01');assert.match(box.textContent,/Below 15% targetCA\$15.00/);
 set('delivered','50.01');assert.match(box.textContent,/Below 15% targetCA\$0.00/);
 set('delivered','50.02');assert.match(box.textContent,/Loss at this quote-CA\$0.01/);
 set('overhead','80.00');assert.match(box.textContent,/No qualifying quote/);assert.match(box.textContent,/Already below break-even/);
 set('reserve','');assert.doesNotMatch(box.textContent,/projected profit|No qualifying quote/);
 assert.equal(ctx.writes().length,0);
 const unpaid=await setup(t,fixture('accepted'));assert.doesNotMatch(unpaid.w.document.querySelector('dialog').textContent,/Check fulfillment quote/);
});

test('order sections preserve draft inputs and keep an address edit in context after saving',async t=>{
 const data=fixture('paid',{allocations:manual()});
 const ctx=await setup(t,data,body=>{
  if(body.action==='edit_shipping')data.detail.order.request_data.address=body.address;
  return {saved:true};
 });
 const dialog=ctx.w.document.querySelector('dialog');
 const tab=name=>dialog.querySelector('#uc-tab-'+name);
 const panel=name=>dialog.querySelector('#uc-panel-'+name);
 assert.equal(tab('Summary').getAttribute('aria-selected'),'true');
 assert.equal(panel('Shipping').hidden,true);
 dialog.querySelector('[aria-label="Edit shipping address"]').click();
 const task=panel('Shipping').querySelector('[data-shipping-task="address"]');
 assert.equal(task.open,true);
 assert.equal(ctx.w.document.activeElement,task.querySelector('summary'));
 assert.equal(panel('Shipping').hidden,false);
 const form=task.querySelector('form');
 field(form,'city','Tampa');
 tab('Payment').click();
 assert.equal(panel('Shipping').hidden,true);
 tab('Payment').dispatchEvent(new ctx.w.KeyboardEvent('keydown',{key:'ArrowRight'}));
 assert.equal(ctx.w.document.activeElement,tab('Shipping'));
 assert.equal(form.elements.namedItem('city').value,'Tampa');
 field(form,'note','Customer confirmed address');
 await submit(form);
 assert.equal(ctx.writes()[0].action,'edit_shipping');
 assert.equal(tab('Shipping').getAttribute('aria-selected'),'true');
 assert.equal(panel('Shipping').querySelector('[data-shipping-task="address"]').open,true);
 tab('Summary').click();
 assert.match(panel('Summary').querySelector('.uc-address').textContent,/Tampa/);
 assert.equal(ctx.writes().length,1);
});

test('a completed payment action cannot reopen an order or notify a different order',async t=>{
 let finish;
 const ctx=await setup(t,fixture('paid',{card_reversals:true,card_attempt:{state:'paid'}}),()=>new Promise(resolve=>{finish=resolve}));
 const dialog=ctx.w.document.querySelector('dialog');
 ctx.button('Payment').click();
 const pending=ctx.button('Issue full card refund').onclick();
 dialog.close();
 const second={id:'record-b',source:'store',order_number:'P-SECOND',kind:'goods',currency:'USD',payment_status:'paid',fulfillment_status:'unfulfilled'};
 await ctx.w.AltaFulfillment.manage(second);
 finish({status:'refunded',payment_state:'refunded'});
 await pending;
 assert.equal(dialog.open,true);
 assert.equal(dialog.querySelector('h2').textContent,'P-SECOND');
 assert.equal(dialog.querySelector('[data-unified-message]').textContent,'');
});


test('a queued close event allows the next requested order to open',async t=>{
 const data=fixture('paid'),next=fixture('accepted');
 next.row.id=next.detail.order.id='order-b';
 next.row.order_number=next.detail.order.order_number='P-SECOND';
 let resolveNext;
 data.fetchDetail=url=>url.endsWith('id=order-b')?new Promise(resolve=>{resolveNext=resolve}):data.detail;
 const ctx=await setup(t,data);
 const dialog=ctx.w.document.querySelector('dialog');
 dialog.close();
 const opening=ctx.w.AltaFulfillment.manage(next.row);
 dialog.dispatchEvent(new ctx.w.Event('close'));
 resolveNext(next.detail);
 await opening;
 assert.equal(dialog.open,true);
 assert.equal(dialog.querySelector('h2').textContent,'P-SECOND');
});

test('an action refresh finishing before the queued close event keeps the order closed',async t=>{
 const data=fixture('accepted',{card_gateway:true,card_reversals:true,card_attempt:{state:'redirected'}});
 let delayRefresh=false,resolveRefresh;
 data.fetchDetail=()=>delayRefresh?new Promise(resolve=>{resolveRefresh=resolve}):data.detail;
 const ctx=await setup(t,data,()=>({status:'accepted',payment_state:'awaiting_payment'}));
 const dialog=ctx.w.document.querySelector('dialog');
 delayRefresh=true;
 const refreshing=ctx.button('Sync Stripe status').onclick();
 await tick();
 assert.equal(typeof resolveRefresh,'function');
 dialog.close();
 resolveRefresh(data.detail);
 await refreshing;
 assert.equal(dialog.open,false);
 dialog.dispatchEvent(new ctx.w.Event('close'));
 assert.equal(dialog.open,false);
});
