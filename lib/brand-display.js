'use strict';

const ORDER_SENDER = 'PURE <support@getpurelabs.com>';

// Keep the configured, verified mailbox intact while updating its display name.
function emailSender(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^(\s*["']?)(?:Alta[\s_-]*)?Pure(?:[\s_-]*Labs)?(?=["']?\s*<)/i,
    (_, prefix) => prefix + 'PURE');
}

module.exports = { emailSender, ORDER_SENDER };
