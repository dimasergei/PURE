'use strict';

const { createHash } = require('node:crypto');
const { getAddress } = require('ethers');
const {
  createInvoiceReference, invoiceCalldata, normalizeNativeEthRpcUrls,
  readNativeEthQuoteAnchor, verifyNativeEth
} = require('./native-eth');
const { loadNativeEthRate, nativeEthWeiForUsdCents } = require('./native-eth-rate');

const PROVIDER = 'ethereum_eth';
const QUOTE_TTL_SECONDS = 300;
const MIN_QUOTE_SECONDS = 15;
const MAX_ANCHOR_AGE_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const ZERO_ADDRESS = '0x' + '0'.repeat(40);

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function wallet(address) {
  try {
    const normalized = getAddress(address).toLowerCase();
    return normalized === ZERO_ADDRESS ? null : normalized;
  } catch {
    return null;
  }
}

function configuration(env = process.env) {
  const recipient = wallet(env.NATIVE_ETH_RECIPIENT);
  let rpcUrls;
  try {
    rpcUrls = normalizeNativeEthRpcUrls([env.NATIVE_ETH_RPC_URL, env.NATIVE_ETH_SECONDARY_RPC_URL]);
  } catch {
    rpcUrls = null;
  }
  const accountTag = recipient ? createHash('sha256').update(PROVIDER + ':live:1:' + recipient).digest('hex') : null;
  const canVerify = Boolean(recipient && rpcUrls);
  return {
    recipient, rpcUrls, accountTag, canVerify,
    ready: canVerify && env.NATIVE_ETH_ENABLED === 'true'
  };
}

function checkId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail(400, 'Invalid order payment reference.');
}

function checkHash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) fail(400, 'Invalid Ethereum transaction hash.');
  return value.toLowerCase();
}

async function paymentRpc(db, name, params) {
  const { data, error } = await db.rpc(name, params);
  if (!error && data) return data;
  if (error?.code === 'P0002') fail(404, 'Order payment reference was not found.');
  if (['P0001', '22023', '23505', '40001'].includes(error?.code)) {
    fail(409, 'The order payment data has changed or requires review. Refresh the order before continuing.');
  }
  fail(503, 'Order payment storage is temporarily unavailable.');
}

function walletQuote(quote) {
  return {
    id: quote.id,
    status: quote.status,
    chain_id: 1,
    asset: 'ETH',
    usd_cents: quote.usd_cents,
    wei: quote.amount_wei,
    expires_at: new Date(quote.valid_before * 1000).toISOString(),
    transaction: quote.status === 'open' ? {
      from: quote.payer,
      to: quote.recipient,
      value: '0x' + BigInt(quote.amount_wei).toString(16),
      data: invoiceCalldata(quote.reference)
    } : null
  };
}

async function issueNativeEthQuote(db, {
  invoice, customerId, payer: payerAddress, quoteId, env = process.env, fetchImpl = fetch, now = Date.now
}) {
  checkId(invoice?.id);
  checkId(customerId);
  checkId(quoteId);
  if (invoice.customer_id !== customerId) fail(404, 'Order payment reference was not found.');
  const cfg = configuration(env);
  if (!cfg.ready) fail(503, 'Native ETH quote issuance is unavailable.');
  const payer = wallet(payerAddress);
  if (!payer || payer === cfg.recipient) fail(400, 'Use a valid Ethereum payer wallet.');
  const endSeconds = Math.floor(Date.parse(invoice.expires_at) / 1000);
  if (invoice.status !== 'accepted' || invoice.cancellation_requested_at || invoice.kind !== 'goods' ||
      invoice.currency !== 'USD' || !Number.isSafeInteger(invoice.total_cents) || invoice.total_cents < 1 ||
      invoice.total_cents > 100000000 || !Number.isFinite(endSeconds) ||
      endSeconds < Math.floor(now() / 1000) + MIN_QUOTE_SECONDS) fail(409, 'This order is not payable.');

  const [anchor, rate] = await Promise.all([
    readNativeEthQuoteAnchor({ payer, recipient: cfg.recipient, rpcUrls: cfg.rpcUrls, fetchImpl }),
    loadNativeEthRate({ fetchImpl, now })
  ]);
  const issuedAt = Math.floor(now() / 1000);
  if (anchor.block_timestamp > issuedAt || anchor.block_timestamp < issuedAt - MAX_ANCHOR_AGE_SECONDS) {
    fail(503, 'Current Ethereum finality could not be verified.');
  }
  const expiresAt = Math.min(issuedAt + QUOTE_TTL_SECONDS, endSeconds);
  if (expiresAt < issuedAt + MIN_QUOTE_SECONDS) fail(409, 'This order is not payable.');

  const rateSources = Object.fromEntries(rate.observations.map(observation => [
    observation.source === 'coinbase-exchange' ? 'coinbase' : observation.source,
    {
      rate_micro_usd: observation.microUsdPerEth,
      observed_at: String(Math.floor(Date.parse(observation.observedAt) / 1000))
    }
  ]));
  const quote = await paymentRpc(db, 'commerce_create_native_eth_quote', {
    p_id: quoteId,
    p_invoice: invoice.id,
    p_customer: customerId,
    p_account_tag: cfg.accountTag,
    p_quote: {
      payer, recipient: cfg.recipient, reference: createInvoiceReference(),
      amount_wei: nativeEthWeiForUsdCents(invoice.total_cents, rate.microUsdPerEth),
      rate_micro_usd: rate.microUsdPerEth, rate_sources: rateSources,
      start_block: anchor.start_block, start_block_hash: anchor.block_hash,
      start_block_timestamp: anchor.block_timestamp, valid_after: issuedAt, valid_before: expiresAt
    }
  });
  return walletQuote(quote);
}

async function verifyCandidate(db, intent, txHash, { env, fetchImpl }) {
  const cfg = configuration(env);
  if (!cfg.canVerify || intent.account_tag !== cfg.accountTag) {
    fail(503, 'Native ETH reconciliation is unavailable for this receiving account.');
  }
  const result = await verifyNativeEth({
    intent: { ...intent, start_block: String(intent.start_block) }, recipient: cfg.recipient,
    txHash, rpcUrls: cfg.rpcUrls, fetchImpl
  });
  if (!result.proof) return { state: result.state };
  return paymentRpc(db, 'commerce_finish_native_eth_payment', {
    p_id: intent.id, p_account_tag: cfg.accountTag, p_proof: result.proof
  });
}

async function submitNativeEthCandidate(db, {
  invoiceId, customerId, quoteId, txHash, env = process.env, fetchImpl = fetch
}) {
  [invoiceId, customerId, quoteId].forEach(checkId);
  const normalized = checkHash(txHash);
  const intent = await paymentRpc(db, 'commerce_note_native_eth_submission', {
    p_id: quoteId, p_invoice: invoiceId, p_customer: customerId, p_hash: normalized
  });
  return verifyCandidate(db, intent, normalized, { env, fetchImpl });
}

async function reconcileNativeEthCandidate(db, {
  quoteId, txHash, env = process.env, fetchImpl = fetch
}) {
  checkId(quoteId);
  const normalized = checkHash(txHash);
  const { data, error } = await db.from('commerce_native_eth_quotes').select('*').eq('id', quoteId).maybeSingle();
  if (error) fail(503, 'Order payment storage is temporarily unavailable.');
  if (!data) fail(404, 'Order payment reference was not found.');
  return verifyCandidate(db, data, normalized, { env, fetchImpl });
}

module.exports = {
  PROVIDER, configuration, issueNativeEthQuote, submitNativeEthCandidate, reconcileNativeEthCandidate
};
