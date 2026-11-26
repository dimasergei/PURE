"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const checkout=require('../config/checkout.json'),plans=require('../config/conversion.json').plans;
const zones=require('../config/shipping-zones.json');
function buildShippingPolicy(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pure-shipping-policy-'));
 try{
  for(const file of ['shipping-policy.html','refund-policy.html'])fs.copyFileSync(file,path.join(temp,file));
  execFileSync(process.execPath,[path.resolve('manual-policy-build.cjs')],{cwd:temp});
  return fs.readFileSync(path.join(temp,'shipping-policy.html'),'utf8');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
test('published shipping terms match current standard pricing and the after-coupon free-shipping threshold',()=>{
 const policy=buildShippingPolicy(),terms=fs.readFileSync('commercial-terms.html','utf8');
 assert.equal(checkout.free_shipping_threshold_cents,25000);
 for(const [name,text]of Object.entries({policy,terms})){
  assert.match(text,/US\$250/,name);assert.match(text,/US\$11\.95/,name);
  assert.doesNotMatch(text,/International checkout is unavailable|US delivery only|annual passes/i,name);
 }
 for(const country of ['US','CA'])for(const [service,cents] of Object.entries(zones[country])){
  assert.ok(policy.includes('<td data-shipping-rate="'+country+'.'+service+'">US$'+(cents/100).toFixed(2)+'</td>'));
 }
 assert.match(policy,/Economy and standard shipping in the U\.S\. and Canada, plus U\.S\. express/);
 assert.match(policy,/after discounts, before points or store credit/);assert.match(terms,/after applicable discounts, before points or store credit/);
 assert.match(policy,/international rates/i);assert.match(policy,/After dispatch, check your shipment email for tracking details/);
 assert.match(terms,/BLACKFRIDAY10/);assert.match(terms,/10% off the merchandise subtotal/);
 assert.match(terms,/PURE WHITE and PURE BLACK memberships include standard or express shipping to US addresses/);
 for(const key of ['vip','elite'])assert.ok(terms.includes(plans[key].name+' earns '+plans[key].points_per_dollar+' points per US$1'));
 assert.ok(terms.includes('PURE BLACK receives US$'+plans.elite.monthly_credit_cents/100+' store credit'));
 assert.match(terms,/at most once per UTC calendar month/);assert.match(terms,/USD points and store credit cannot be redeemed against a CAD payment or a membership fee/);
 assert.doesNotMatch(terms,/New orders do not earn points|Store credit is issued explicitly by staff/);
});
