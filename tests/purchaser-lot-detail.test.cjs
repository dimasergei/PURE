'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('purchase reports identify the exact shipped line and separate lots from total BOGO quantity',async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://getpurelabs.test/account/purchases',runScripts:'outside-only'});
 const w=dom.window, root=w.document.querySelector('main');
 const order={id:'00000000-0000-4000-8000-000000000001',status:'delivered',created_at:'2026-11-22',total_cents:1234,currency:'USD',
   shipments:[{variant_key:'tirzepatide|40mg',name:'Tirzepatide',size:'40mg',qty:2,bogo_free_qty:1},
    {variant_key:'gift-bac-3|3 mL',name:'Complimentary BAC Water',size:'3 mL',qty:1}],
   coas:[{variant_key:'tirzepatide|40mg',lot_number:'A',report_id:'REP-A',verification_url:'https://example.test/a'},
    {variant_key:'tirzepatide|40mg',lot_number:'B',report_id:'REP-B',verification_url:'https://example.test/b'},
    {variant_key:'gift-bac-3|3 mL',lot_number:'C',report_id:'REP-C',verification_url:'https://example.test/c'},
    {variant_key:'unrelated|5mg',lot_number:'D',report_id:'BLOCKED',verification_url:'javascript:alert(1)'}]};
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}};
 w.fetch=async()=>({ok:true,json:async()=>({invoices:[order]})});
 try{
  w.eval(fs.readFileSync(require.resolve('../direct-checkout-client.js'),'utf8'));
  await w.DirectCheckout.orders(root,auth,{});
  const groups=root.querySelectorAll('.dc-shipment-certificate-group');
  assert.equal(groups.length,2);
  assert.match(groups[0].textContent,/Tirzepatide · 40mg2 shipped \(1 free\)/);
  assert.equal(groups[0].querySelectorAll('a').length,2);
  assert.match(groups[1].textContent,/Complimentary BAC Water · 3 mL1 shipped/);
  assert.equal(groups[1].querySelector('a').href,'https://example.test/c');
  assert.doesNotMatch(root.textContent,/BLOCKED/);
  order.status='processing';
  await w.DirectCheckout.orders(root,auth,{});
  assert.equal(root.querySelector('.dc-shipment-certificates'),null);
 }finally{w.close();}
});
