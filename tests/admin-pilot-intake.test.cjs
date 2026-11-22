'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('admin-pilot-intake.js','utf8'),tick=()=>new Promise(r=>setImmediate(r));
const supplier={id:'00000000-0000-4000-8000-000000000001',name:'Approved supplier',active:true};
const lot={id:'00000000-0000-4000-8000-000000000002',lot_number:'CT-100',sku_key:'tirzepatide-40mg',status:'quarantine',supplier_id:supplier.id,fulfillment_site:'US East'};
async function setup(t,{suppliers=[supplier],lots=[],onWrite}={}){
 const dom=new JSDOM('<body></body>',{url:'https://pure.test/admin-orders.html',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(source);const writes=[],fetches=[];
 const api=async(url,opts)=>{
  fetches.push(url);
  if(opts){const b=JSON.parse(opts.body);writes.push(b);return onWrite?onWrite(b):{saved:true,lot};}
  return url.includes('inventory=1')?{lots,quality_reports:[]}:{suppliers};
 };
 w.PurePilotIntake.open(api);await tick();
 t.after(()=>{w.PurePilotIntake.close();w.close();});
 return{w,api,doc:w.document,writes,fetches};
}
const put=(f,name,value)=>{f.elements.namedItem(name).value=value;};
const submit=f=>f.onsubmit({preventDefault(){}});
function fill(f){
 for(const [k,v] of Object.entries({sku_key:'tirzepatide-40mg',supplier_id:supplier.id,lot_number:'CT-100',on_hand:'9',fulfillment_site:'US East',supplier_evidence_reference:'invoice 5415'}))put(f,k,v);
}
test('opening stock intake only reads actual active suppliers and limits selection to both pilot SKUs',async t=>{
 const ctx=await setup(t,{suppliers:[supplier,{...supplier,id:lot.id,name:'Inactive company',active:false}]});
 assert.deepEqual(ctx.fetches,['/api/admin-suppliers','/api/admin-suppliers?inventory=1']);
 const f=ctx.doc.querySelector('form');
 assert.deepEqual([...f.sku_key?.options||f.elements.sku_key.options].map(o=>o.value),['','tirzepatide-40mg','bac-3-3-ml']);
 assert.doesNotMatch(f.textContent,/Inactive company/);assert.deepEqual(ctx.writes,[]);
 fill(f);await submit(f);assert.deepEqual(ctx.writes,[],'explicit confirmation is required');
});
test('report failure and retry reuse the receipted UUID and never receive stock twice',async t=>{
 let attempt=0;
 const ctx=await setup(t,{onWrite:b=>{
  if(b.action==='commit_inventory_intake')return{saved:true,lot};
  if(!attempt++)throw Error('Verification report temporarily unavailable');
  return{saved:true,report:{report_id:'COA-56',lot_id:lot.id,status:'pending'}};
 }});
 let f=ctx.doc.querySelector('form');fill(f);f.elements.confirm_receipt.checked=true;await submit(f);
 assert.equal(ctx.writes[0].rows[0].sku_key,'tirzepatide-40mg');assert.equal(ctx.writes[0].rows[0].on_hand,9);
 assert.equal(ctx.writes[0].confirm_quarantine_only,true);assert.match(ctx.doc.querySelector('[role=status]').textContent,/received in quarantine/);
 f=ctx.doc.querySelector('form');put(f,'report_id','COA-56');put(f,'lab_name','Lab ABC');put(f,'source_url','https://lab.example/verify/56');
 await submit(f);assert.match(ctx.doc.querySelector('[role=status]').textContent,/temporarily unavailable/);await submit(f);
 assert.equal(ctx.writes.filter(b=>b.action==='commit_inventory_intake').length,1);
 assert.deepEqual(ctx.writes[1],ctx.writes[2]);assert.equal(ctx.writes[1].report.lot_id,lot.id);
 assert.match(ctx.doc.querySelector('[role=status]').textContent,/Awaiting human review/);
 assert.match(ctx.doc.querySelector('.uc-intake-record').textContent,/COA-56 · Lab ABC · pending/);
 assert.equal(ctx.w.localStorage.length,0);
});
test('existing lots are available for report-only intake while duplicate lot receipt is a read',async t=>{
 const ctx=await setup(t,{lots:[lot]});const f=ctx.doc.querySelector('form');fill(f);f.elements.confirm_receipt.checked=true;await submit(f);
 assert.deepEqual(ctx.writes,[]);assert.match(ctx.doc.querySelector('[role=status]').textContent,/already has a receipt/);
 ctx.w.PurePilotIntake.close();ctx.w.PurePilotIntake.open(ctx.api);await tick();assert.equal(ctx.doc.querySelector('select[name=receipt]').value,lot.id);
 assert.equal(ctx.doc.querySelector('form').elements.namedItem('lot_number'),null);
});
test('operator can register the named supplier once and retry a failed gift receipt',async t=>{
 let received=0;const ctx=await setup(t,{suppliers:[],onWrite:b=>{
  if(b.name)return{supplier};
  if(!received++)throw Error('Network interruption');
  return{saved:true,lot:{...lot,sku_key:'bac-3-3-ml'}};
 }});
 const f=ctx.doc.querySelector('form');fill(f);put(f,'sku_key','bac-3-3-ml');put(f,'supplier_id','new');
 f.elements.supplier_id.dispatchEvent(new ctx.w.Event('change'));put(f,'new_supplier_name','Approved supplier');f.elements.confirm_receipt.checked=true;
 await submit(f);assert.equal(f.elements.supplier_id.value,supplier.id);await submit(f);
 assert.equal(ctx.writes.filter(w=>w.name).length,1);assert.equal(ctx.writes[2].rows[0].sku_key,'bac-3-3-ml');assert.equal(ctx.writes[2].rows[0].supplier_id,supplier.id);
});
test('published order screen registers the receiving script before the order controls',()=>{
 const build=fs.readFileSync('readiness-build.cjs','utf8'),hub=fs.readFileSync('admin-fulfillment.js','utf8');
 assert.match(build,/admin-pilot-intake\.js\?v=[^"]+"><\/script><script src="\/admin-fulfillment\.js/);
 assert.match(hub,/Receive pilot stock.*PurePilotIntake.open\(api\)/);
});
