'use strict';
const {version:VERSION,coupon:COUPON,coupon_discount_bps:RATE}=require('../config/checkout.json').promotions;
const CARD_TEST_COUPON = 'CARDTEST';
const CARD_TEST_RATE = 9800;
const CARD_TEST_MINIMUM_CENTS = 100;
function normalizeCoupon(value, allowCardTest = false){
 if(value===undefined||value===null||value==='')return '';
 if(typeof value!=='string'||value.length>40)throw Object.assign(Error('Enter a valid coupon code.'),{status:400});
 const code=value.trim().toUpperCase();
 if(code&&code!==COUPON&&!(allowCardTest&&code===CARD_TEST_COUPON))throw Object.assign(Error('That coupon code is not available.'),{status:400});
 return code;
}
function applyPromotions(pricing,kind,coupon='',affiliateRate=0,allowCardTest=false){
 const code=normalizeCoupon(coupon,allowCardTest);
 if(kind!=='goods')throw Object.assign(Error('Membership and subscription purchases are unavailable.'),{status:409});
 if(code===CARD_TEST_COUPON){
  if(pricing.lines.length!==1||pricing.lines[0].qty!==1||pricing.subtotal_cents<=CARD_TEST_MINIMUM_CENTS)
   throw Object.assign(Error('CARDTEST requires one item priced above US$1.00.'),{status:400});
  const savings=Math.min(Math.round(pricing.subtotal_cents*CARD_TEST_RATE/10000),pricing.subtotal_cents-CARD_TEST_MINIMUM_CENTS);
  const line=pricing.lines[0];
  pricing.lines=[{...line,discount_cents:savings,discount_bps:CARD_TEST_RATE,discount_reason:'coupon_cardtest',
   bogo_free_units:0,coupon_discount_cents:savings,line_total_cents:line.gross_cents-savings}];
  return Object.assign(pricing,{promotion_version:VERSION,coupon_code:code,discount_cents:savings,bogo_free_units:0,coupon_discount_cents:savings});
 }
 return allocatePromotion(pricing,code,code?RATE:affiliateRate,code?'coupon_blackfriday10':affiliateRate?'coupon_affiliate':'none',VERSION);
}
function allocatePromotion(pricing,code,rate,reason,version){
 const savings=Math.round(pricing.subtotal_cents*rate/10000);
 const discounts=pricing.lines.map(line=>Math.floor(line.gross_cents*rate/10000));
 // Allocate rounded subtotal savings without losing cents or changing quantities.
 const pennies=savings-discounts.reduce((sum,value)=>sum+value,0);
 const ranked=pricing.lines.map((line,index)=>({index,remainder:line.gross_cents*rate%10000}))
  .sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
 for(let i=0;i<pennies;i++)discounts[ranked[i].index]++;
 pricing.lines=pricing.lines.map((line,index)=>{
  const discount=discounts[index];
  return {...line,discount_cents:discount,discount_bps:rate,discount_reason:reason,bogo_free_units:0,coupon_discount_cents:discount,line_total_cents:line.gross_cents-discount};
 });
 pricing.promotion_version=version;pricing.coupon_code=code;pricing.discount_cents=savings;pricing.bogo_free_units=0;pricing.coupon_discount_cents=savings;
 return pricing;
}
function applyStoredInteracPromotion(pricing,coupon){
 if(coupon==='BLACKFRIDAY15')
  return allocatePromotion(pricing,coupon,1500,'coupon_blackfriday15','blackfriday15-2026-11-v1');
 return applyPromotions(pricing,'goods',coupon);
}
module.exports={VERSION,CARD_TEST_COUPON,normalizeCoupon,applyPromotions,applyStoredInteracPromotion};
