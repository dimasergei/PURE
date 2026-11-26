'use strict';

const { randomBytes } = require('node:crypto');
const { Transaction } = require('ethers');

const CHAIN_ID = 1;
const DATA_PREFIX = '0x50415901';
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/;
const SIGNATURE_WORD = /^0x([0-9a-f]{1,64})$/i;
const BYTECODE = /^0x(?:[0-9a-f]{2})*$/i;
const DECIMAL = /^(?:0|[1-9]\d{0,77})$/;
const ZERO_ADDRESS = '0x' + '0'.repeat(40);
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_TRANSACTION_INDEX = 2147483647;
const UNAVAILABLE = 'Ethereum verification is unavailable. Payment remains pending.';

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function normalizedHex(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value.toLowerCase() : null;
}

function address(value) {
  const normalized = normalizedHex(value, ADDRESS);
  return normalized === ZERO_ADDRESS ? null : normalized;
}

function quantity(value) {
  if (typeof value !== 'string' || !QUANTITY.test(value)) fail(503, UNAVAILABLE);
  return BigInt(value);
}

function safeQuantity(value, max = Number.MAX_SAFE_INTEGER) {
  const result = quantity(value);
  if (result > BigInt(max)) fail(503, UNAVAILABLE);
  return Number(result);
}

function savedInteger(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_UINT256 ? parsed : null;
}

function normalizeNativeEthRpcUrls(urls) {
  if (!Array.isArray(urls) || urls.length !== 2 || urls.some(value => typeof value !== 'string')) {
    fail(503, UNAVAILABLE);
  }
  let endpoints;
  try {
    endpoints = urls.map(value => new URL(value));
  } catch {
    fail(503, UNAVAILABLE);
  }
  const hosts = endpoints.map(url => url.hostname.replace(/\.$/, ''));
  if (endpoints.some(url => url.protocol !== 'https:' || url.username || url.password || url.hash) ||
      hosts[0] === hosts[1]) {
    fail(503, UNAVAILABLE);
  }
  return endpoints.map(url => url.href);
}

function parseIntent(intent, configuredRecipient) {
  const payer = address(intent?.payer);
  const recipient = address(intent?.recipient);
  const reference = normalizedHex(intent?.reference, HASH);
  const amount = savedInteger(intent?.amount_wei);
  const startBlock = savedInteger(intent?.start_block);
  const after = intent?.valid_after;
  const before = intent?.valid_before;
  if (intent?.chain_id !== CHAIN_ID || !payer || !recipient || recipient !== address(configuredRecipient) ||
      payer === recipient || !reference || amount === null || amount < 1n || startBlock === null ||
      !Number.isSafeInteger(after) || !Number.isSafeInteger(before) || after < 0 || before <= after) {
    fail(409, 'The saved Ethereum payment intent is invalid.');
  }
  return { payer, recipient, reference, amount, startBlock, after, before };
}

function invoiceCalldata(reference) {
  const value = normalizedHex(reference, HASH);
  if (!value) fail(409, 'The saved Ethereum payment reference is invalid.');
  return DATA_PREFIX + value.slice(2);
}

function createInvoiceReference() {
  return '0x' + randomBytes(32).toString('hex');
}

async function responseBody(response, cap) {
  const length = response.headers?.get('content-length');
  if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > cap)) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Response size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response body');

  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) throw new Error('Response size limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    // Cancel without waiting on an untrusted stream source.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

async function rpc(url, method, params, fetchImpl, signal) {
  let data;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal
    });
    const cap = method === 'eth_getBlockByNumber' ? 1048576 : 131072;
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error('RPC request failed');
    }
    data = await responseBody(response, cap);
  } catch {
    fail(503, UNAVAILABLE);
  }
  if (data?.jsonrpc !== '2.0' || data.id !== 1 || Object.hasOwn(data, 'error') || !Object.hasOwn(data, 'result')) {
    fail(503, UNAVAILABLE);
  }
  return data.result;
}

function blockReference(block) {
  const hash = normalizedHex(block?.hash, HASH);
  if (!hash) fail(503, UNAVAILABLE);
  return { hash, number: quantity(block.number), timestamp: safeQuantity(block.timestamp) };
}

function adaptersFor(urls, fetchImpl) {
  const signal = AbortSignal.timeout(10000);
  return normalizeNativeEthRpcUrls(urls).map(url => (method, params) => rpc(url, method, params, fetchImpl, signal));
}

async function finalizedHead(call) {
  const [chainId, block] = await Promise.all([
    call('eth_chainId', []),
    call('eth_getBlockByNumber', ['finalized', false])
  ]);
  if (quantity(chainId) !== BigInt(CHAIN_ID)) fail(503, UNAVAILABLE);
  return blockReference(block);
}

async function agreedHead(adapters, heads) {
  const slowerIndex = heads[0].number <= heads[1].number ? 0 : 1;
  const slower = heads[slowerIndex];
  const faster = heads[1 - slowerIndex];
  let checkpoint = faster;
  if (slower.number !== faster.number) {
    const height = '0x' + slower.number.toString(16);
    if (slower.timestamp >= faster.timestamp) fail(503, UNAVAILABLE);
    checkpoint = blockReference(await adapters[1 - slowerIndex]('eth_getBlockByNumber', [height, false]));
  }
  if (slower.hash !== checkpoint.hash || slower.number !== checkpoint.number ||
      slower.timestamp !== checkpoint.timestamp) fail(503, UNAVAILABLE);
  return slower;
}

function canonicalBlock(hash) {
  return { blockHash: hash, requireCanonical: true };
}

async function hasCode(call, account, block) {
  const code = await call('eth_getCode', [account, block]);
  if (typeof code !== 'string' || !BYTECODE.test(code)) fail(503, UNAVAILABLE);
  return code !== '0x';
}

async function hasCodeAt(adapters, account, blocks) {
  const results = await Promise.all(adapters.flatMap(call => blocks.map(block => hasCode(call, account, block))));
  return results.some(Boolean);
}

async function readNativeEthQuoteAnchor({ payer, recipient, rpcUrls, fetchImpl = fetch }) {
  const sender = address(payer);
  const receiver = address(recipient);
  if (!receiver) fail(503, UNAVAILABLE);
  if (!sender || sender === receiver) fail(400, 'Connect a compatible Ethereum wallet.');

  const adapters = adaptersFor(rpcUrls, fetchImpl);
  const heads = await Promise.all(adapters.map(finalizedHead));
  const anchor = await agreedHead(adapters, heads);
  const blocks = ['latest', canonicalBlock(anchor.hash)];
  const [senderHasCode, recipientHasCode] = await Promise.all([
    hasCodeAt(adapters, sender, blocks),
    hasCodeAt(adapters, receiver, blocks)
  ]);
  if (recipientHasCode) fail(503, UNAVAILABLE);
  if (senderHasCode) fail(400, 'Connect a compatible Ethereum wallet.');
  return {
    start_block: anchor.number.toString(),
    block_hash: anchor.hash,
    block_timestamp: anchor.timestamp
  };
}

function transactionChain(tx, type) {
  // Execution API permits omission of chainId for EIP-155 protected legacy transactions.
  if (type === 0n) {
    const v = quantity(tx.v);
    if (v === 27n || v === 28n) return null;
    if (v < 35n) fail(503, UNAVAILABLE);
    const chain = (v - 35n) / 2n;
    if (tx.chainId != null && quantity(tx.chainId) !== chain) fail(503, UNAVAILABLE);
    return chain;
  }
  return quantity(tx.chainId);
}

function signatureWord(value) {
  const match = typeof value === 'string' && SIGNATURE_WORD.exec(value);
  if (!match) fail(503, UNAVAILABLE);
  return '0x' + match[1].padStart(64, '0');
}

function verifyTransactionSignature(tx, { type, chain, from, to, amount, hash }) {
  try {
    const signature = { r: signatureWord(tx.r), s: signatureWord(tx.s) };
    if (tx.v != null) signature.v = quantity(tx.v);
    if (tx.yParity != null) signature.yParity = safeQuantity(tx.yParity, 1);
    const fields = {
      type: Number(type),
      chainId: chain,
      nonce: safeQuantity(tx.nonce),
      gasLimit: quantity(tx.gas),
      to,
      value: amount,
      data: tx.input,
      signature
    };
    if (type < 2n) fields.gasPrice = quantity(tx.gasPrice);
    if (type === 2n) {
      fields.maxFeePerGas = quantity(tx.maxFeePerGas);
      fields.maxPriorityFeePerGas = quantity(tx.maxPriorityFeePerGas);
    }
    if (type !== 0n) {
      if (!Array.isArray(tx.accessList)) fail(503, UNAVAILABLE);
      fields.accessList = tx.accessList;
    }
    const signed = Transaction.from(fields);
    if (signed.hash !== hash || address(signed.from) !== from) fail(503, UNAVAILABLE);
  } catch {
    fail(503, UNAVAILABLE);
  }
}

async function proofAt(call, intent, hash) {
  const [head, tx, receipt] = await Promise.all([
    finalizedHead(call),
    call('eth_getTransactionByHash', [hash]),
    call('eth_getTransactionReceipt', [hash])
  ]);
  if (tx === null || receipt === null) return { state: 'pending' };
  if (normalizedHex(tx.hash, HASH) !== hash || normalizedHex(receipt.transactionHash, HASH) !== hash) {
    fail(503, UNAVAILABLE);
  }
  const to = address(tx.to);
  const from = address(tx.from);
  const type = quantity(tx.type ?? '0x0');
  // This ordinary wallet route does not accept transactions that carry delegation or blobs.
  if (type > 2n) return { state: 'unmatched' };
  const chain = transactionChain(tx, type);
  if (to !== intent.recipient || from !== intent.payer ||
      typeof tx.input !== 'string' || tx.input.toLowerCase() !== invoiceCalldata(intent.reference) ||
      chain !== BigInt(CHAIN_ID) || quantity(tx.value) !== intent.amount) {
    return { state: 'unmatched' };
  }

  const blockNumber = quantity(receipt.blockNumber);
  if (blockNumber > head.number) return { state: 'pending' };
  const blockHash = normalizedHex(receipt.blockHash, HASH);
  const transactionIndex = safeQuantity(receipt.transactionIndex, MAX_TRANSACTION_INDEX);
  const status = quantity(receipt.status);
  if (!blockHash || normalizedHex(tx.blockHash, HASH) !== blockHash || quantity(tx.blockNumber) !== blockNumber ||
      safeQuantity(tx.transactionIndex, MAX_TRANSACTION_INDEX) !== transactionIndex ||
      address(receipt.to) !== to || address(receipt.from) !== from || receipt.contractAddress !== null ||
      (status !== 0n && status !== 1n)) {
    fail(503, UNAVAILABLE);
  }

  const canonical = await call('eth_getBlockByNumber', [receipt.blockNumber, false]);
  const block = blockReference(canonical);
  const parentHash = normalizedHex(canonical?.parentHash, HASH);
  if (!parentHash || blockNumber < 1n || block.number !== blockNumber || block.hash !== blockHash ||
      (blockNumber < head.number && block.timestamp >= head.timestamp) ||
      (blockNumber === head.number && (head.hash !== blockHash || head.timestamp !== block.timestamp)) ||
      !Array.isArray(canonical.transactions) || normalizedHex(canonical.transactions[transactionIndex], HASH) !== hash) {
    fail(503, UNAVAILABLE);
  }
  if (status === 0n) return { state: 'unmatched' };
  verifyTransactionSignature(tx, { type, chain, from, to, amount: intent.amount, hash });

  const recipientHasCode = await hasCodeAt([call], to, [parentHash, blockHash].map(canonicalBlock));

  const proof = {
    chain_id: CHAIN_ID,
    payer: from,
    recipient: to,
    reference: intent.reference,
    amount_wei: intent.amount.toString(),
    tx_hash: hash,
    transaction_index: transactionIndex,
    block_number: blockNumber.toString(),
    block_hash: blockHash,
    block_timestamp: block.timestamp
  };
  return { state: 'matched', proof, head, parentHash, recipientHasCode };
}

async function verifyNativeEth({ intent, recipient, txHash, rpcUrls, fetchImpl = fetch }) {
  const hash = normalizedHex(txHash, HASH);
  if (!hash) fail(400, 'Invalid Ethereum transaction reference.');
  const saved = parseIntent(intent, recipient);
  const adapters = adaptersFor(rpcUrls, fetchImpl);
  const [primary, secondary] = await Promise.all(adapters.map(call => proofAt(call, saved, hash)));

  if (primary.state === 'pending' || secondary.state === 'pending') return { state: 'pending' };
  if (primary.state !== secondary.state) fail(503, UNAVAILABLE);
  if (primary.state === 'unmatched') return { state: 'unmatched' };
  if (primary.parentHash !== secondary.parentHash || primary.recipientHasCode !== secondary.recipientHasCode ||
      Object.keys(primary.proof).some(key => primary.proof[key] !== secondary.proof[key])) fail(503, UNAVAILABLE);

  // The faster provider must agree on the other provider's finalized chain history.
  const finalized = await agreedHead(adapters, [primary.head, secondary.head]);
  const proof = {
    ...primary.proof,
    finalized_number: finalized.number.toString(),
    recipient_has_code: primary.recipientHasCode
  };

  if (BigInt(proof.block_number) < saved.startBlock || proof.block_timestamp < saved.after ||
      proof.block_timestamp >= saved.before) {
    return { state: 'review', reason: 'outside_quote_window', proof };
  }
  if (primary.recipientHasCode) return { state: 'review', reason: 'recipient_code_present', proof };
  return { state: 'verified', proof };
}

module.exports = {
  createInvoiceReference, invoiceCalldata, normalizeNativeEthRpcUrls, readNativeEthQuoteAnchor, verifyNativeEth
};
