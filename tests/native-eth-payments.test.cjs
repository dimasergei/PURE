'use strict';

const { test } = require('node:test');
const { createHash, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { configuration, issueNativeEthQuote, submitNativeEthCandidate, reconcileNativeEthCandidate } = require('../lib/native-eth-payments');
const { invoiceCalldata } = require('../lib/native-eth');

const now = 1795708800000;
const seconds = now / 1000;
const recipient = '0x' + '1'.repeat(40);
const payer = '0x' + '2'.repeat(40);
const hash = '0x' + 'a'.repeat(64);
const blockHash = '0x' + 'b'.repeat(64);
const env = {
  NATIVE_ETH_ENABLED: 'true',
  NATIVE_ETH_RECIPIENT: recipient,
  NATIVE_ETH_RPC_URL: 'https://rpc-first.example.test',
  NATIVE_ETH_SECONDARY_RPC_URL: 'https://rpc-other.example.test'
};
const accountTag = createHash('sha256').update('ethereum_eth:live:1:' + recipient).digest('hex');
const customerId = randomUUID();
const invoice = {
  id: randomUUID(), customer_id: customerId, status: 'accepted', currency: 'USD',
  kind: 'goods', total_cents: 9999, expires_at: new Date(now + 120000).toISOString()
};
const quoteId = randomUUID();
const quantity = number => '0x' + number.toString(16);

function fixtures({ anchorAge = 600, coinbaseAge = 5, hashPending = false } = {}) {
  return async function fetchMock(input, init) {
    const url = new URL(input);
    if (url.hostname === 'api.exchange.coinbase.com') {
      return Response.json({ price: '3400.01', time: new Date(now - coinbaseAge * 1000).toISOString() });
    }
    if (url.hostname === 'api.kraken.com') {
      return Response.json({ error: [], result: { XETHZUSD: [['3401.01', '1.00', seconds - 3]] } });
    }
    assert.ok(['rpc-first.example.test', 'rpc-other.example.test'].includes(url.hostname), url.hostname);
    const request = JSON.parse(init.body);
    let result;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'eth_getBlockByNumber') {
      assert.equal(request.params[0], 'finalized');
      result = { number: quantity(1200), hash: blockHash, timestamp: quantity(seconds - anchorAge) };
    } else if (request.method === 'eth_getCode') result = '0x';
    else if (hashPending && ['eth_getTransactionByHash', 'eth_getTransactionReceipt'].includes(request.method)) {
      assert.equal(request.params[0], hash);
      result = null;
    } else {
      assert.fail('Unexpected RPC method ' + request.method);
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
}

test('quote issuance requires enablement while existing transfers can still be verified', () => {
  assert.deepEqual(configuration(env), {
    ready: true, canVerify: true, accountTag, recipient,
    rpcUrls: ['https://rpc-first.example.test/', 'https://rpc-other.example.test/']
  });
  assert.equal(configuration({ ...env, NATIVE_ETH_ENABLED: 'false' }).ready, false);
  assert.equal(configuration({ ...env, NATIVE_ETH_ENABLED: 'false' }).canVerify, true);
  assert.equal(configuration({ ...env, NATIVE_ETH_SECONDARY_RPC_URL: env.NATIVE_ETH_RPC_URL }).canVerify, false);
  assert.equal(configuration({ ...env, NATIVE_ETH_RECIPIENT: '0x' + '0'.repeat(40) }).canVerify, false);
});

test('wallet payload is built from the saved quote and never contains storage or RPC credentials', async () => {
  const savedReference = '0x' + '4'.repeat(64);
  const savedId = randomUUID();
  const rate = 3400510000n;
  const wei = ((9999n * (10n ** 22n) + rate - 1n) / rate).toString();
  const db = { async rpc(name, parameters) {
    assert.equal(name, 'commerce_create_native_eth_quote');
    assert.equal(parameters.p_id, quoteId);
    assert.equal(parameters.p_invoice, invoice.id);
    assert.equal(parameters.p_customer, customerId);
    assert.equal(parameters.p_account_tag, accountTag);
    const quote = parameters.p_quote;
    assert.equal(quote.amount_wei, wei);
    assert.deepEqual(quote.rate_sources, {
      coinbase: { rate_micro_usd: '3400010000', observed_at: String(seconds - 5) },
      kraken: { rate_micro_usd: '3401010000', observed_at: String(seconds - 3) }
    });
    assert.match(quote.reference, /^0x[0-9a-f]{64}$/);
    assert.equal(quote.start_block, '1200');
    assert.equal(quote.start_block_hash, blockHash);
    assert.equal(quote.valid_before, seconds + 120);
    return { data: { ...quote, reference: savedReference, id: savedId, status: 'open', usd_cents: 9999 }};
  }};
  const result = await issueNativeEthQuote(db, { invoice, customerId, payer, quoteId, env, now: () => now, fetchImpl: fixtures() });
  assert.deepEqual(result, {
    id: savedId, status: 'open', chain_id: 1, asset: 'ETH', usd_cents: 9999, wei,
    expires_at: invoice.expires_at,
    transaction: { from: payer, to: recipient, value: quantity(BigInt(wei)), data: invoiceCalldata(savedReference) }
  });
});

test('quote issuance fails before write on wrong ownership, stale trade or stalled Ethereum finality', async () => {
  const db = { rpc() { assert.fail('A quote must not be written'); } };
  const request = { invoice, customerId, payer, quoteId, env, now: () => now, fetchImpl: fixtures() };
  await assert.rejects(issueNativeEthQuote(db, { ...request, customerId: randomUUID() }), { status: 404 });
  await assert.rejects(issueNativeEthQuote(db, { ...request, fetchImpl: fixtures({ coinbaseAge: 31 }) }), { status: 503 });
  await assert.rejects(issueNativeEthQuote(db, { ...request, fetchImpl: fixtures({ anchorAge: 3601 }) }), { status: 503 });
});

test('persist a candidate before chain calls and keep awaiting finalized proof', async () => {
  const intent = {
    id: quoteId, account_tag: accountTag, chain_id: 1, payer, recipient, reference: '0x' + '4'.repeat(64),
    amount_wei: '2000000000000000000', start_block: '1200', valid_after: seconds, valid_before: seconds + 120
  };
  let recorded = false;
  const db = { async rpc(name, parameters) {
    assert.equal(name, 'commerce_note_native_eth_submission');
    assert.deepEqual(parameters, { p_id: quoteId, p_invoice: invoice.id, p_customer: customerId, p_hash: hash });
    recorded = true;
    return { data: intent };
  }};
  const pending = fixtures({ hashPending: true });
  const fetchImpl = (input, init) => {
    assert.equal(recorded, true);
    return pending(input, init);
  };
  const result = await submitNativeEthCandidate(db, {
    invoiceId: invoice.id, customerId, quoteId, txHash: hash.toUpperCase(), env: { ...env, NATIVE_ETH_ENABLED: 'false' }, fetchImpl
  });
  assert.deepEqual(result, { state: 'pending' });
});

test('reconciliation fetches the stored quote and rejects when its receiving account changed', async () => {
  const db = { from(table) {
    assert.equal(table, 'commerce_native_eth_quotes');
    return { select() { return { eq(field, value) {
      assert.equal(field, 'id');
      assert.equal(value, quoteId);
      return { maybeSingle: async () => ({ data: { id: quoteId, account_tag: 'c'.repeat(64) } }) };
    }}; }};
  }};
  await assert.rejects(reconcileNativeEthCandidate(db, {
    quoteId, txHash: hash, env, fetchImpl() { assert.fail('Reject a changed receiving account before RPC'); }
  }), { status: 503 });
});
