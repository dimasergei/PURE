'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Transaction, Wallet, toQuantity } = require('ethers');
const {
  createInvoiceReference, invoiceCalldata, normalizeNativeEthRpcUrls, readNativeEthQuoteAnchor, verifyNativeEth
} = require('../lib/native-eth');

const hash = byte => '0x' + byte.repeat(64);
const address = byte => '0x' + byte.repeat(40);
const blockHash = hash('b');
const headHash = hash('c');
const parentHash = hash('a');
const urls = ['https://one.example/ethereum', 'https://two.example/eth'];
const wallet = new Wallet(hash('d'));
const intent = {
  chain_id: 1,
  payer: wallet.address.toLowerCase(),
  recipient: address('e'),
  reference: hash('f'),
  amount_wei: '998877665544332211',
  start_block: '100',
  valid_after: 1770000000,
  valid_before: 1770000900
};
const time = '0x' + (intent.valid_after + 60).toString(16);

function transactionFields(type, signer = wallet, overrides = {}) {
  const transaction = Transaction.from({
    type,
    to: intent.recipient,
    value: BigInt(intent.amount_wei),
    data: invoiceCalldata(intent.reference),
    chainId: 1,
    nonce: 42,
    gasLimit: 23_000,
    ...type === 2
      ? { maxFeePerGas: 15_000_000_000, maxPriorityFeePerGas: 2_000_000_000 }
      : { gasPrice: 12_000_000_000 },
    ...overrides
  });
  transaction.signature = signer.signingKey.sign(transaction.unsignedHash);
  const { r, s, yParity } = transaction.signature;
  return {
    hash: transaction.hash,
    from: transaction.from.toLowerCase(),
    to: transaction.to.toLowerCase(),
    value: toQuantity(transaction.value),
    input: transaction.data,
    chainId: toQuantity(transaction.chainId),
    type: toQuantity(type),
    nonce: toQuantity(transaction.nonce),
    gas: toQuantity(transaction.gasLimit),
    r,
    s,
    v: toQuantity(type === 0 ? 35n + 2n * transaction.chainId + BigInt(yParity) : yParity),
    ...type !== 0 ? { yParity: toQuantity(yParity), accessList: transaction.accessList } : {},
    ...type === 2
      ? {
          maxFeePerGas: toQuantity(transaction.maxFeePerGas),
          maxPriorityFeePerGas: toQuantity(transaction.maxPriorityFeePerGas)
        }
      : { gasPrice: toQuantity(transaction.gasPrice) },
    blockNumber: '0x64',
    blockHash,
    transactionIndex: '0x1'
  };
}

const tx = transactionFields(2);
const txHash = tx.hash;
const receipt = {
  transactionHash: txHash,
  from: intent.payer,
  to: intent.recipient,
  status: '0x1',
  contractAddress: null,
  blockNumber: '0x64',
  blockHash,
  transactionIndex: '0x1'
};
const block = { number: '0x64', hash: blockHash, parentHash, timestamp: time, transactions: [hash('8'), txHash] };
const head = { number: '0x65', hash: headHash, timestamp: '0x' + (intent.valid_after + 72).toString(16) };

function mockRpc(overrides = {}) {
  const calls = [];
  const defaults = {
    eth_chainId: '0x1',
    'eth_getBlockByNumber:finalized': head,
    'eth_getBlockByNumber:0x64': block,
    eth_getTransactionByHash: tx,
    eth_getTransactionReceipt: receipt,
    [`eth_getCode:${intent.recipient}:${blockHash}`]: '0x',
    [`eth_getCode:${intent.recipient}:${parentHash}`]: '0x',
    [`eth_getCode:${intent.payer}:${headHash}`]: '0x',
    [`eth_getCode:${intent.recipient}:${headHash}`]: '0x',
    [`eth_getCode:${intent.payer}:latest`]: '0x',
    [`eth_getCode:${intent.recipient}:latest`]: '0x'
  };

  async function fetchImpl(url, options) {
    assert.equal(options.redirect, 'error');
    const { method, params, id } = JSON.parse(options.body);
    let methodKey = method;
    if (method === 'eth_getBlockByNumber') methodKey += `:${params[0]}`;
    if (method === 'eth_getCode') {
      if (params[1] !== 'latest') assert.equal(params[1].requireCanonical, true);
      methodKey += `:${params[0]}:${params[1].blockHash || params[1]}`;
    }
    const host = new URL(url).hostname;
    const key = `${host}:${methodKey}`;
    calls.push(key);
    if (!Object.hasOwn(overrides, key) && !Object.hasOwn(defaults, methodKey)) throw new Error('Unexpected call');
    const result = Object.hasOwn(overrides, key) ? overrides[key] : defaults[methodKey];
    if (result instanceof Response) return result;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  return { fetchImpl, calls };
}

function verify(overrides, opts) {
  return verifyNativeEth({ intent, recipient: intent.recipient, txHash, rpcUrls: urls, ...mockRpc(overrides), ...opts });
}

function both(method, result) {
  return { [`one.example:${method}`]: result, [`two.example:${method}`]: result };
}

function canonicalTransaction(transaction) {
  return {
    ...both('eth_getTransactionByHash', transaction),
    ...both('eth_getTransactionReceipt', { ...receipt, transactionHash: transaction.hash }),
    ...both('eth_getBlockByNumber:0x64', { ...block, transactions: [hash('8'), transaction.hash] })
  };
}

function quote(overrides, opts) {
  return readNativeEthQuoteAnchor({
    payer: intent.payer, recipient: intent.recipient, rpcUrls: urls, ...mockRpc(overrides), ...opts
  });
}

test('generates unique opaque references and exact prefixed calldata', () => {
  const first = createInvoiceReference();
  const second = createInvoiceReference();
  assert.match(first, /^0x[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(invoiceCalldata(first), '0x50415901' + first.slice(2));
  assert.throws(() => invoiceCalldata('0x1234'), { status: 409 });
});

test('verifies canonical receipts, sender, receiver, nonce and wei independently', async () => {
  const result = await verify();
  assert.deepEqual(result, {
    state: 'verified',
    proof: {
      chain_id: 1,
      payer: intent.payer,
      recipient: intent.recipient,
      reference: intent.reference,
      amount_wei: intent.amount_wei,
      tx_hash: txHash,
      transaction_index: 1,
      block_number: '100',
      block_hash: blockHash,
      block_timestamp: intent.valid_after + 60,
      finalized_number: '101',
      recipient_has_code: false
    }
  });
});

test('accepts an EIP-155 protected legacy mainnet transfer with an omitted chainId', async () => {
  const legacyTx = { ...transactionFields(0), chainId: undefined };
  assert.equal((await verify(canonicalTransaction(legacyTx), { txHash: legacyTx.hash })).state, 'verified');
});

test('accepts an EIP-2930 access-list transfer', async () => {
  const accessList = [{ address: intent.recipient, storageKeys: [hash('1')] }];
  const accessListTx = transactionFields(1, wallet, { accessList });
  assert.equal((await verify(canonicalTransaction(accessListTx), { txHash: accessListTx.hash })).state, 'verified');
});

test('allows a replacement to pay the same signed invoice reference once its own hash is final', async () => {
  const replacement = transactionFields(2, wallet, { maxFeePerGas: 20_000_000_000 });
  assert.notEqual(replacement.hash, txHash);
  const { state, proof } = await verify(canonicalTransaction(replacement), { txHash: replacement.hash });
  assert.equal(state, 'verified');
  assert.equal(proof.tx_hash, replacement.hash);
  assert.equal(proof.reference, intent.reference);
});

test('reconstructs the actual signature preimage and recovers the payer independently of RPC fields', async () => {
  const signatureFromDifferentSender = transactionFields(2, new Wallet(hash('3')));
  const falseFrom = { ...signatureFromDifferentSender, from: intent.payer };
  await assert.rejects(verify(canonicalTransaction(falseFrom), { txHash: falseFrom.hash }), { status: 503 });

  const signatureForDifferentData = transactionFields(2, wallet, { data: invoiceCalldata(hash('1')) });
  const falseInput = { ...signatureForDifferentData, input: tx.input };
  await assert.rejects(verify(canonicalTransaction(falseInput), { txHash: falseInput.hash }), { status: 503 });

  for (const fields of [{ s: '0x0' }, { nonce: '0x0' }, { gas: '0x3' }, { r: undefined }, { accessList: undefined }]) {
    await assert.rejects(verify({ 'two.example:eth_getTransactionByHash': { ...tx, ...fields } }), { status: 503 });
  }
});

test('rejects the exact calldata when other transaction fields do not support the saved payment', async t => {
  const variants = [
    ['different native amount', { value: '0x1' }],
    ['different sender', { from: address('0') }],
    ['different recipient', { to: address('2') }],
    ['different order reference', { input: invoiceCalldata(hash('3')) }],
    ['ordinary payment without invoice data', { input: '0x' }],
    ['trailing data', { input: tx.input + '00' }],
    ['different transaction chain', { chainId: '0x2105' }],
    ['replayable legacy transfer', { type: '0x0', chainId: undefined, v: '0x1b' }],
    ['delegation transaction', { type: '0x4' }],
    ['blob transaction', { type: '0x3' }]
  ];
  for (const [name, changes] of variants) {
    await t.test(name, async () => {
      assert.deepEqual(await verify(both('eth_getTransactionByHash', { ...tx, ...changes })), { state: 'unmatched' });
    });
  }
});

test('holds a candidate while pending or while either provider has not finalized its block', async () => {
  assert.deepEqual(await verify({ 'two.example:eth_getTransactionReceipt': null }), { state: 'pending' });
  assert.deepEqual(await verify({ 'two.example:eth_getTransactionByHash': null }), { state: 'pending' });
  assert.deepEqual(await verify({ 'two.example:eth_getBlockByNumber:finalized': { ...head, number: '0x63' } }), { state: 'pending' });
});

test('supports different finalized heights when providers agree on the overlapping finalized checkpoint', async () => {
  const overrides = {
    'one.example:eth_getBlockByNumber:finalized': { ...head, number: '0x66', hash: hash('9'),
      timestamp: '0x' + (intent.valid_after + 84).toString(16) },
    'one.example:eth_getBlockByNumber:0x65': head
  };
  const { state, proof } = await verify(overrides);
  assert.equal(state, 'verified');
  assert.equal(proof.finalized_number, '101');
  await assert.rejects(verify({ ...overrides, 'one.example:eth_getBlockByNumber:0x65': { ...head, hash: hash('7') } }), { status: 503 });
});

test('uses the mutually agreed finalized quote block and checks both EOAs at that hash and latest', async () => {
  const overrides = {
    'one.example:eth_getBlockByNumber:finalized': { ...head, number: '0x66', hash: hash('9'),
      timestamp: '0x' + (intent.valid_after + 84).toString(16) },
    'one.example:eth_getBlockByNumber:0x65': head
  };
  const { calls, fetchImpl } = mockRpc(overrides);
  assert.deepEqual(await quote(undefined, { fetchImpl }), {
    start_block: '101', block_hash: headHash, block_timestamp: intent.valid_after + 72
  });
  for (const host of ['one.example', 'two.example']) {
    for (const account of [intent.payer, intent.recipient]) {
      assert.ok(calls.includes(`${host}:eth_getCode:${account}:latest`));
      assert.ok(calls.includes(`${host}:eth_getCode:${account}:${headHash}`));
    }
  }
  await assert.rejects(quote({ ...overrides, 'one.example:eth_getBlockByNumber:0x65': { ...head, hash: hash('7') } }),
    { status: 503 });
});

test('refuses quote creation for deployed or delegated accounts and inconsistent provider state', async () => {
  await assert.rejects(quote({ [`one.example:eth_getCode:${intent.payer}:latest`]: '0xef0100' + 'e'.repeat(40) }),
    { status: 400 });
  await assert.rejects(quote({ [`two.example:eth_getCode:${intent.recipient}:${headHash}`]: '0x1234' }),
    { status: 503 });
  await assert.rejects(quote({ [`two.example:eth_getCode:${intent.recipient}:latest`]: '0x1' }), { status: 503 });
  await assert.rejects(quote(undefined, { payer: intent.recipient }), { status: 400 });
  await assert.rejects(quote(undefined, { recipient: address('0') }), { status: 503 });
});

test('rejects independent provider disagreements about the matched payment and finalized history', async () => {
  await assert.rejects(verify({ 'two.example:eth_getTransactionByHash': { ...tx, input: '0x' } }), { status: 503 });
  await assert.rejects(verify({ 'two.example:eth_getBlockByNumber:finalized': { ...head, hash: hash('4') } }), { status: 503 });
  await assert.rejects(verify({ 'two.example:eth_getBlockByNumber:0x64': { ...block, timestamp: '0x' + (intent.valid_after + 61).toString(16) } }), { status: 503 });
  const wrongParentHash = hash('7');
  await assert.rejects(verify({
    'two.example:eth_getBlockByNumber:0x64': { ...block, parentHash: wrongParentHash },
    [`two.example:eth_getCode:${intent.recipient}:${wrongParentHash}`]: '0x'
  }), { status: 503 });
});

test('fails closed for a wrong RPC chain, broken receipt or noncanonical transaction position', async t => {
  const variants = [
    ['wrong provider chain', 'eth_chainId', '0x2105'],
    ['missing finalized head', 'eth_getBlockByNumber:finalized', null],
    ['block timestamp after finalized head', 'eth_getBlockByNumber:0x64', { ...block, timestamp: '0x' + intent.valid_before.toString(16) }],
    ['missing canonical parent hash', 'eth_getBlockByNumber:0x64', { ...block, parentHash: undefined }],
    ['conflicting canonical block hash', 'eth_getBlockByNumber:0x64', { ...block, hash: hash('7') }],
    ['transaction absent at receipt position', 'eth_getBlockByNumber:0x64', { ...block, transactions: [txHash, hash('8')] }],
    ['receipt of another transfer', 'eth_getTransactionReceipt', { ...receipt, transactionHash: hash('7') }],
    ['receipt with incorrect sender', 'eth_getTransactionReceipt', { ...receipt, from: address('7') }],
    ['receipt with incorrect recipient', 'eth_getTransactionReceipt', { ...receipt, to: address('7') }],
    ['receipt with unexpected status', 'eth_getTransactionReceipt', { ...receipt, status: '0x3' }],
    ['incorrect receipt height', 'eth_getTransactionReceipt', { ...receipt, blockNumber: '0x63' }],
    ['transaction index too large', 'eth_getTransactionReceipt', { ...receipt, transactionIndex: '0x1000000000' }],
    ['neither canonical quantity nor safe RPC response', 'eth_getTransactionReceipt', { ...receipt, blockNumber: '0x00064' }]
  ];
  for (const [name, method, result] of variants) {
    await t.test(name, async () => {
      await assert.rejects(verify({ [`two.example:${method}`]: result }), { status: 503 });
    });
  }
});

test('a reverted transaction cannot settle even with exact funds and reference', async () => {
  assert.deepEqual(await verify(both('eth_getTransactionReceipt', { ...receipt, status: '0x0' })), { state: 'unmatched' });
});

test('authentic funds outside the immutable quote window return evidence for review', async () => {
  const quoteEndsAtPayment = { ...intent, valid_before: intent.valid_after + 60 };
  const { state, reason, proof } = await verify(undefined, { intent: quoteEndsAtPayment });
  assert.equal(state, 'review');
  assert.equal(reason, 'outside_quote_window');
  assert.equal(proof.tx_hash, txHash);
  assert.equal((await verify(undefined, { intent: { ...intent, start_block: '101' } })).state, 'review');
  assert.equal((await verify(undefined, { intent: { ...intent, valid_after: intent.valid_after + 61 } })).state, 'review');
  assert.equal((await verify(undefined, { intent: { ...intent, valid_after: intent.valid_after + 60 } })).state, 'verified');
});

test('retains a signed payment in review when the recipient had code in the inclusion block or its parent', async () => {
  for (const blockReference of [blockHash, parentHash]) {
    const method = `eth_getCode:${intent.recipient}:${blockReference}`;
    const result = await verify(both(method, '0x1234'));
    assert.equal(result.state, 'review');
    assert.equal(result.reason, 'recipient_code_present');
    assert.equal(result.proof.tx_hash, txHash);
    assert.equal(result.proof.recipient_has_code, true);
    await assert.rejects(verify({ [`one.example:${method}`]: '0x1234' }), { status: 503 });
  }
});

test('rejects malformed hints and saved quote fields without contacting providers', async () => {
  const fetchImpl = () => assert.fail('provider should not be contacted');
  await assert.rejects(verify(undefined, { fetchImpl, txHash: '0x123' }), { status: 400 });
  await assert.rejects(verify(undefined, { fetchImpl, recipient: address('2') }), { status: 409 });
  await assert.rejects(verify(undefined, { fetchImpl, intent: { ...intent, amount_wei: Number(intent.amount_wei) } }), { status: 409 });
  await assert.rejects(verify(undefined, { fetchImpl, intent: { ...intent, chain_id: 8453 } }), { status: 409 });
  await assert.rejects(verify(undefined, { fetchImpl, intent: { ...intent, valid_after: intent.valid_before } }), { status: 409 });
  await assert.rejects(verify(undefined, { fetchImpl, rpcUrls: [urls[0], 'https://ONE.example.:443/alias'] }), { status: 503 });
  await assert.rejects(verify(undefined, { fetchImpl, rpcUrls: [urls[0], 'http://two.example'] }), { status: 503 });
});

test('validates and normalizes configuration without contacting the RPC providers', () => {
  assert.deepEqual(normalizeNativeEthRpcUrls(['https://ONE.example:443/', urls[1]]),
    ['https://one.example/', urls[1]]);
  assert.throws(() => normalizeNativeEthRpcUrls(['https://one.example', 'https://ONE.example./other']), { status: 503 });
  assert.throws(() => normalizeNativeEthRpcUrls(['https://secret@one.example', urls[1]]), { status: 503 });
});

test('rejects oversized RPC responses both with and without Content-Length', async () => {
  const headers = { 'Content-Length': '131073' };
  const declared = new Response('{}', { headers });
  const undeclared = new Response('x'.repeat(131073));
  for (const response of [declared, undeclared]) {
    await assert.rejects(verify({ 'two.example:eth_getTransactionReceipt': response }), { status: 503 });
  }
});
