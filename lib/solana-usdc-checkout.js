'use strict';

const { createHash, randomUUID } = require('node:crypto');
const solana = require('./solana-usdc');

const PROVIDER = 'solana_usdc';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function configuration(env = process.env) {
  const { SOLANA_USDC_RECIPIENT: recipient, SOLANA_USDC_RPC_URL: primary, SOLANA_USDC_SECONDARY_RPC_URL: backup } = env;
  const missing = [];
  const rpc = solana.rpcEndpoint(primary);
  const secondary = solana.rpcEndpoint(backup);
  const destination = solana.isWalletAddress(recipient) ? solana.recipientTokenAccount(recipient) : null;
  if (!destination) missing.push('SOLANA_USDC_RECIPIENT');
  if (!rpc) missing.push('SOLANA_USDC_RPC_URL');
  if (!secondary || secondary.domain === rpc?.domain) missing.push('SOLANA_USDC_SECONDARY_RPC_URL');
  const enabled = env.SOLANA_USDC_ENABLED === 'true';
  const accountTag = destination ? createHash('sha256').update(`${PROVIDER}:live:${solana.GENESIS_HASH}:${solana.TOKEN}:${recipient}:${destination}`).digest('hex') : null;
  return {
    provider: PROVIDER, mode: 'live', enabled, ready: enabled && missing.length === 0, missing, currencies: ['USD'],
    recipient, recipient_token_account: destination, token: solana.TOKEN, genesis_hash: solana.GENESIS_HASH,
    rpc: rpc?.url, secondary: secondary?.url, account_tag: accountTag
  };
}

async function readiness(config, fetchImpl = fetch) {
  if (!config.ready) return { ready: false };
  const route = await solana.verifyReceivingRoute(config, fetchImpl);
  return { ...route, ready: route.recipient_token_account === config.recipient_token_account };
}

function checked(result) {
  if (!result.error) return result.data;
  if (result.error.code === 'P0002') fail(404, 'Solana payment was not found for this order.');
  if (['P0001', '22023', '23505', '23514', '40001'].includes(result.error.code)) {
    fail(409, 'The saved Solana payment changed or requires review. Check your order before continuing.');
  }
  fail(503, 'Solana confirmation is unavailable. Check your order before continuing.');
}

function assertOwner(invoice, customer) {
  if (!customer?.id || customer.id !== invoice.customer_id) fail(403, 'This Solana payment belongs to another account.');
}

function assertRoute(invoice, account, config) {
  if (invoice.kind !== 'goods' || invoice.currency !== 'USD' || !Number.isSafeInteger(invoice.total_cents) || invoice.total_cents < 1 ||
      account.method_id !== invoice.method_id || account.provider !== PROVIDER || account.mode !== 'live' || !config.account_tag ||
      account.account_tag !== config.account_tag || account.solana_usdc_recipient !== config.recipient ||
      account.solana_usdc_recipient_token_account !== config.recipient_token_account) {
    fail(409, 'The receiving wallet does not match this order.');
  }
}

function assertIntent(intent, invoice, config) {
  if (!intent || intent.invoice_id !== invoice.id || intent.account_tag !== config.account_tag || intent.recipient !== config.recipient ||
      intent.recipient_token_account !== config.recipient_token_account || String(intent.amount_units) !== (BigInt(invoice.total_cents) * 10000n).toString()) {
    fail(409, 'The saved Solana payment does not match this order.');
  }
}

async function loadIntent(db, invoiceId) {
  return checked(await db.from('commerce_solana_usdc_intents').select('*').eq('invoice_id', invoiceId).maybeSingle());
}

function publicIntent(intent, invoice, { includeTransaction = false } = {}) {
  if (!intent) return null;
  const state = intent.status === 'paid' || intent.status === 'review' ? intent.status
    : invoice.cancellation_requested_at ? 'cancel_pending'
      : intent.status === 'submitted' ? 'pending' : 'awaiting_wallet';
  return {
    state,
    intent: {
      attempt_id: intent.attempt_id, invoice_id: intent.invoice_id, payer: intent.payer, reference: intent.reference, recipient: intent.recipient,
      recipient_token_account: intent.recipient_token_account, token: solana.TOKEN, genesis_hash: solana.GENESIS_HASH,
      amount_units: String(intent.amount_units), valid_before: Number(intent.valid_before)
    },
    ...(includeTransaction && state === 'awaiting_wallet' && Number(intent.valid_before) > Date.now() / 1000
      ? { transaction: intent.unsigned_transaction, last_valid_block_height: Number(intent.last_valid_block_height) }
      : {})
  };
}

async function customerState(db, invoice, customer) {
  assertOwner(invoice, customer);
  return publicIntent(await loadIntent(db, invoice.id), invoice);
}

async function start(db, invoice, account, config, body, customer, fetchImpl = fetch) {
  assertOwner(invoice, customer);
  assertRoute(invoice, account, config);
  const now = Math.floor(Date.now() / 1000);
  const expires = Math.min(now + 1800, Math.floor(Date.parse(invoice.expires_at) / 1000));
  if (!config.ready || !account.method?.active || invoice.status !== 'accepted' || invoice.cancellation_requested_at ||
      !Number.isSafeInteger(expires) || expires < now + 60 || body.confirm_amount_cents !== invoice.total_cents ||
      body.confirm_currency !== 'USD' || body.consent !== true) fail(409, 'Review the current invoice before preparing a Solana payment.');
  const payer = body.wallet_address;
  if (!solana.isWalletAddress(payer) || [config.recipient, config.recipient_token_account, solana.TOKEN, solana.TOKEN_PROGRAM].includes(payer)) {
    fail(400, 'Connect the Solana wallet that will sign this payment.');
  }
  const existing = await loadIntent(db, invoice.id);
  if (existing) {
    assertIntent(existing, invoice, config);
    if (existing.payer !== payer) fail(409, 'Reconnect the wallet already selected for this order.');
    if (existing.status === 'open' && !(await solana.preparedTransferUsable(config, existing, fetchImpl))) {
      return { ...publicIntent(existing, invoice), state: 'wallet_review' };
    }
    return publicIntent(existing, invoice, { includeTransaction: true });
  }
  const reference = solana.createReference();
  const amountUnits = (BigInt(invoice.total_cents) * 10000n).toString();
  const prepared = await solana.prepareTransfer({
    rpc: config.rpc, secondary: config.secondary, recipient: config.recipient, payer, reference, amountUnits
  }, fetchImpl);
  const data = checked(await db.rpc('commerce_create_solana_usdc_intent', {
    p_id: UUID.test(body.attempt_id || '') ? body.attempt_id : randomUUID(),
    p_invoice: invoice.id, p_customer: customer.id, p_account_tag: config.account_tag,
    p_intent: {
      genesis_hash: solana.GENESIS_HASH, token: solana.TOKEN, recipient: config.recipient,
      recipient_token_account: config.recipient_token_account, payer, reference, amount_units: amountUnits, valid_before: expires,
      unsigned_transaction: prepared.transaction, last_valid_block_height: prepared.last_valid_block_height
    }
  }));
  assertIntent(data, invoice, config);
  if (data.payer !== payer) fail(409, 'Reconnect the wallet already selected for this order.');
  return publicIntent(data, invoice, { includeTransaction: true });
}

function note(db, invoice, intent, config, signature) {
  return db.rpc('commerce_note_solana_usdc_submission', {
    p_id: intent.attempt_id, p_invoice: invoice.id, p_signature: signature, p_account_tag: config.account_tag
  });
}

async function loadAttempt(db, invoice, account, config, attemptId, customer) {
  assertOwner(invoice, customer);
  assertRoute(invoice, account, config);
  if (!UUID.test(attemptId || '')) fail(400, 'Use the Solana payment reference for this invoice.');
  const intent = await loadIntent(db, invoice.id);
  assertIntent(intent, invoice, config);
  if (intent.attempt_id !== attemptId) fail(409, 'The payment reference belongs to a different order.');
  return intent;
}

async function submit(db, invoice, account, config, body, customer, fetchImpl = fetch) {
  const intent = await loadAttempt(db, invoice, account, config, body.attempt_id, customer);
  if (intent.status === 'paid' || intent.status === 'review') return { state: intent.status, invoice_id: invoice.id };
  if (!config.ready) fail(503, 'New Solana payment submissions are unavailable. Check your order status.');
  const signature = solana.verifySignedTransaction(body.signed_transaction, intent.unsigned_transaction);
  if (!(await solana.preparedTransferUsable(config, intent, fetchImpl))) {
    checked(await note(db, invoice, intent, config, signature));
    return { state: 'wallet_review', invoice_id: invoice.id };
  }
  const accepted = checked(await db.rpc('commerce_claim_solana_usdc_broadcast', {
    p_id: intent.attempt_id, p_invoice: invoice.id, p_customer: customer.id, p_signature: signature, p_account_tag: config.account_tag
  }));
  // A timeout may still have delivered the transfer. Its signature is already
  // recorded and a repeated submission broadcasts only the same signed bytes.
  await solana.broadcastSignedTransaction(config, body.signed_transaction, signature, fetchImpl);
  return accepted;
}

async function proofFor(intent, config, signature, fetchImpl) {
  return solana.verifyPayment({
    rpc: config.rpc, secondary: config.secondary, signature, recipient: intent.recipient,
    payer: intent.payer, reference: intent.reference, amountUnits: String(intent.amount_units),
    // Keep exact late transfers for review. SQL enforces the invoice's payment window.
    validAfter: Number(intent.valid_after), validBefore: Number.MAX_SAFE_INTEGER
  }, fetchImpl);
}

async function finish(db, invoice, intent, config, proof, env, dispatch) {
  const result = checked(await db.rpc('commerce_finish_solana_usdc_payment', {
    p_id: intent.attempt_id, p_account_tag: config.account_tag, p_proof: proof
  }));
  if (dispatch && result.state === 'paid' && !result.replayed) {
    try { await require('./invoice-notifications').dispatch(db, { invoiceId: invoice.id, env, limit: 2 }); } catch {}
  }
  return result;
}

async function recover(db, invoice, intent, config, fetchImpl, env, dispatch) {
  const stored = checked(await db.from('commerce_solana_usdc_submissions').select('tx_signature')
    .eq('attempt_id', intent.attempt_id).order('created_at', { ascending: false }).limit(20)) || [];
  let discovered = [];
  let discoveryError;
  try { discovered = await solana.findFinalizedSignatures(config, intent.reference, fetchImpl); }
  catch (error) { discoveryError = error; }
  const signatures = [...new Set([intent.broadcast_signature, ...stored.slice(0, 2).map(row => row.tx_signature),
    ...discovered, ...stored.slice(2).map(row => row.tx_signature)].filter(Boolean))];
  // Verify candidates in small groups so a public reference cannot exhaust an invocation.
  for (let offset = 0; offset < Math.min(signatures.length, 12); offset += 4) {
    const candidates = await Promise.allSettled(signatures.slice(offset, offset + 4).map(signature => proofFor(intent, config, signature, fetchImpl)));
    const match = candidates.find(candidate => candidate.status === 'fulfilled' && !candidate.value.pending);
    if (match) {
      checked(await note(db, invoice, intent, config, match.value.tx_signature));
      return finish(db, invoice, intent, config, match.value, env, dispatch);
    }
  }
  if (discoveryError && signatures.length === 0) throw discoveryError;
  return { state: invoice.cancellation_requested_at ? 'cancel_pending' : intent.status === 'submitted' ? 'pending' : 'awaiting_wallet', invoice_id: invoice.id };
}

async function confirm(db, invoice, account, config, body, customer, fetchImpl = fetch, { env = process.env, dispatch = true } = {}) {
  const intent = await loadAttempt(db, invoice, account, config, body.attempt_id, customer);
  const signature = body.tx_signature;
  if (signature !== undefined && !solana.isSignature(signature)) fail(400, 'Use the Solana transaction signature for this invoice.');
  if (intent.status === 'paid' || intent.status === 'review') return { state: intent.status, invoice_id: invoice.id };
  // Save customer-supplied evidence first. A provider outage cannot lose it.
  if (signature) checked(await note(db, invoice, intent, config, signature));
  if (config.missing.length) fail(503, 'Solana verification is temporarily unavailable. Your payment remains pending.');
  if (!signature) {
    const budget = AbortSignal.timeout(22000);
    const boundedFetch = (url, options) => fetchImpl(url, { ...options, signal: AbortSignal.any([options.signal, budget]) });
    return recover(db, invoice, intent, config, boundedFetch, env, dispatch);
  }
  const proof = await proofFor(intent, config, signature, fetchImpl);
  if (proof.pending) return { state: invoice.cancellation_requested_at ? 'cancel_pending' : 'pending', invoice_id: invoice.id };
  return finish(db, invoice, intent, config, proof, env, dispatch);
}

async function reconcilePending(db, { env = process.env, fetchImpl = fetch, limit = 4, timeBudgetMs = 24000 } = {}) {
  const config = configuration(env);
  const result = { checked: 0, paid: 0, pending: 0, review: 0, errors: 0 };
  if (config.missing.length) return { ...result, skipped: true };
  const deadline = Date.now() + timeBudgetMs;
  const boundedFetch = (url, options) => fetchImpl(url, {
    ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))])
  });
  const intents = checked(await db.from('commerce_solana_usdc_intents').select('*').eq('account_tag', config.account_tag)
    .in('status', ['open', 'submitted']).order('updated_at', { ascending: true }).limit(limit)) || [];
  for (const intent of intents) {
    if (Date.now() >= deadline) break;
    try {
      const invoice = checked(await db.from('commerce_invoices').select('*').eq('id', intent.invoice_id).single());
      const account = checked(await db.from('commerce_gateway_accounts').select('*').eq('method_id', invoice.method_id).single());
      assertRoute(invoice, account, config);
      assertIntent(intent, invoice, config);
      const outcome = await recover(db, invoice, intent, config, boundedFetch, env, false);
      if (outcome.state === 'paid' || outcome.state === 'review') result[outcome.state]++;
      else result.pending++;
    } catch {
      result.errors++;
    } finally {
      result.checked++;
      await db.rpc('commerce_touch_solana_usdc_intent', { p_id: intent.attempt_id, p_account_tag: config.account_tag });
    }
  }
  return result;
}

module.exports = { configuration, readiness, customerState, start, submit, confirm, reconcilePending };
