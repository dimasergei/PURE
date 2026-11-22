'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {checkoutCampaign,campaignUnits}=require('../lib/campaign-window');
const products=JSON.parse(JSON.stringify(vm.runInNewContext(fs.readFileSync('products.js','utf8')+';CATALOG')));
const now=Date.parse('2026-11-22T20:00:00Z');
const env={BOGO_ENABLED:'true',BOGO_STARTS_AT:'2026-11-22T18:00:00Z',BOGO_ENDS_AT:'2026-11-25T18:00:00Z',BOGO_VARIANTS:'catalog'};

test('public catalog campaign matches every compound size and excludes supplies and equipment',()=>{
 const gear={id:'lab-rack',category:'equipment',variants:[{size:'9 slots'}]};
 const campaign=checkoutCampaign(env,now,[...products,gear]);
 const keys=products.filter(p=>p.category==='injectables').flatMap(p=>p.variants.map(v=>p.id+':'+v.size));
 assert.equal(campaign.scope,'catalog');assert.deepEqual(campaign.eligible_variants,keys);
 const lines=products.flatMap(p=>p.variants.map(v=>({id:p.id,size:v.size,qty:2})));
 assert.deepEqual(campaignUnits({lines},{},campaign),lines.filter(x=>keys.includes(x.id+':'+x.size)));
 for(const request of [{bulk_order:true},{research_builder_mode:'member_stack'}])assert.deepEqual(campaignUnits({lines},request,campaign),[]);
});

test('a limited selection and all off/time-window conditions are distinct from catalog mode',()=>{
 const variants=checkoutCampaign({...env,BOGO_VARIANTS:'bpc-157:5mg,ghk-cu:50mg,bac-3:3 mL,missing:2mg'},now,products);
 assert.equal(variants.scope,'selection');assert.deepEqual(variants.eligible_variants,['bpc-157:5mg','ghk-cu:50mg']);
 for(const overrides of [{BOGO_ENABLED:'false'},{BOGO_ENDS_AT:'2026-11-22T20:00:00Z'},{BOGO_STARTS_AT:'2026-11-25T06:00:00Z'},{BOGO_PREVIOUS_ENDS_AT:'2026-11-22T10:00:00Z'},{BOGO_VARIANTS:''}]){
  const campaign=checkoutCampaign({...env,...overrides},now,products);
  assert.equal(campaign.ends_at,null);assert.deepEqual(campaign.eligible_variants,[]);
 }
});
