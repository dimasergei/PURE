'use strict';

const {physicalOrderLines}=require('./physical-order-lines');
const cents=value=>Number.isSafeInteger(value)&&value>=0;
const unavailable=reason=>({available:false,reason});
const paidStates=new Set(['paid','processing','shipped','delivered']);

function orderBasis(order,referral) {
  if(order.kind!=='goods'||!paidStates.has(order.status)||order.cancellation_status||!order.paid_at||
      !['USD','CAD'].includes(order.currency))return unavailable('A settled goods order is required.');
  const receipts=order.commerce_receipts;
  if(!cents(order.total_cents)||!cents(order.tax_cents)||!Array.isArray(receipts)||receipts.length!==1||
      receipts[0].kind!=='payment'||receipts[0].currency!==order.currency||receipts[0].amount_cents!==order.total_cents)
    return unavailable('The payment and invoice do not reconcile, or a refund was recorded.');

  const commission=order.commerce_partner_commissions;
  if(commission && (!cents(commission.amount_cents)||!['pending','eligible','paid'].includes(commission.status)))
    return unavailable('The partner commission was reversed or requires review.');
  if(!commission&&(order.pricing?.referral?.partner_id||referral&&(referral.first_invoice_id===order.id||
      Date.parse(referral.created_at)<=Date.parse(order.paid_at))))
    return unavailable('Attribution exists but the commission is missing from the ledger.');
  let commissionCents=commission?.amount_cents||0;
  if(commissionCents && order.currency==='CAD'){
    const rate=order.pricing?.fx?.fx_ppm;
    if(!Number.isSafeInteger(rate)||rate<1||rate!==order.pricing.fx_ppm)
      return unavailable('The invoice exchange rate for its USD commission is unavailable.');
    commissionCents=Number((BigInt(commissionCents)*BigInt(rate)+999999n)/1000000n);
  }

  const delivery=order.pricing?.delivery, addon=order.pricing?.membership_addon;
  if(!cents(order.shipping_cents)||!cents(delivery?.extras_cents)||!cents(delivery?.shipping_cents)||
      delivery.shipping_cents+delivery.extras_cents!==order.shipping_cents||
      (addon!=null&&!cents(addon.fee_cents))||(order.request_data?.membership_addon?.plan&&!addon))
    return unavailable('The invoice does not separate base shipping, optional services and membership fees.');
  const eligible=order.total_cents-order.tax_cents-delivery.extras_cents-(addon?.fee_cents||0);
  if(eligible<=0)return unavailable('No merchandise or base shipping receipts remain.');
  let lines;
  try{lines=physicalOrderLines(order,order.commerce_fulfillment_items);}
  catch{return unavailable('The recorded paid, promotional and gift quantities require reconciliation.');}
  return{available:true,currency:order.currency,receipts_cents:eligible,commission_cents:commissionCents,
    commission_usd_cents:commission?.amount_cents||0,paid_units:lines.reduce((sum,l)=>sum+l.purchased,0),
    free_units:lines.reduce((sum,l)=>sum+l.free,0)};
}

async function load(db,id){
  // PostgREST embeds the unique commission as an object, and the receipt and allocation rows as arrays.
  const result=await db.from('commerce_invoices').select('id,customer_id,kind,status,cancellation_status,currency,paid_at,total_cents,tax_cents,shipping_cents,pricing,request_data,commerce_receipts(kind,amount_cents,currency),commerce_partner_commissions(amount_cents,status),commerce_fulfillment_items(variant_key,item)').eq('id',id).maybeSingle();
  if(result.error)throw Error('Fulfillment quote records are unavailable.');
  if(!result.data)return null;
  const order=result.data;
  let referral=null;
  if(!order.commerce_partner_commissions && !order.pricing?.referral?.partner_id && paidStates.has(order.status)){
    const attribution=await db.from('commerce_referrals').select('first_invoice_id,created_at').eq('customer_id',order.customer_id).maybeSingle();
    if(attribution.error)throw Error('Partner attribution is unavailable.');
    referral=attribution.data;
  }
  return orderBasis(order,referral);
}
module.exports={load,orderBasis};
