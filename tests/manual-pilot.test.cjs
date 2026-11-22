'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {eligible, state, save} = require('../lib/manual-pilot');

const id = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';
const item = {id:'tirzepatide',size:'40mg',qty:1};
const gift = {id:'gift-bac-3',size:'3 mL',qty:1,line_total_cents:0,campaign_gift:true};
const invoice = {id,kind:'goods',currency:'USD',status:'paid',request_data:{address:{country:'US'},items:[item]},
  pricing:{bogo_campaign:{free_units:[item]},bundled_items:[gift]}};
const lines = [
  {variant_key:'tirzepatide|40mg',route:'manual',item:{...item,qty:2,bogo_free_qty:1}},
  {variant_key:'gift-bac-3|3 mL',route:'manual',item:gift}
];
const packed = {id,revision:0,document_id:id,lot_number:'T40',report_id:'R40',gift_lot_number:'G1'};
test('exact manual pilot leaves other destinations, products and order modes alone',async()=>{
  assert.equal(eligible(invoice,lines),true);
  for(const overrides of [{address:{country:'CA'}},{bulk_order:true},{research_builder_mode:'member_stack'},
    {items:[item,{id:'retatrutide',size:'40mg',qty:1}]},{items:[{...item,size:'60mg'}]},{membership_addon:{plan:'elite'}}]){
    assert.deepEqual(await state({}, {...invoice,request_data:{...invoice.request_data,...overrides}},lines), {eligible:false});
  }
  assert.equal(eligible(invoice,[{...lines[0],route:'lotus'}]),false);
  assert.equal(eligible({...invoice,status:'accepted'},lines),false);
});
test('manual view preserves exactly purchased, free and complimentary gift quantities',async()=>{
  const db={rpc:async(name,payload)=>{
    assert.equal(name,'commerce_manual_pilot_state');assert.deepEqual(payload,{p_invoice:id});return {data:{eligible:true}};
  }};
  assert.deepEqual(await state(db,invoice,lines),{eligible:true,paid_qty:1,free_qty:1,gift_qty:1});
  await assert.rejects(state(db,invoice,[{...lines[0],item:{...lines[0].item,qty:1}},lines[1]]),/quantities/);
});
test('packing, complete cost updates and stale revision responses stay distinct',async()=>{
  let payload;
  const db={rpc:async(name,args)=>{assert.equal(name,'commerce_manual_pilot_save');payload=args.p_data;return {data:true};}};
  assert.deepEqual(await save(db,packed),{status:200,saved:true});
  assert.equal(Object.hasOwn(payload,'delivered_cost_cents'),false);
  assert.equal((await save(db,{...packed,delivered_cost_cents:10})).status,400);
  assert.equal((await save(db,{...packed,revision:-1})).status,400);
  assert.equal((await save(db,{...packed,document_id:null})).status,400);
  const financial={cost_reference:'Warehouse invoice #12',delivered_cost_cents:5635,processing_fee_cents:595,overhead_cents:3000,loss_allowance_cents:485};
  assert.equal((await save(db,{...packed,...financial})).status,200);
  assert.equal(payload.delivered_cost_cents,5635);
  assert.equal((await save(db,{...packed,...financial,processing_fee_cents:-1})).status,400);
  assert.equal((await save({rpc:async()=>({error:{code:'40001'}})},packed)).status,409);
});
