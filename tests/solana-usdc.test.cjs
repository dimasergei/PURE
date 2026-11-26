'use strict';

const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID, sign } = require('node:crypto');
const checkout = require('../lib/solana-usdc-checkout');
const { test } = require('node:test');
const {
  GENESIS_HASH, TOKEN, TOKEN_PROGRAM, DECIMALS, isPublicKey, isSignature, createReference,
  recipientTokenAccount, verifyReceivingRoute, prepareTransfer, verifyPayment
} = require('../lib/solana-usdc');

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const RPC = 'https://solana.rpc-one.test/key';
const SECONDARY_RPC = 'https://mainnet.rpc-two.test/key';
const RECIPIENT = '9WzDXwBbmkg8ZTbNMqUx6mC93iFUHfeQVsCe7xmBzqX1';
const ATA = 'D8gYAG7W54tLRBX6qC1CJkjStRG8GXKzTxtcmxneoAyx';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const BLOCK_HASH = '7YttLkHDoNj9wyDur5nM1ejGJU8rs8e5reei7qsdHgFH';
const BLOCK_TIME = 1795705000;
const SLOT = 473704329;
const AMOUNT = 9007199254740993n;

function pubkeyBytes(text) {
  let value = 0n;
  for (const letter of text) value = value * 58n + BigInt(BASE58.indexOf(letter));
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

function base58(bytes) {
  const digits = [];
  let prefix = '';
  for (const byte of bytes) {
    if (!digits.length && byte === 0) {
      prefix += '1';
      continue;
    }
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return prefix + digits.reverse().map(digit => BASE58[digit]).join('');
}

function tokenBalance(accountIndex, owner, amount) {
  return { accountIndex, mint: TOKEN, owner, programId: TOKEN_PROGRAM, uiTokenAmount: { amount: amount.toString(), decimals: DECIMALS } };
}

function instruction(program, accounts, data) {
  return Buffer.from([program, accounts.length, ...accounts, data.length, ...data]);
}

function captureTransfer({ checked = true, version = 'legacy', compute = false, change, amount = AMOUNT, checkoutWire = false } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payer = base58(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const reference = createReference();
  const source = createReference();
  const accounts = checkoutWire ? [payer, source, ATA, TOKEN, reference, TOKEN_PROGRAM] : [payer, source, ATA, reference, TOKEN_PROGRAM];
  const indexes = checkoutWire ? [1, 3, 2, 0, 4] : checked ? [1, accounts.push(TOKEN) - 1, 2, 0, 3] : [1, 2, 0, 3];
  const transfer = Buffer.alloc(checked ? 10 : 9);
  transfer[0] = checked ? 12 : 3;
  transfer.writeBigUInt64LE(amount, 1);
  if (checked) transfer[9] = DECIMALS;
  const instructions = [instruction(checkoutWire ? 5 : 4, indexes, transfer)];
  if (compute) {
    const program = accounts.push(COMPUTE_BUDGET) - 1;
    instructions.unshift(instruction(program, [], [2, 64, 66, 15, 0]), instruction(program, [], [3, 1, 0, 0, 0, 0, 0, 0, 0]));
  }
  const wire = { accounts, indexes, transfer, instructions, readonlyUnsigned: accounts.length - 3, header: version === 'legacy' ? [] : [0x80], lookup: version === 'legacy' ? [] : [0] };
  change?.(wire);
  const message = Buffer.concat([
    Buffer.from([...wire.header, 1, 0, wire.readonlyUnsigned, wire.accounts.length]),
    ...wire.accounts.map(pubkeyBytes), pubkeyBytes(BLOCK_HASH), Buffer.from([wire.instructions.length]), ...wire.instructions, Buffer.from(wire.lookup)
  ]);
  const signatureBytes = sign(null, message, privateKey);
  const signature = base58(signatureBytes);
  const transaction = [Buffer.concat([Buffer.from([1]), signatureBytes, message]).toString('base64'), 'base64'];
  return {
    expected: { rpc: RPC, secondary: SECONDARY_RPC, signature, recipient: RECIPIENT, payer, reference, amountUnits: amount.toString(), validAfter: BLOCK_TIME, validBefore: BLOCK_TIME + 60 },
    transaction: {
      slot: SLOT, blockTime: BLOCK_TIME, version, transaction,
      meta: {
        err: null, status: { Ok: null }, innerInstructions: [], loadedAddresses: { writable: [], readonly: [] },
        preTokenBalances: [tokenBalance(1, payer, amount + 99n), tokenBalance(2, RECIPIENT, 100n)],
        postTokenBalances: [tokenBalance(2, RECIPIENT, amount + 100n), tokenBalance(1, payer, 99n)]
      }
    },
    block: { blockhash: BLOCK_HASH, blockTime: BLOCK_TIME, signatures: [signature] },
    source
  };
}

function rpcFixture(fixture, alter = value => value) {
  const seen = [];
  return {
    seen,
    fetch: async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'POST');
      const { method, id, params } = JSON.parse(options.body);
      seen.push({ url, method, params });
      const values = {
        getGenesisHash: GENESIS_HASH, getTransaction: fixture.transaction,
        getBlock: fixture.block, getMultipleAccounts: fixture.accounts,
        getLatestBlockhash: fixture.latestBlock, isBlockhashValid: fixture.blockValidity,
        getBlockHeight: fixture.blockHeight, getSignaturesForAddress: fixture.signatures
      };
      assert.ok(Object.hasOwn(values, method));
      const result = alter(structuredClone(values[method]), method, url);
      return Response.json({ jsonrpc: '2.0', id, result });
    }
  };
}

test('derives the canonical native USDC account and generates a 32-byte reference', () => {
  assert.equal(recipientTokenAccount(RECIPIENT), ATA);
  assert.equal(isPublicKey('11111111111111111111111111111111'), true);
  assert.equal(isPublicKey('111111111111111111111111111111111'), false);
  assert.equal(isPublicKey('O'.repeat(32)), false);
  assert.equal(isSignature('1'.repeat(64)), false);
  const reference = createReference();
  assert.equal(isPublicKey(reference), true);
  assert.notEqual(createReference(), reference);
});

test('verifies one signed native USDC TransferChecked in both finalized views', async () => {
  const fixture = captureTransfer({ version: 0, compute: true });
  const transport = rpcFixture(fixture);
  const receipt = await verifyPayment(fixture.expected, transport.fetch);
  assert.deepEqual(receipt, {
    genesis_hash: GENESIS_HASH, token: TOKEN, recipient: RECIPIENT, recipient_token_account: ATA,
    payer: fixture.expected.payer, payer_token_account: fixture.source, reference: fixture.expected.reference,
    amount_units: AMOUNT.toString(), tx_signature: fixture.expected.signature, slot: SLOT,
    block_hash: BLOCK_HASH, block_timestamp: BLOCK_TIME, instruction_index: 2
  });
  for (const url of [RPC, SECONDARY_RPC]) {
    const calls = transport.seen.filter(call => call.url === url);
    assert.deepEqual(calls.map(call => call.method), ['getGenesisHash', 'getTransaction', 'getBlock']);
    assert.deepEqual(calls[1].params, [fixture.expected.signature, { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 }]);
    assert.deepEqual(calls[2].params, [SLOT, { commitment: 'finalized', encoding: 'json', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 0 }]);
  }
});

test('accepts a legacy SPL Transfer when both token balance snapshots bind the native mint', async () => {
  const fixture = captureTransfer({ checked: false });
  const proof = await verifyPayment(fixture.expected, rpcFixture(fixture).fetch);
  assert.equal(proof.instruction_index, 0);
  assert.equal(proof.amount_units, AMOUNT.toString());
});

test('requires the payer, merchant ATA, exact units and signed reference in the transfer', async () => {
  const fixture = captureTransfer();
  for (const expected of [
    { payer: createReference() }, { recipient: createReference() }, { reference: createReference() },
    { amountUnits: (AMOUNT - 1n).toString() }, { validAfter: BLOCK_TIME + 1 }, { validBefore: BLOCK_TIME, validAfter: BLOCK_TIME - 10 }
  ]) {
    await assert.rejects(verifyPayment({ ...fixture.expected, ...expected }, rpcFixture(fixture).fetch), { status: 409 });
  }
});

test('rejects a signed transaction with writable or misplaced reference, unrelated instructions or another transfer', async () => {
  const changes = [
    wire => { wire.readonlyUnsigned--; },
    wire => { wire.instructions[0] = instruction(4, [1, 5, 2, 3, 0], wire.transfer); },
    wire => { wire.instructions[0] = instruction(4, wire.indexes.slice(0, -1), wire.transfer); },
    wire => { wire.instructions.push(instruction(4, wire.indexes, wire.transfer)); },
    wire => { wire.instructions.unshift(instruction(3, [], [0])); },
    wire => { wire.instructions.unshift(instruction(4, [], [2, 64, 66, 15, 0])); }
  ];
  for (const change of changes) {
    const fixture = captureTransfer({ change });
    await assert.rejects(verifyPayment(fixture.expected, rpcFixture(fixture).fetch), { status: 409 });
  }
});

test('rejects wrong original owner, substitute mint, incorrect balance, or failed execution', async () => {
  const fixture = captureTransfer({ checked: false });
  for (const change of [
    meta => { meta.preTokenBalances[0].owner = createReference(); },
    meta => { meta.preTokenBalances[0].mint = createReference(); },
    meta => { meta.postTokenBalances[0].uiTokenAmount.amount = AMOUNT.toString(); },
    meta => { meta.innerInstructions = [{ index: 0, instructions: [{}] }]; },
    meta => { meta.err = { InstructionError: [0, 'InsufficientFunds'] }; }
  ]) {
    const transport = rpcFixture(fixture, (result, method) => {
      if (method === 'getTransaction') change(result.meta);
      return result;
    });
    await assert.rejects(verifyPayment(fixture.expected, transport.fetch), { status: 409 });
  }
});

test('fails closed for missing or ambiguous token and transaction metadata', async () => {
  const fixture = captureTransfer();
  for (const change of [
    meta => { delete meta.err; }, meta => { meta.innerInstructions = null; },
    meta => { meta.postTokenBalances = null; }, meta => { meta.preTokenBalances[1] = meta.preTokenBalances[0]; },
    meta => { delete meta.preTokenBalances[1].owner; }, meta => { delete meta.postTokenBalances[1].programId; },
    meta => { meta.postTokenBalances[0].uiTokenAmount.amount = Number(AMOUNT); }, meta => { meta.status = { Err: 'AccountNotFound' }; }
  ]) {
    const transport = rpcFixture(fixture, (result, method) => {
      if (method === 'getTransaction') change(result.meta);
      return result;
    });
    await assert.rejects(verifyPayment(fixture.expected, transport.fetch), { status: 503 });
  }
});

test('requires the requested signature over untampered transaction bytes', async () => {
  const fixture = captureTransfer();
  await assert.rejects(verifyPayment({ ...fixture.expected, signature: base58(Buffer.alloc(64, 42)) }, rpcFixture(fixture).fetch), { status: 503 });
  const transport = rpcFixture(fixture, (result, method) => {
    if (method === 'getTransaction') {
      const bytes = Buffer.from(result.transaction[0], 'base64');
      bytes[bytes.length - 2] ^= 1;
      result.transaction[0] = bytes.toString('base64');
    }
    return result;
  });
  await assert.rejects(verifyPayment(fixture.expected, transport.fetch), { status: 503 });
});

test('requires finalized mainnet block inclusion and agreement between RPC operators', async () => {
  const fixture = captureTransfer();
  const pending = rpcFixture(fixture, (result, method, url) => url === SECONDARY_RPC && method === 'getTransaction' ? null : result);
  assert.deepEqual(await verifyPayment(fixture.expected, pending.fetch), { pending: true });
  const changes = [
    (result, method) => method === 'getGenesisHash' ? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBGU' : result,
    (result, method) => method === 'getBlock' ? { ...result, blockhash: createReference() } : result,
    (result, method) => method === 'getBlock' ? { ...result, signatures: [] } : result,
    (result, method) => method === 'getBlock' ? { ...result, signatures: [...result.signatures, ...result.signatures] } : result,
    (result, method) => method === 'getBlock' ? { ...result, blockTime: BLOCK_TIME + 1 } : result,
    (result, method) => {
      if (method === 'getTransaction') {
        // The same delta with differing opening and closing balances is a disagreement.
        result.meta.preTokenBalances[0].uiTokenAmount.amount = (AMOUNT + 100n).toString();
        result.meta.postTokenBalances[1].uiTokenAmount.amount = '100';
      }
      return result;
    }
  ];
  for (const change of changes) {
    const transport = rpcFixture(fixture, (result, method, url) => url === SECONDARY_RPC ? change(result, method) : result);
    await assert.rejects(verifyPayment(fixture.expected, transport.fetch), { status: 503 });
  }
  await assert.rejects(verifyPayment({ ...fixture.expected, secondary: 'https://another.rpc-one.test/path' }, rpcFixture(fixture).fetch), { status: 503 });
});

test('readiness confirms the initialized native mint and exact receiving ATA with both operators', async () => {
  const account = (type, info) => ({ executable: false, owner: TOKEN_PROGRAM, data: { program: 'spl-token', parsed: { type, info } } });
  const fixture = { accounts: { context: { slot: SLOT }, value: [
    account('mint', { isInitialized: true, decimals: DECIMALS }),
    account('account', { state: 'initialized', owner: RECIPIENT, mint: TOKEN, tokenAmount: { decimals: DECIMALS, amount: '0' } })
  ] } };
  const config = { rpc: RPC, secondary: SECONDARY_RPC, recipient: RECIPIENT };
  const transport = rpcFixture(fixture);
  assert.deepEqual(await verifyReceivingRoute(config, transport.fetch), {
    genesis_hash: GENESIS_HASH, token: TOKEN, recipient: RECIPIENT, recipient_token_account: ATA, decimals: DECIMALS
  });
  assert.deepEqual(transport.seen.filter(call => call.method === 'getMultipleAccounts').map(call => call.params),
    Array(2).fill([[TOKEN, ATA], { encoding: 'jsonParsed', commitment: 'finalized' }]));
  for (const change of [
    value => { value[0].data.parsed.info.decimals = 9; }, value => { value[1] = null; },
    value => { value[1].data.parsed.info.state = 'frozen'; }, value => { value[1].data.parsed.info.owner = createReference(); }
  ]) {
    const invalid = rpcFixture(fixture, (result, method, url) => {
      if (url === SECONDARY_RPC && method === 'getMultipleAccounts') change(result.value);
      return result;
    });
    await assert.rejects(verifyReceivingRoute(config, invalid.fetch), { status: 503 });
  }
});


test('prepares only a native USDC transfer with payer authorization and an order reference', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payer = base58(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const source = recipientTokenAccount(payer);
  const reference = createReference();
  const account = (type, info) => ({ executable: false, owner: TOKEN_PROGRAM, data: { program: 'spl-token', parsed: { type, info } } });
  const tokenAccount = (owner, amount) => account('account', { state: 'initialized', mint: TOKEN, owner,
    tokenAmount: { decimals: DECIMALS, amount: amount.toString() } });
  const responses = {
    getGenesisHash: GENESIS_HASH,
    getMultipleAccounts: { context: { slot: SLOT }, value: [
      account('mint', { isInitialized: true, decimals: DECIMALS }), tokenAccount(payer, AMOUNT + 10n), tokenAccount(RECIPIENT, 0n)
    ] },
    getLatestBlockhash: { context: { slot: SLOT }, value: { blockhash: BLOCK_HASH, lastValidBlockHeight: SLOT + 100 } },
    isBlockhashValid: { context: { slot: SLOT + 1 }, value: true }
  };
  const calls = [];
  const mock = (change = value => value) => async (url, options) => {
    const { id, method, params } = JSON.parse(options.body);
    calls.push({ url, method, params });
    assert.ok(Object.hasOwn(responses, method));
    return Response.json({ jsonrpc: '2.0', id, result: change(structuredClone(responses[method]), method, url) });
  };
  const order = { rpc: RPC, secondary: SECONDARY_RPC, recipient: RECIPIENT, reference, payer, amountUnits: AMOUNT.toString() };
  const unsigned = await prepareTransfer(order, mock());
  assert.equal(unsigned.last_valid_block_height, SLOT + 100);
  assert.deepEqual(calls.filter(call => call.method === 'getMultipleAccounts').map(call => call.params[0]), [[TOKEN, source, ATA], [TOKEN, source, ATA]]);
  assert.deepEqual(calls.filter(call => call.method === 'isBlockhashValid').map(call => call.params[0]), [BLOCK_HASH, BLOCK_HASH]);
  const wire = Buffer.from(unsigned.transaction, 'base64');
  assert.equal(wire[0], 1);
  assert.equal(wire.subarray(1, 65).equals(Buffer.alloc(64)), true);
  const signature = sign(null, wire.subarray(65), privateKey);
  signature.copy(wire, 1);
  const signed = {
    transaction: { slot: SLOT, blockTime: BLOCK_TIME, version: 'legacy', transaction: [wire.toString('base64'), 'base64'], meta: {
      err: null, innerInstructions: [], preTokenBalances: [tokenBalance(1, payer, AMOUNT + 10n), tokenBalance(2, RECIPIENT, 0n)],
      postTokenBalances: [tokenBalance(1, payer, 10n), tokenBalance(2, RECIPIENT, AMOUNT)]
    } },
    block: { blockhash: BLOCK_HASH, blockTime: BLOCK_TIME, signatures: [base58(signature)] }
  };
  const proof = await verifyPayment({ ...order, signature: base58(signature), validAfter: BLOCK_TIME - 1, validBefore: BLOCK_TIME + 1 }, rpcFixture(signed).fetch);
  assert.equal(proof.payer_token_account, source);
  assert.equal(proof.recipient_token_account, ATA);
  assert.equal(proof.reference, reference);
  assert.equal(proof.amount_units, AMOUNT.toString());
  await assert.rejects(prepareTransfer(order, mock((value, method, url) => method === 'isBlockhashValid' && url === SECONDARY_RPC ? { ...value, value: false } : value)), { status: 503 });
  await assert.rejects(prepareTransfer({ ...order, amountUnits: (AMOUNT + 11n).toString() }, mock()), { status: 409 });
});

function checkoutFixture(amount = 2500) {
  const env = { SOLANA_USDC_ENABLED: 'true', SOLANA_USDC_RECIPIENT: RECIPIENT, SOLANA_USDC_RPC_URL: RPC, SOLANA_USDC_SECONDARY_RPC_URL: SECONDARY_RPC };
  const config = checkout.configuration(env);
  const invoice = { id: randomUUID(), method_id: randomUUID(), customer_id: randomUUID(), status: 'accepted', kind: 'goods',
    currency: 'USD', total_cents: amount, expires_at: new Date(Date.now() + 600000).toISOString() };
  const account = { provider: 'solana_usdc', method_id: invoice.method_id, mode: 'live', account_tag: config.account_tag,
    solana_usdc_recipient: config.recipient, solana_usdc_recipient_token_account: config.recipient_token_account, method: { active: true } };
  const customer = { id: invoice.customer_id };
  const signer = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
  const body = { attempt_id: randomUUID(), wallet_address: base58(signer.subarray(-32)), confirm_amount_cents: amount, confirm_currency: 'USD', consent: true };
  const commands = [];
  let intent = null;
  const db = {
    from: table => {
      if (table === 'commerce_solana_usdc_submissions') return { select: () => ({ eq: () => ({
        order: () => ({ limit: async () => ({ data: [] }) })
      }) }) };
      assert.equal(table, 'commerce_solana_usdc_intents');
      return { select: () => ({ eq: (field, id) => {
        assert.equal(field, 'invoice_id');
        assert.equal(id, invoice.id);
        return { maybeSingle: async () => ({ data: intent }) };
      } }) };
    },
    rpc: async (name, args) => {
      commands.push({ name, args });
      if (name === 'commerce_create_solana_usdc_intent') {
        intent = { ...args.p_intent, invoice_id: args.p_invoice, account_tag: args.p_account_tag, attempt_id: args.p_id, status: 'open' };
        return { data: intent };
      }
      if (name === 'commerce_note_solana_usdc_submission') return { data: intent };
      if (name === 'commerce_claim_solana_usdc_broadcast') return { data: { state: 'pending', tx_signature: args.p_signature } };
      assert.equal(name, 'commerce_finish_solana_usdc_payment');
      return { data: { state: 'paid', invoice_id: invoice.id } };
    }
  };
  return { env, config, invoice, account, customer, body, commands, db, useIntent: value => { intent = value; } };
}

test('Solana checkout verifies the configured ATA at both RPCs before persisting an order reference', async () => {
  const { env, config, invoice, account, customer, body, commands, db } = checkoutFixture();
  const s = await checkout.customerState(db, invoice, customer);
  assert.equal(s, null);
  assert.equal(checkout.configuration({ ...env, SOLANA_USDC_ENABLED: 'false' }).ready, false);
  assert.equal(checkout.configuration({ ...env, SOLANA_USDC_SECONDARY_RPC_URL: 'https://different.rpc-one.test' }).ready, false);
  const fakeAccount = (type, info) => ({ executable: false, owner: TOKEN_PROGRAM, data: { program: 'spl-token', parsed: { type, info } } });
  const fixture = { accounts: { context: { slot: SLOT }, value: [
    fakeAccount('mint', { isInitialized: true, decimals: DECIMALS }),
    fakeAccount('account', { state: 'initialized', owner: body.wallet_address, mint: TOKEN, tokenAmount: { decimals: DECIMALS, amount: '100000000' } }),
    fakeAccount('account', { state: 'initialized', owner: RECIPIENT, mint: TOKEN, tokenAmount: { decimals: DECIMALS, amount: '0' } })
  ] }, latestBlock: { context: { slot: SLOT }, value: { blockhash: BLOCK_HASH, lastValidBlockHeight: SLOT + 100 } },
    blockValidity: { context: { slot: SLOT }, value: true }, blockHeight: SLOT };
  const bad = rpcFixture(fixture, (result, method) => method === 'getMultipleAccounts' ? { ...result, value: [result.value[0], result.value[1], null] } : result);
  await assert.rejects(checkout.start(db, invoice, account, config, body, customer, bad.fetch), { status: 503 });
  assert.equal(commands.length, 0);
  const good = rpcFixture(fixture);
  await assert.rejects(checkout.start(db, invoice, account, config, body, { id: randomUUID() }, good.fetch), { status: 403 });
  await assert.rejects(checkout.start(db, invoice, account, config, { ...body, confirm_amount_cents: 1 }, customer, good.fetch), { status: 409 });
  assert.equal(good.seen.length, 0);
  const prepared = await checkout.start(db, invoice, account, config, body, customer, good.fetch);
  assert.equal(good.seen.filter(call => call.method === 'getMultipleAccounts').length, 2);
  assert.equal(commands[0].name, 'commerce_create_solana_usdc_intent');
  assert.equal(prepared.state, 'awaiting_wallet');
  assert.equal(prepared.intent.amount_units, '25000000');
  assert.equal(prepared.intent.recipient_token_account, ATA);
  assert.equal(prepared.intent.payer, body.wallet_address);
  assert.ok(isPublicKey(prepared.intent.reference));
  assert.equal(prepared.transaction.length, 416);
  assert.equal(prepared.last_valid_block_height, SLOT + 100);
  assert.equal((await checkout.customerState(db, invoice, customer)).transaction, undefined);
  assert.deepEqual(await checkout.start(db, invoice, account, config, body, customer, good.fetch), prepared);
  await assert.rejects(checkout.start(db, invoice, account, config, { ...body, wallet_address: createReference() }, customer, good.fetch), { status: 409 });
  assert.equal(commands.length, 1);
});

test('Solana checkout records candidate signatures before RPC and passes only an agreed proof to settlement', async () => {
  const { config, invoice, account, customer, commands, db, useIntent } = checkoutFixture();
  const fixture = captureTransfer({ amount: BigInt(invoice.total_cents) * 10000n });
  const attemptId = randomUUID();
  useIntent({ status: 'open', account_tag: config.account_tag, invoice_id: invoice.id, attempt_id: attemptId, recipient: RECIPIENT,
    recipient_token_account: ATA, payer: fixture.expected.payer, reference: fixture.expected.reference, amount_units: fixture.expected.amountUnits,
    valid_after: BLOCK_TIME - 10, valid_before: BLOCK_TIME });
  const body = { attempt_id: attemptId, tx_signature: fixture.expected.signature };
  await assert.rejects(checkout.confirm(db, invoice, account, config, { ...body, attempt_id: randomUUID() }, customer), { status: 409 });
  assert.equal(commands.length, 0);
  const fail = async () => {
    assert.equal(commands[0].name, 'commerce_note_solana_usdc_submission');
    assert.equal(commands[0].args.p_signature, fixture.expected.signature);
    throw new Error('Fixture outage');
  };
  await assert.rejects(checkout.confirm(db, invoice, account, config, body, customer, fail), { status: 503 });
  assert.equal(commands.length, 1);
  const pending = rpcFixture(fixture, (result, method) => method === 'getTransaction' ? null : result);
  assert.equal((await checkout.confirm(db, invoice, account, config, body, customer, pending.fetch)).state, 'pending');
  assert.equal(commands.length, 2);
  const transport = rpcFixture(fixture);
  assert.equal((await checkout.confirm(db, invoice, account, config, body, customer, transport.fetch)).state, 'paid');
  assert.equal(commands[3].name, 'commerce_finish_solana_usdc_payment');
  assert.equal(commands[3].args.p_proof.reference, fixture.expected.reference);
  assert.equal(commands[3].args.p_proof.block_timestamp, BLOCK_TIME);
  assert.equal(commands[3].args.p_proof.tx_signature, fixture.expected.signature);
});

function savedWalletPayment(invoice) {
  const captured = captureTransfer({ amount: BigInt(invoice.total_cents) * 10000n, checkoutWire: true });
  const signed = Buffer.from(captured.transaction.transaction[0], 'base64');
  const unsigned = Buffer.from(signed);
  unsigned.fill(0, 1, 65);
  const intent = { invoice_id: invoice.id, attempt_id: randomUUID(), status: 'open', recipient: RECIPIENT, recipient_token_account: ATA,
    payer: captured.expected.payer, reference: captured.expected.reference, amount_units: captured.expected.amountUnits,
    valid_after: BLOCK_TIME - 1, valid_before: BLOCK_TIME + 60, last_valid_block_height: SLOT + 100, unsigned_transaction: unsigned.toString('base64') };
  return { captured, intent, signed };
}

test('recovers an unsubmitted signature by reference and keeps payment pending until both proofs agree', async () => {
  const { config, invoice, account, customer, commands, db, useIntent } = checkoutFixture();
  const { captured, intent } = savedWalletPayment(invoice);
  useIntent({ ...intent, account_tag: config.account_tag });
  captured.signatures = [{ signature: captured.expected.signature, slot: SLOT, err: null }];
  const inconsistent = rpcFixture(captured, (result, method, url) => url === SECONDARY_RPC && method === 'getTransaction' ? null : result);
  const body = { attempt_id: intent.attempt_id };
  assert.equal((await checkout.confirm(db, invoice, account, config, body, customer, inconsistent.fetch, { dispatch: false })).state, 'awaiting_wallet');
  assert.equal(commands.length, 0);
  const both = rpcFixture(captured);
  assert.equal((await checkout.confirm(db, invoice, account, config, body, customer, both.fetch, { dispatch: false })).state, 'paid');
  assert.equal(both.seen.filter(call => call.method === 'getSignaturesForAddress').length, 2);
  assert.equal(commands[0].name, 'commerce_note_solana_usdc_submission');
  assert.equal(commands[1].args.p_proof.tx_signature, captured.expected.signature);
});

test('past blockhash fences wire display and broadcast while retaining its signed reference', async () => {
  const { config, invoice, account, customer, commands, db, useIntent } = checkoutFixture();
  const { captured, intent, signed } = savedWalletPayment(invoice);
  useIntent({ ...intent, valid_before: Date.now() / 1000 + 500, account_tag: config.account_tag });
  captured.blockHeight = intent.last_valid_block_height + 1;
  captured.blockValidity = { context: { slot: SLOT + 200 }, value: false };
  const fixture = rpcFixture(captured);
  const preparation = await checkout.start(db, invoice, account, config, {
    wallet_address: intent.payer, confirm_amount_cents: invoice.total_cents, confirm_currency: 'USD', consent: true
  }, customer, fixture.fetch);
  assert.equal(preparation.state, 'wallet_review');
  assert.equal(preparation.transaction, undefined);
  const result = await checkout.submit(db, invoice, account, config, { attempt_id: intent.attempt_id, signed_transaction: signed.toString('base64') }, customer, fixture.fetch);
  assert.equal(result.state, 'wallet_review');
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, 'commerce_note_solana_usdc_submission');
  assert.equal(commands[0].args.p_signature, captured.expected.signature);
  assert.equal(fixture.seen.some(call => call.method === 'sendTransaction'), false);
});

test('records the exact signed transfer before sending and retries the identical wire after a lost response', async () => {
  const { config, invoice, account, customer, commands, db, useIntent } = checkoutFixture();
  const { captured, intent, signed } = savedWalletPayment(invoice);
  useIntent({ ...intent, account_tag: config.account_tag });
  const body = { attempt_id: intent.attempt_id, signed_transaction: signed.toString('base64') };
  const modified = Buffer.from(signed);
  modified[304] ^= 1;
  await assert.rejects(checkout.submit(db, invoice, account, config, { ...body, signed_transaction: modified.toString('base64') }, customer), { status: 409 });
  assert.equal(commands.length, 0);
  captured.blockHeight = SLOT;
  captured.blockValidity = { context: { slot: SLOT }, value: true };
  const send = [];
  const proofRpc = rpcFixture(captured);
  const transport = async (url, request) => {
    const { id, method, params } = JSON.parse(request.body);
    if (method !== 'sendTransaction') return proofRpc.fetch(url, request);
    assert.equal(url, RPC);
    assert.equal(commands.at(-1).name, 'commerce_claim_solana_usdc_broadcast');
    assert.equal(commands.at(-1).args.p_signature, captured.expected.signature);
    assert.equal(params[1].skipPreflight, false);
    send.push(params[0]);
    if (send.length === 1) throw Error('Fixture lost response');
    return Response.json({ jsonrpc: '2.0', id, result: captured.expected.signature });
  };
  await assert.rejects(checkout.submit(db, invoice, account, config, body, customer, transport), { status: 503 });
  assert.equal((await checkout.submit(db, invoice, account, config, body, customer, transport)).state, 'pending');
  assert.deepEqual(send, [body.signed_transaction, body.signed_transaction]);
});

test('guest wallet prompts only after explicit pay, rejects changes and retries only stored signed bytes', async () => {
  const { JSDOM } = require('jsdom');
  const { readFileSync } = require('node:fs');
  const invoice = { id: randomUUID(), total_cents: 2500 };
  const wire = savedWalletPayment(invoice);
  const intent = { ...wire.intent, valid_before: Date.now() / 1000 + 500, genesis_hash: GENESIS_HASH, token: TOKEN };
  const state = { state: 'awaiting_wallet', intent };
  const dom = new JSDOM('<div id="host"></div>', { url: 'https://getpurelabs.com/pay.html?guest=1', runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(readFileSync(require.resolve('../solana-usdc-pay.js'), 'utf8'));
  const account = { chains: ['solana:mainnet'], features: ['solana:signTransaction'], address: intent.payer };
  const posts = [];
  let signs = 0, changed = true, lost = true;
  const provider = { name: 'Fixture Wallet', accounts: [account], chains: account.chains, features: {
    'standard:connect': { connect: async () => ({ accounts: [account] }) },
    'solana:signTransaction': { supportedTransactionVersions: ['legacy'], signTransaction: async ({ chain, transaction }) => {
      assert.equal(chain, 'solana:mainnet');
      assert.equal(Buffer.from(transaction).toString('base64'), intent.unsigned_transaction);
      signs++;
      const signed = Buffer.from(wire.signed);
      if (changed) signed[304] ^= 1;
      return [{ signedTransaction: window.Uint8Array.from(signed) }];
    } }
  } };
  window.dispatchEvent(new window.CustomEvent('wallet-standard:register-wallet', { detail: api => api.register(provider) }));
  const destination = { recipient: RECIPIENT, token_account: ATA };
  const api = async body => {
    if (!body) return { gateway: { ready: true, provider: 'solana_usdc', solana_destination: destination }, crypto: state };
    assert.equal(body.invoice_id, invoice.id);
    posts.push(body.action);
    if (body.action === 'pay') return { ...state, transaction: intent.unsigned_transaction };
    assert.equal(body.action, 'submit_solana');
    assert.equal(body.signed_transaction, wire.signed.toString('base64'));
    if (lost) throw Error('Fixture response lost');
    return { state: 'pending' };
  };
  const node = window.document.querySelector('#host');
  const model = window.PureSolanaUSDC.mount({ host: node, api, guest: true, invoice: invoice.id, amount: invoice.total_cents, currency: 'USD', ready: true, destination });
  const control = prefix => [...node.querySelectorAll('button')].find(element => element.textContent.startsWith(prefix));
  try {
    await control('Connect wallet').onclick();
    assert.deepEqual(posts, []);
    assert.match(node.textContent, new RegExp(ATA));
    await control('Sign and pay').onclick();
    assert.deepEqual(posts, ['pay']);
    changed = false;
    await control('Sign and pay').onclick();
    assert.equal(signs, 2);
    assert.equal(control('Sign and pay').hidden, true);
    assert.equal(control('Retry the same').hidden, false);
    lost = false;
    await control('Retry the same').onclick();
    assert.equal(signs, 2);
    assert.deepEqual(posts, ['pay', 'pay', 'submit_solana', 'submit_solana']);
    assert.equal(control('Retry the same').hidden, true);
  } finally {
    model.destroy();
    window.close();
  }
});
