'use strict';

const variantKey = item => `${item.id}|${item.size}`;
function invalid(message) { throw Object.assign(new Error(message), {status:409, code:'allocation_mismatch'}); }
function quantity(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000) invalid('An order quantity needs review before exporting.');
  return value;
}

// Older invoices include complimentary units in request.qty. Current campaign
// awards are separate from the purchased merchandise and its financial lines.
function physicalOrderLines(order, allocations = []) {
  const requested = order.request_data?.items;
  if (!Array.isArray(requested) || !requested.length) invalid('This order has no physical items to export.');
  const priced = new Map((order.pricing?.lines || []).map(item => [variantKey(item), item]));
  const awards = new Map();
  for (const award of order.pricing?.bogo_campaign?.free_units || []) {
    const key = variantKey(award);
    if (awards.has(key)) invalid('Duplicate promotional quantities need review before exporting.');
    awards.set(key, quantity(award.qty));
  }
  const rows = new Map();
  for (const item of requested) {
    const key = variantKey(item);
    if (rows.has(key)) invalid('Duplicate order variants need review before exporting.');
    const requestedQty = quantity(item.qty);
    const extra = awards.get(key) || 0;
    const included = item.membership_gift === true ? requestedQty : (priced.get(key)?.bogo_free_units ?? 0);
    if (!Number.isSafeInteger(included) || included < 0 || included > requestedQty || (extra && (included || extra !== requestedQty))) {
      invalid('Promotional quantities need review before exporting.');
    }
    rows.set(key, {item:{...item,qty:quantity(requestedQty+extra)}, purchased:requestedQty-included, free:included+extra});
    awards.delete(key);
  }
  if (awards.size) invalid('A complimentary variant does not match the order.');
  for (const gift of order.pricing?.bundled_items || []) {
    const key = variantKey(gift);
    if (rows.has(key) || gift.line_total_cents !== 0) invalid('A complimentary gift needs reconciliation before exporting.');
    rows.set(key, {item:gift,purchased:0,free:quantity(gift.qty)});
  }
  for (const allocation of allocations) {
    const item = allocation.item || {}, key = allocation.variant_key;
    let line = rows.get(key);
    if (!line) {
      // Historical memberships and research stacks may only record the BAC gift
      // in the paid allocation. A recognized gift can never become a paid unit.
      if (key !== 'gift-bac-3|3 mL' || ![item.membership_gift,item.campaign_gift,item.research_stack_included].includes(true) || item.qty !== 1) {
        invalid('An extra fulfillment allocation needs review before exporting.');
      }
      line = {item,purchased:0,free:1};
      rows.set(key,line);
    }
    if (line.allocation) invalid('Duplicate fulfillment allocations need review before exporting.');
    if (variantKey(item) !== key || item.qty !== line.item.qty || (item.bogo_free_qty != null && item.bogo_free_qty !== line.free)) {
      invalid('Order quantities and fulfillment allocations differ. Reconcile them before exporting.');
    }
    line.allocation = allocation;
  }
  if (allocations.length && [...rows.values()].some(line => !line.allocation)) {
    invalid('An expected fulfillment allocation is missing. Reconcile it before exporting.');
  }
  return [...rows.values()];
}
module.exports = {physicalOrderLines, quantity};
