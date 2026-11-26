'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const closedCommerce = new Set(['delivered', 'refunded', 'void']);
const closedLegacy = new Set(['delivered', 'canceled']);
const unresolvedCancellation = new Set(['pending', 'review']);

const canArchiveCommerce = order =>
  (closedCommerce.has(order.status) || (order.kind === 'membership' && order.status === 'paid')) &&
  !unresolvedCancellation.has(order.cancellation_status);
const canArchiveLegacy = order => closedLegacy.has(order.fulfillment_status);

function requestError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function updateArchive(db, body) {
  if (!['archive', 'unarchive'].includes(body?.action))
    throw requestError(400, 'Choose Archive or Restore.');
  const orders = body.orders ?? (Array.isArray(body.order_ids)
    ? body.order_ids.map(id => ({ id, source: 'store' })) : null);
  if (!Array.isArray(orders) || orders.length < 1 || orders.length > 200 || orders.some(order =>
    !['commerce', 'store'].includes(order?.source) || typeof order.id !== 'string' || !UUID.test(order.id)))
    throw requestError(400, 'Select between 1 and 200 valid orders.');

  const selected = new Map();
  for (const { id, source } of orders) {
    const normalizedId = id.toLowerCase();
    selected.set(`${source}:${normalizedId}`, { id: normalizedId, source });
  }
  const { data, error } = await db.rpc('commerce_admin_archive_orders', {
    p_orders: [...selected.values()], p_archived: body.action === 'archive'
  });
  if (error?.code === '22023') throw requestError(400, 'The order selection is invalid.');
  if (error) throw requestError(503, 'Could not update the selected orders. Refresh and try again.');
  return data;
}

module.exports = { canArchiveCommerce, canArchiveLegacy, updateArchive };
