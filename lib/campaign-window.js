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
  if (!window?.ends_at || request.bulk_order || request.research_builder_mode) return [];
  const eligible = new Set(window.eligible_variants || []);
  return pricing.lines.filter(line => eligible.has(line.id + ':' + line.size))
    .map(line => ({ id: line.id, size: line.size, qty: line.qty }));
}

function checkoutCampaign(env = process.env, now = Date.now(), catalog) {
  const christmas = promotions.christmas_bogo;
  const christmasActive = christmas?.enabled === true && Date.parse(christmas.starts_at) <= now && now < Date.parse(christmas.ends_at);
  const window = christmasActive ? {ends_at: christmas.ends_at, server_time: new Date(now).toISOString()} : campaignWindow(env, now);
  const setting = christmasActive ? christmas.scope : (env.BOGO_VARIANTS || '').trim();
  const scope = setting === 'catalog' ? 'catalog' : 'selection';
  if (!window.ends_at || !setting) return { ...window, ends_at: null, scope, eligible_variants: [] };

  // The same built catalog prices orders and supplies the exact eligible sizes.
  // Membership plans use a separate checkout kind. VIP here is a physical compound.
  const products = catalog || require('./catalog.json');
  const nonMerchandise = new Set(['supplies', 'supply', 'equipment', 'membership', 'memberships', 'plans']);
  const excludedProducts = new Set(['bac-3', 'bac-10', 'needles', 'gift-bac-3']);
  const selected = new Set(setting.split(',').map(key => key.trim()));
  const eligible_variants = products
    .filter(product => !excludedProducts.has(product.id) && !nonMerchandise.has(product.category) && !nonMerchandise.has(product.form))
    .flatMap(product => product.variants.map(variant => product.id + ':' + variant.size))
    .filter(key => scope === 'catalog' || selected.has(key));
  return { ...window, scope, ends_at: eligible_variants.length ? window.ends_at : null, eligible_variants };
}

module.exports = { campaignWindow, checkoutCampaign, campaignUnits };
