'use strict';

const { createHash, randomBytes, verify } = require('node:crypto');

const GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const TOKEN = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const DECIMALS = 6;
const MAX_U64 = (1n << 64n) - 1n;
const MAX_TRANSACTION_BYTES = 1232;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function unavailable() {
  fail(503, 'Solana verification is temporarily unavailable. Your payment remains pending.');
}

function mismatch() {
  fail(409, 'The transaction does not contain the exact USDC payment for this order.');
}

function decodeBase58(value, length) {
  if (typeof value !== 'string' || value.length < length || value.length > Math.ceil(length * 1.37)) return null;
  let number = 0n;
  let zeroes = 0;
  while (value[zeroes] === '1') zeroes++;
  for (const character of value.slice(zeroes)) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }
  const bytes = Buffer.alloc(length);
  let index = length - 1;
  while (number && index >= zeroes) {
    bytes[index--] = Number(number & 255n);
    number >>= 8n;
  }
  return number === 0n && index === zeroes - 1 ? bytes : null;
}

function encodeBase58(bytes) {
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let value = '';
  while (number) {
    value = BASE58[Number(number % 58n)] + value;
    number /= 58n;
  }
  let zeroes = 0;
  while (bytes[zeroes] === 0) zeroes++;
  return '1'.repeat(zeroes) + value;
}

const isPublicKey = value => decodeBase58(value, 32) !== null;
const isSignature = value => decodeBase58(value, 64) !== null && value !== '1'.repeat(64);
const isWalletAddress = value => isPublicKey(value) && value !== SYSTEM_PROGRAM;
const createReference = () => encodeBase58(randomBytes(32));

const FIELD = (1n << 255n) - 19n;
const EDWARDS_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

function modPow(base, exponent) {
  let result = 1n;
  while (exponent) {
    if (exponent & 1n) result = result * base % FIELD;
    base = base * base % FIELD;
    exponent >>= 1n;
  }
  return result;
}

function isOnCurve(bytes) {
  const y = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`) & ((1n << 255n) - 1n);
  const ySquared = y * y % FIELD;
  // x² = (y² - 1) / (d*y² + 1). Multiplying by the denominator
  // instead of dividing preserves whether the result is a square.
  const numerator = (ySquared + FIELD - 1n) % FIELD;
  const denominator = (EDWARDS_D * ySquared + 1n) % FIELD;
  return denominator !== 0n && (numerator === 0n || modPow(numerator * denominator % FIELD, (FIELD - 1n) / 2n) === 1n);
}

function recipientTokenAccount(owner) {
  if (!isWalletAddress(owner)) fail(400, 'Invalid Solana recipient address.');
  const seeds = Buffer.concat([decodeBase58(owner, 32), decodeBase58(TOKEN_PROGRAM, 32), decodeBase58(TOKEN, 32)]);
  const program = decodeBase58(ASSOCIATED_TOKEN_PROGRAM, 32);
  const marker = Buffer.from('ProgramDerivedAddress', 'ascii');
  for (let bump = 255; bump > 0; bump--) {
    const address = createHash('sha256').update(seeds).update(Buffer.from([bump])).update(program).update(marker).digest();
    if (!isOnCurve(address)) return encodeBase58(address);
  }
  unavailable();
}

function rpcEndpoint(value) {
  try {
    const url = new URL(value);
    const domain = url.hostname.replace(/\.$/, '').split('.');
    if (url.protocol === 'https:' && !url.username && !url.password && !url.hash && domain.length >= 2 && /[a-z]/.test(domain.at(-1))) {
      return { url: url.href, domain: domain.slice(-2).join('.') };
    }
  } catch {
    // Configuration errors use the same message as unavailable endpoints.
  }
  return null;
}

function endpoints(rpc, secondary) {
  const primary = rpcEndpoint(rpc);
  const backup = rpcEndpoint(secondary);
  // Distinct DNS domains are a configuration guard. Configure separate RPC operators.
  if (!primary || !backup || primary.domain === backup.domain) unavailable();
  return [primary.url, backup.url];
}

async function rpcRead(url, method, params, fetchImpl, limit = 131072) {
  let response;
  let data;
  try {
    response = await fetchImpl(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error('Invalid response size');
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) throw new Error('Response too large');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    data = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } catch {
    unavailable();
  }
  if (!response.ok || data?.jsonrpc !== '2.0' || data.id !== 1 || Object.hasOwn(data, 'error') || !Object.hasOwn(data, 'result')) unavailable();
  return data.result;
}

function units(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_U64 ? parsed : null;
}

const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

async function assertMainnet(url, fetchImpl) {
  if (await rpcRead(url, 'getGenesisHash', [], fetchImpl) !== GENESIS_HASH) unavailable();
}

function tokenAccountInfo(account, type) {
  if (account?.owner !== TOKEN_PROGRAM || account.executable !== false || account.data?.program !== 'spl-token' || account.data.parsed?.type !== type) unavailable();
  return account.data.parsed.info;
}

async function verifyReceivingRoute({ rpc, secondary, recipient }, fetchImpl = fetch) {
  const destination = recipientTokenAccount(recipient);
  await Promise.all(endpoints(rpc, secondary).map(async url => {
    await assertMainnet(url, fetchImpl);
    const accounts = await rpcRead(url, 'getMultipleAccounts', [[TOKEN, destination], {
      encoding: 'jsonParsed', commitment: 'finalized'
    }], fetchImpl);
    if (!positiveInteger(accounts?.context?.slot) || !Array.isArray(accounts.value) || accounts.value.length !== 2) unavailable();
    const mint = tokenAccountInfo(accounts.value[0], 'mint');
    const ata = tokenAccountInfo(accounts.value[1], 'account');
    if (mint?.isInitialized !== true || mint.decimals !== DECIMALS || ata?.state !== 'initialized' || ata.owner !== recipient ||
        ata.mint !== TOKEN || ata.tokenAmount?.decimals !== DECIMALS || units(ata.tokenAmount.amount) === null) unavailable();
  }));
  return { genesis_hash: GENESIS_HASH, token: TOKEN, recipient, recipient_token_account: destination, decimals: DECIMALS };
}

// Build the exact transaction a compatible wallet can sign. No private keys or
// broadcasts are involved here. The readonly reference is part of the signature.
async function prepareTransfer({ rpc, secondary, recipient, payer, reference, amountUnits }, fetchImpl = fetch) {
  const amount = units(amountUnits);
  if (!amount || !isWalletAddress(payer) || !isWalletAddress(reference) || !isWalletAddress(recipient)) {
    fail(400, 'Invalid Solana payment details.');
  }
  const source = recipientTokenAccount(payer);
  const destination = recipientTokenAccount(recipient);
  const accounts = [payer, source, destination, TOKEN, reference, TOKEN_PROGRAM];
  if (!isOnCurve(decodeBase58(payer, 32)) || new Set([recipient, ...accounts]).size !== accounts.length + 1) {
    fail(400, 'Use a standard Solana wallet to pay this order.');
  }
  const urls = endpoints(rpc, secondary);
  await Promise.all(urls.map(async url => {
    await assertMainnet(url, fetchImpl);
    const accounts = await rpcRead(url, 'getMultipleAccounts', [[TOKEN, source, destination], {
      encoding: 'jsonParsed', commitment: 'finalized'
    }], fetchImpl);
    if (!positiveInteger(accounts?.context?.slot) || !Array.isArray(accounts.value) || accounts.value.length !== 3) unavailable();
    const mint = tokenAccountInfo(accounts.value[0], 'mint');
    const recipientAccount = tokenAccountInfo(accounts.value[2], 'account');
    if (mint?.isInitialized !== true || mint.decimals !== DECIMALS || recipientAccount?.state !== 'initialized' ||
        recipientAccount.owner !== recipient || recipientAccount.mint !== TOKEN ||
        recipientAccount.tokenAmount?.decimals !== DECIMALS || units(recipientAccount.tokenAmount.amount) === null) unavailable();
    if (accounts.value[1] === null) fail(409, 'The connected wallet needs native Solana USDC to pay this order.');
    const payerAccount = tokenAccountInfo(accounts.value[1], 'account');
    const balance = units(payerAccount?.tokenAmount?.amount);
    if (payerAccount?.state !== 'initialized' || payerAccount.owner !== payer || payerAccount.mint !== TOKEN ||
        payerAccount.tokenAmount?.decimals !== DECIMALS || balance === null) unavailable();
    if (balance < amount) fail(409, 'The connected wallet has insufficient native Solana USDC for this order.');
  }));
  const block = await rpcRead(urls[0], 'getLatestBlockhash', [{ commitment: 'finalized' }], fetchImpl);
  const blockHash = decodeBase58(block?.value?.blockhash, 32);
  if (!blockHash || !positiveInteger(block?.context?.slot) || !positiveInteger(block?.value?.lastValidBlockHeight)) unavailable();
  await Promise.all(urls.map(async url => {
    const validity = await rpcRead(url, 'isBlockhashValid', [block.value.blockhash, { commitment: 'confirmed', minContextSlot: block.context.slot }], fetchImpl);
    if (validity?.value !== true || !positiveInteger(validity.context?.slot) || validity.context.slot < block.context.slot) unavailable();
  }));
  const amountData = Buffer.alloc(10);
  amountData[0] = 12; // SPL Token TransferChecked.
  amountData.writeBigUInt64LE(amount, 1);
  amountData[9] = DECIMALS;
  const unsigned = Buffer.concat([
    Buffer.from([1]), Buffer.alloc(64), Buffer.from([1, 0, 3, accounts.length]),
    ...accounts.map(account => decodeBase58(account, 32)), blockHash,
    Buffer.from([1, 5, 5, 1, 3, 2, 0, 4, amountData.length]), amountData
  ]);
  return { transaction: unsigned.toString('base64'), last_valid_block_height: block.value.lastValidBlockHeight };
}

function parseTransaction(wire) {
  if (!Array.isArray(wire) || wire.length !== 2 || wire[1] !== 'base64' || typeof wire[0] !== 'string' || wire[0].length > Math.ceil(MAX_TRANSACTION_BYTES / 3) * 4) unavailable();
  const bytes = Buffer.from(wire[0], 'base64');
  if (bytes.length > MAX_TRANSACTION_BYTES || bytes.toString('base64') !== wire[0]) unavailable();
  let offset = 0;
  function read(length) {
    if (offset + length > bytes.length) unavailable();
    const part = bytes.subarray(offset, offset + length);
    offset += length;
    return part;
  }
  const byte = () => read(1)[0];
  function shortLength() {
    // Solana compact-u16 lengths use at most three bytes and forbid aliases.
    const low = byte();
    if (low < 128) return low;
    const middle = byte();
    if (middle === 0) unavailable();
    if (middle < 128) return (low & 127) + (middle << 7);
    const high = byte();
    if (high < 1 || high > 3) unavailable();
    return (low & 127) + ((middle & 127) << 7) + (high << 14);
  }

  const signatureCount = shortLength();
  if (signatureCount < 1) unavailable();
  const signatures = read(signatureCount * 64);
  const messageOffset = offset;
  const marker = byte();
  const legacy = marker < 128;
  if (!legacy && marker !== 128) mismatch();
  const signerCount = legacy ? marker : byte();
  const readonlySigners = byte();
  const readonlyUnsigned = byte();
  const accountCount = shortLength();
  const accountBytes = read(accountCount * 32);
  if (signerCount !== signatureCount || signerCount <= readonlySigners || signerCount + readonlyUnsigned > accountCount) unavailable();
  const accounts = [];
  for (let index = 0; index < accountCount; index++) {
    accounts.push(encodeBase58(accountBytes.subarray(index * 32, (index + 1) * 32)));
  }
  read(32); // Recent blockhash, covered by the signature.
  const instructions = [];
  const instructionCount = shortLength();
  for (let index = 0; index < instructionCount; index++) {
    const program = byte();
    const keys = read(shortLength());
    const data = read(shortLength());
    instructions.push({ program, keys, data });
  }
  if (!legacy && shortLength() !== 0) mismatch();
  if (offset !== bytes.length || new Set(accounts).size !== accounts.length) unavailable();
  return { bytes: bytes.subarray(messageOffset), signatures, accountBytes, accounts, signerCount, readonlyUnsigned, instructions, version: legacy ? 'legacy' : 0 };
}

function verifySignedTransaction(signed, unsigned) {
  // Payment only accepts the complete transaction bytes prepared for this invoice.
  // A wallet must return the same message with its sole Ed25519 signature filled in.
  if (typeof signed !== 'string' || typeof unsigned !== 'string' || signed.length !== 416 || unsigned.length !== 416) {
    fail(400, 'Invalid signed Solana transaction.');
  }
  const bytes = Buffer.from(signed, 'base64');
  const saved = Buffer.from(unsigned, 'base64');
  if (bytes.length !== 312 || saved.length !== 312 || bytes.toString('base64') !== signed || bytes[0] !== 1 || !bytes.subarray(65).equals(saved.subarray(65))) {
    fail(409, 'The wallet changed the saved transaction. Check your order before sending a payment.');
  }
  const signature = bytes.subarray(1, 65);
  const key = { key: Buffer.concat([ED25519_SPKI, bytes.subarray(69, 101)]), format: 'der', type: 'spki' };
  if (!verify(null, bytes.subarray(65), key, signature)) fail(409, 'The wallet signature does not match this order.');
  return encodeBase58(signature);
}

async function preparedTransferUsable(config, intent, fetchImpl = fetch) {
  const bytes = Buffer.from(intent.unsigned_transaction, 'base64');
  const height = Number(intent.last_valid_block_height);
  if (bytes.length !== 312 || !positiveInteger(height)) unavailable();
  const blockhash = encodeBase58(bytes.subarray(261, 293));
  const results = await Promise.all(endpoints(config.rpc, config.secondary).map(async url => {
    await assertMainnet(url, fetchImpl);
    const [finalizedHeight, validity] = await Promise.all([
      rpcRead(url, 'getBlockHeight', [{ commitment: 'finalized' }], fetchImpl),
      rpcRead(url, 'isBlockhashValid', [blockhash, { commitment: 'confirmed' }], fetchImpl)
    ]);
    if (!positiveInteger(finalizedHeight) || !positiveInteger(validity?.context?.slot) || typeof validity.value !== 'boolean') unavailable();
    return { height: finalizedHeight, valid: validity.value };
  }));
  // Expiry only stops a fresh signing/broadcast prompt. It never proves nonpayment.
  return results.every(result => result.height <= height && result.valid);
}

async function broadcastSignedTransaction(config, signed, signature, fetchImpl = fetch) {
  // A retry sends the identical signature and cannot create a second transfer.
  const [primary] = endpoints(config.rpc, config.secondary);
  await assertMainnet(primary, fetchImpl);
  const result = await rpcRead(primary, 'sendTransaction', [signed, {
    encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2
  }], fetchImpl);
  if (result !== signature) unavailable();
}

async function findFinalizedSignatures(config, reference, fetchImpl = fetch) {
  if (!isPublicKey(reference)) fail(400, 'Invalid Solana payment reference.');
  const results = await Promise.allSettled(endpoints(config.rpc, config.secondary).map(async url => {
    await assertMainnet(url, fetchImpl);
    const rows = await rpcRead(url, 'getSignaturesForAddress', [reference, { commitment: 'finalized', limit: 8 }], fetchImpl);
    if (!Array.isArray(rows) || rows.length > 8 || rows.some(row => !isSignature(row?.signature) || !positiveInteger(row.slot))) unavailable();
    return rows.filter(row => row.err === null).map(row => row.signature);
  }));
  if (results.every(result => result.status === 'rejected')) unavailable();
  // Discovery is advisory. Any candidate still requires two full finalized proofs.
  return [...new Set(results.flatMap(result => result.status === 'fulfilled' ? result.value : []))];
}

function tokenTransfer(message, expected) {
  const { accounts, instructions, signerCount, readonlyUnsigned } = message;
  if (signerCount !== 1 || accounts[0] !== expected.payer || instructions.length < 1 || instructions.length > 3) mismatch();
  const writable = index => index < accounts.length - readonlyUnsigned;
  const usedAccounts = new Set([0]);
  const computeSettings = new Set();
  for (const { program, keys, data } of instructions.slice(0, -1)) {
    const kind = data[0];
    if (accounts[program] !== COMPUTE_BUDGET_PROGRAM || writable(program) || keys.length || computeSettings.has(kind)) mismatch();
    if (!(kind === 2 && data.length === 5 && data.readUInt32LE(1) > 0 && data.readUInt32LE(1) <= 1400000) && !(kind === 3 && data.length === 9)) mismatch();
    computeSettings.add(kind);
    usedAccounts.add(program);
  }

  const { program, keys, data } = instructions.at(-1);
  const checked = data[0] === 12 && data.length === 10 && data[9] === DECIMALS;
  const unchecked = data[0] === 3 && data.length === 9;
  if ((!checked && !unchecked) || accounts[program] !== TOKEN_PROGRAM || writable(program) || keys.length !== (checked ? 5 : 4) || new Set(keys).size !== keys.length) mismatch();
  const [source, destination, authority, reference] = checked ? [keys[0], keys[2], keys[3], keys[4]] : keys;
  if (checked && (accounts[keys[1]] !== TOKEN || writable(keys[1]))) mismatch();
  if (authority !== 0 || accounts[destination] !== expected.destination || !writable(destination) || !accounts[source] || !writable(source) ||
      accounts[reference] !== expected.reference || writable(reference) || data.readBigUInt64LE(1) !== expected.amount) mismatch();
  for (const index of keys) usedAccounts.add(index);
  usedAccounts.add(program);
  if (usedAccounts.size !== accounts.length) mismatch();
  return { source, destination, index: instructions.length - 1 };
}

function paymentBalances(entries, source, destination, payer, recipient) {
  if (!Array.isArray(entries) || entries.length !== 2) unavailable();
  const balances = new Map();
  for (const entry of entries) {
    if ((entry?.accountIndex !== source && entry?.accountIndex !== destination) || balances.has(entry.accountIndex)) unavailable();
    const owner = entry.accountIndex === source ? payer : recipient;
    const amount = units(entry.uiTokenAmount?.amount);
    if (amount === null || !isPublicKey(entry.mint) || !isPublicKey(entry.owner) || !isPublicKey(entry.programId) ||
        !Number.isInteger(entry.uiTokenAmount?.decimals)) unavailable();
    if (entry.mint !== TOKEN || entry.owner !== owner || entry.programId !== TOKEN_PROGRAM || entry.uiTokenAmount.decimals !== DECIMALS) mismatch();
    balances.set(entry.accountIndex, amount);
  }
  return { source: balances.get(source), destination: balances.get(destination) };
}

async function proofAt(url, expected, fetchImpl) {
  await assertMainnet(url, fetchImpl);
  const result = await rpcRead(url, 'getTransaction', [expected.signature, {
    commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0
  }], fetchImpl);
  if (result === null) return null;
  const { meta, slot, blockTime, transaction, version } = result;
  if (!positiveInteger(slot) || !positiveInteger(blockTime) || !meta || !Object.hasOwn(meta, 'err')) unavailable();
  if (meta.err !== null) mismatch();
  if (Object.hasOwn(meta, 'status') && (meta.status?.Ok !== null || Object.keys(meta.status).length !== 1)) unavailable();
  if (!Array.isArray(meta.innerInstructions)) unavailable();
  if (meta.innerInstructions.length) mismatch();
  if (meta.loadedAddresses != null && (!Array.isArray(meta.loadedAddresses.readonly) || !Array.isArray(meta.loadedAddresses.writable) || meta.loadedAddresses.readonly.length || meta.loadedAddresses.writable.length)) unavailable();
  if (blockTime < expected.validAfter || blockTime >= expected.validBefore) mismatch();
  const message = parseTransaction(transaction);
  const signature = message.signatures.subarray(0, 64);
  if (message.version !== version || encodeBase58(signature) !== expected.signature) unavailable();
  const key = { key: Buffer.concat([ED25519_SPKI, message.accountBytes.subarray(0, 32)]), format: 'der', type: 'spki' };
  if (!verify(null, message.bytes, key, signature)) unavailable();
  const { source, destination, index } = tokenTransfer(message, expected);
  const pre = paymentBalances(meta.preTokenBalances, source, destination, expected.payer, expected.recipient);
  const post = paymentBalances(meta.postTokenBalances, source, destination, expected.payer, expected.recipient);
  if (pre.source - post.source !== expected.amount || post.destination - pre.destination !== expected.amount) mismatch();
  const block = await rpcRead(url, 'getBlock', [slot, {
    commitment: 'finalized', encoding: 'json', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 0
  }], fetchImpl, 2097152);
  if (!isPublicKey(block?.blockhash) || block.blockTime !== blockTime || !Array.isArray(block.signatures) ||
      block.signatures.filter(candidate => candidate === expected.signature).length !== 1) unavailable();
  return {
    pre, post, wire: transaction[0],
    proof: {
      genesis_hash: GENESIS_HASH, token: TOKEN, recipient: expected.recipient, recipient_token_account: expected.destination,
      payer: expected.payer, payer_token_account: message.accounts[source], reference: expected.reference,
      amount_units: expected.amount.toString(), tx_signature: expected.signature, slot,
      block_hash: block.blockhash, block_timestamp: blockTime, instruction_index: index
    }
  };
}

async function verifyPayment({ rpc, secondary, signature, recipient, payer, reference, amountUnits, validAfter, validBefore }, fetchImpl = fetch) {
  const amount = units(amountUnits);
  if (!isSignature(signature) || !isWalletAddress(payer) || !isWalletAddress(reference) || !isWalletAddress(recipient) ||
      new Set([payer, reference, recipient, TOKEN, TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM]).size !== 6 || !amount ||
      !positiveInteger(validAfter) || !positiveInteger(validBefore) || validBefore <= validAfter) fail(400, 'Invalid Solana payment verification details.');
  const destination = recipientTokenAccount(recipient);
  const expected = { signature, recipient, payer, reference, amount, destination, validAfter, validBefore };
  const [primary, backup] = await Promise.allSettled(endpoints(rpc, secondary).map(url => proofAt(url, expected, fetchImpl)));
  // A reference alone is public and can be attached to other transactions. Only
  // both finalized views of the payer's signed transfer and exact balance changes count.
  if (primary.status === 'rejected' || backup.status === 'rejected') {
    if (primary.reason?.status === 409 && backup.reason?.status === 409) mismatch();
    unavailable();
  }
  if (!primary.value || !backup.value) return { pending: true };
  const a = primary.value;
  const b = backup.value;
  if (a.wire !== b.wire || a.pre.source !== b.pre.source || a.pre.destination !== b.pre.destination ||
      a.post.source !== b.post.source || a.post.destination !== b.post.destination || JSON.stringify(a.proof) !== JSON.stringify(b.proof)) unavailable();
  return a.proof;
}

module.exports = {
  GENESIS_HASH, TOKEN, TOKEN_PROGRAM, DECIMALS, isPublicKey, isWalletAddress, isSignature, rpcEndpoint, createReference, recipientTokenAccount, verifyReceivingRoute, prepareTransfer, preparedTransferUsable, verifySignedTransaction, broadcastSignedTransaction, findFinalizedSignatures, verifyPayment
};
