'use strict';

const {physicalOrderLines} = require('./physical-order-lines');
const VARIANT = 'tirzepatide|40mg';
const GIFT = 'gift-bac-3|3 mL';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const costs = ['delivered_cost_cents','processing_fee_cents','overhead_cents','loss_allowance_cents'];

function eligible(order, allocations) {
  const request = order.request_data || {};
  if (order.kind !== 'goods' || order.currency !== 'USD' || request.address?.country !== 'US' ||
      !['paid','processing','shipped','delivered','refunded'].includes(order.status) ||
      request.bulk_order || request.research_builder || request.membership_addon?.plan ||
      request.research_builder_mode || request.items?.length !== 1 ||
      request.items[0]?.id !== 'tirzepatide' || request.items[0]?.size !== '40mg') return false;
  return allocations.some(a => a.variant_key === VARIANT) &&
    allocations.every(a => a.route === 'manual' && [VARIANT,GIFT].includes(a.variant_key));
}

async function state(db, order, allocations) {
  if (!eligible(order, allocations)) return {eligible:false};
  const lines = physicalOrderLines(order, allocations);
  const compound = lines.find(row => row.item.id === 'tirzepatide');
  const gift = lines.find(row => row.item.id === 'gift-bac-3');
  const result = await db.rpc('commerce_manual_pilot_state', {p_invoice:order.id});
  if (result.error) throw new Error('Pilot record unavailable.');
  if (!result.data?.eligible) return {eligible:false};
  return {...result.data, paid_qty:compound.purchased, free_qty:compound.free, gift_qty:gift?.item.qty || 0};
}

function validText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

async function save(db, body) {
  if (!uuid.test(body.id || '') || !uuid.test(body.document_id || '') ||
      !Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision > 2147483646 ||
      !validText(body.lot_number,120) || !validText(body.report_id,120) ||
      (body.gift_lot_number != null && body.gift_lot_number !== '' && !validText(body.gift_lot_number,120))) {
    return {status:400,error:'Select the verified lot and report and refresh the current order revision.'};
  }
  const hasCosts = costs.some(key => body[key] != null) || Boolean(body.cost_reference);
  if (hasCosts && (!validText(body.cost_reference,180) ||
      !costs.every(key => Number.isSafeInteger(body[key]) && body[key] >= 0 && body[key] <= 1000000000))) {
    return {status:400,error:'Enter the cost reference and all four USD costs, or leave the costs blank to save packing only.'};
  }
  const data = {
    revision:body.revision, document_id:body.document_id, lot_number:body.lot_number.trim(),
    report_id:body.report_id.trim(), gift_lot_number:body.gift_lot_number?.trim() || null
  };
  if (hasCosts) {
    data.cost_reference = body.cost_reference.trim();
    for (const key of costs) data[key] = body[key];
  }
  const result = await db.rpc('commerce_manual_pilot_save',{p_invoice:body.id,p_data:data});
  if (result.error) {
    if (['P0001','22023','23503','23505','23514','40001'].includes(result.error.code)) {
      return {status:409,error:'Packing or order data changed. Refresh and confirm the eligible order, lot, report, gift and costs.'};
    }
    throw new Error('Pilot record unavailable.');
  }
  return {status:200, saved:true};
}
module.exports = {eligible,state,save,uuid};
