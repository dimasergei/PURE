'use strict';

const { promotions } = require('../config/checkout.json');
const cooldownMs = 48 * 60 * 60 * 1000;

function campaignWindow(env = process.env, now = Date.now(), approved = promotions.bogo) {
  const end = Date.parse(env.BOGO_ENDS_AT || '');
  const start = Date.parse(env.BOGO_STARTS_AT || '');
  const prior = env.BOGO_PREVIOUS_ENDS_AT ? Date.parse(env.BOGO_PREVIOUS_ENDS_AT) : -Infinity;
  const active = approved === true && env.BOGO_ENABLED === 'true' &&
    Number.isFinite(start) && Number.isFinite(end) && start >= prior + cooldownMs &&
    start <= now && now < end;
  return { ends_at: active ? new Date(end).toISOString() : null, server_time: new Date(now).toISOString() };
}

function campaignUnits(pricing, request, window) {
  if (!window.ends_at || request.bulk_order || request.research_builder_mode) return [];
  const eligible = new Set(window.eligible_variants || []);
  return pricing.lines.filter(line => eligible.has(line.id + ':' + line.size))
    .map(line => ({ id: line.id, size: line.size, qty: line.qty }));
}

function checkoutCampaign(env = process.env, now = Date.now()) {
  const window = campaignWindow(env, now);
  const excluded = new Set(['bpc-tb-500', 'glow', 'klow', 'bac-3', 'bac-10', 'needles', 'vip']);
  const eligible_variants = (env.BOGO_VARIANTS || '').split(',').map(value => value.trim())
    .filter(value => /^[a-z0-9-]+:[a-z0-9 /.-]+$/i.test(value) && !excluded.has(value.split(':')[0]));
  return { ...window, ends_at: eligible_variants.length ? window.ends_at : null, eligible_variants };
}

module.exports = { campaignWindow, checkoutCampaign, campaignUnits };
