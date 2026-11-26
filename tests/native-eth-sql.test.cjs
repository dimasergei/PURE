'use strict';

const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fixture = require('./fixtures/commerce-sql-fixture.cjs');
const checkout = require('../lib/direct-checkout');
const checkoutConfig = require('../config/checkout.json');
const delivery = require('../lib/delivery-options');

const migration = '20261126050000_native_eth.sql';
const provider = 'ethereum_eth';
const recipient = '0x' + '11'.repeat(20);
const payer = '0x' + '22'.repeat(20);
const accountTag = createHash('sha256').update(`${provider}:live:1:${recipient}`).digest('hex');
const fixtureCheckoutMethod = '1efcda11-7310-4c45-b6bb-3cfdd8873784';
const catalog = [{ id: 'fixture-eth-goods', name: 'ETH fixture goods', category: 'injectables', variants: [{ size: '5mg', price: 99.99 }] }];
const hash = () => '0x' + randomBytes(32).toString('hex');

async function apply(db, names) {
  for (const name of names) {
    try {
      await db.exec(fixture.read(name));
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
}

async function installCheckoutSchema(db) {
  await fixture.base(db, { notifications: true });
  await db.exec('alter role service_role bypassrls');
  await db.query(`insert into commerce_payment_methods
    (id,kind,provider_key,label,currency,payee,instructions,allowed_host,acceptance_reference,active,sale_scope,native_provider)
    values($1,'hosted_link','custom','Fixture Card','USD','Fixture business','Disposable payment fixture instructions',
    'getpurelabs.com','Isolated provider acceptance fixture',true,'goods','rampex')`, [fixtureCheckoutMethod]);
  await db.query(`insert into commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,rampex_provider)
    values($1,'rampex','live',$2,array['US','CA'],'hosted')`, [fixtureCheckoutMethod, 'a'.repeat(64)]);
  await apply(db, [
    '20261117084413_pure_storefront_regular_pricing.sql',
    '20261117192240_pure_canada_next_day_delivery.sql',
    '20261117194109_pure_card_crypto_checkout.sql',
    '20261117221328_pure_stack_crypto_discount.sql',
    '20261118020145_pure_generic_manual_fulfillment.sql',
    '20261118070801_pure_interac_cad_checkout.sql'
  ]);
  await fixture.polygon(db);
  for (const option of delivery.defaults) {
    await db.query('update commerce_delivery_options set label=$2,price_cents=$3,enabled=$4,description=$5 where id=$1',
      [option.id, option.label, option.price_cents, option.enabled, option.description]);
  }
  await db.query(`insert into commerce_payment_methods
    (id,kind,provider_key,label,currency,payee,instructions,acceptance_reference,active,sale_scope)
    values($1,'interac','interac','Fixture Interac','CAD','Fixture business','Disposable fixture receiving@example.test',
    'Isolated receiver approval',true,'goods')`, [randomUUID()]);
  await db.exec('create table if not exists public.suppliers (id uuid primary key, name text not null)');
  await apply(db, [
    '20261118180549_pure_membership_checkout.sql',
    '20261118231100_pure_quantity_tiers.sql',
    '20261118235500_pure_canadian_free_standard_shipping.sql',
    '20261119213000_pure_membership_only_stack.sql',
    '20261119221500_pure_member_stack_tier_benefits.sql',
    '20261119231000_pure_bulk_order_volume_tiers.sql',
    '20261109225035_enterprise_inventory_quality_foundation.sql',
    '20261120103000_economy_shipping_lower_rates.sql',
    '20261120115000_combined_member_checkout_validation.sql',
    '20261120115500_combined_membership_lifecycle_part1.sql',
    '20261120120000_combined_membership_lifecycle_part2.sql',
    '20261122000100_campaign_bac_fulfillment.sql',
    '20261122000200_partner_commission_rates.sql',
    '20261122000300_partner_chargebacks.sql',
    '20261122000400_storefront_reviews.sql',
    '20261122000500_review_credit.sql',
    '20261122000700_bogo_fulfillment.sql',
    '20261122000800_blackfriday10_checkout.sql',
    '20261122001000_partner_first_order_discount.sql',
    '20261122001100_bogo_shipping_threshold.sql',
    '20261122001200_commerce_order_numbers.sql',
    '20261122001300_compound_bulk_checkout.sql',
    '20261122001400_order_lot_coas.sql',
    '20261122001500_shipping_thresholds.sql',
    '20261122001700_catalog_bogo_eligibility.sql',
    '20261122001900_bulk_offer_exclusivity.sql',
    '20261122002100_recon_gift_packed_lot.sql',
    '20261109231123_enterprise_atomic_inventory_reservation.sql',
    '20261109231602_enterprise_atomic_reservation_cancellation.sql',
    '20261122002000_manual_pilot_fulfillment.sql',
    '20261122001600_first_paid_order_bac.sql',
    '20261123000100_exclusive_merchandise_offers.sql',
    '20261125000100_pure_gateway_card_route.sql',
    '20261125223346_one_use_card_test_coupon.sql',
    '20261126011403_verified_pure_gateway_reversals.sql',
    '20261126013508_guest_checkout.sql',
    '20261126024818_guest_interac_and_crypto.sql',
    '20261126032739_direct_usdc_networks.sql'
  ]);
}

test('native ETH quotes and finalized receipts use the order ledger atomically', { timeout: 120000 }, async t => {
  const db = new PGlite();
  const rpc = async (name, args) => {
    const params = args.map((_, index) => `$${index + 1}`).join(',');
    const values = args.map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value);
    await db.exec('set role service_role');
    try {
      return (await db.query(`select public.${name}(${params}) as result`, values)).rows[0].result;
    } finally {
      await db.exec('reset role');
    }
  };
  const methodId = randomUUID();
  const invoice = async id => (await db.query('select * from commerce_invoices where id=$1', [id])).rows[0];
  const receipts = async id => (await db.query('select * from commerce_receipts where invoice_id=$1', [id])).rows;
  const attempts = async id => (await db.query('select * from commerce_gateway_attempts where invoice_id=$1', [id])).rows;

  async function placeOrder({ checkoutMethod = fixtureCheckoutMethod, bindTo = methodId } = {}) {
    const user = { id: randomUUID(), email: 'native-eth-fixture@example.test' };
    const body = {
      id: randomUUID(), kind: 'goods', method_id: checkoutMethod, checkout_version: checkoutConfig.version,
      consent: true, research_use: true, name: 'Native ETH fixture', coupon: '', points: 0, credit_cents: 0,
      items: [{ id: catalog[0].id, size: catalog[0].variants[0].size, qty: 1 }],
      address: { line1: '123 Fixture Street', city: 'Fixture City', region: 'NY', postal_code: '10001', country: 'US' },
      delivery: { shipping: 'standard', extras: [] }
    };
    const method = (await db.query('select * from commerce_payment_methods where id=$1', [checkoutMethod])).rows[0];
    const normalized = await checkout.normalize({}, user, body, catalog);
    const pricing = checkout.price(normalized, method, null, { points: 0, credit_cents: 0 }, null, delivery.defaults, null, null);
    const order = { ...normalized, ...pricing, checkout_version: checkoutConfig.version, customer: user.id };
    assert.equal((await rpc('commerce_place_checkout', [order])).status, 'accepted');
    // The ETH prerequisite has no checkout entry point. Use the ordinary order
    // placement path, then bind its disposable invoice to the fixture ETH route.
    if (bindTo) await db.query('update commerce_invoices set method_id=$2 where id=$1', [order.id, bindTo]);
    assert.equal((await invoice(order.id)).total_cents, order.total_cents);
    return order;
  }

  async function quoteFor(order, overrides = {}) {
    const [{ time }] = (await db.query('select floor(extract(epoch from now()))::int as time')).rows;
    const coinbase = 2123456789n;
    const kraken = 2124567890n;
    const rate = (coinbase + kraken) / 2n;
    const numerator = BigInt(order.total_cents) * 10n ** 22n;
    const wei = (numerator + rate - 1n) / rate;
    return {
      payer, recipient, reference: hash(), amount_wei: String(wei), rate_micro_usd: String(rate),
      rate_sources: {
        coinbase: { rate_micro_usd: String(coinbase), observed_at: String(time) },
        kraken: { rate_micro_usd: String(kraken), observed_at: String(time) }
      },
      start_block: '22000000', start_block_hash: hash(), start_block_timestamp: String(time - 800),
      valid_after: time - 1, valid_before: time + 240, ...overrides
    };
  }

  const create = (order, quote, { id = randomUUID(), owner = order.customer, tag = accountTag } = {}) =>
    rpc('commerce_create_native_eth_quote', [id, order.id, owner, tag, quote]);
  const note = (id, order, txHash, owner = order.customer) =>
    rpc('commerce_note_native_eth_submission', [id, order.id, owner, txHash]);
  const finish = (id, proof, tag = accountTag) => rpc('commerce_finish_native_eth_payment', [id, tag, proof]);
  const cancel = order => rpc('commerce_request_native_eth_cancellation', [order.id, order.customer, `customer:${order.customer}`]);

  function proofFor(quote, overrides = {}) {
    return {
      chain_id: 1, payer: quote.payer, recipient: quote.recipient, reference: quote.reference,
      amount_wei: quote.amount_wei, tx_hash: hash(), transaction_index: 2, block_hash: hash(),
      block_number: '22000001', block_timestamp: Number(quote.valid_after) + 1, finalized_number: '22000002',
      recipient_has_code: false,
      ...overrides
    };
  }

  try {
    await installCheckoutSchema(db);
    const sharedFinalizer = "select pg_get_functiondef('public.commerce_finish_gateway_attempt(uuid,text,text,text,integer,text,text,text)'::regprocedure) as definition";
    const existingFinalizer = (await db.query(sharedFinalizer)).rows[0].definition;
    await apply(db, [migration]);
    assert.equal((await db.query(sharedFinalizer)).rows[0].definition, existingFinalizer);
    assert.deepEqual((await db.query('select id from commerce_payment_methods where native_provider=$1', [provider])).rows, []);

    await db.query(`insert into commerce_payment_methods
      (id,kind,provider_key,label,currency,payee,instructions,allowed_host,acceptance_reference,active,sale_scope,native_provider)
      values($1,'hosted_link','custom','Fixture ETH','USD','Fixture business','Disposable wallet fixture instructions','getpurelabs.com',
      'Isolated receiving wallet approval',true,'goods',$2)`, [methodId, provider]);
    await db.query(`insert into commerce_gateway_accounts(method_id,provider,mode,account_tag,countries)
      values($1,$2,'live',$3,array['US'])`, [methodId, provider, accountTag]);

    await t.test('only the backend can invoke the native ETH commands', async () => {
      for (const signature of [
        'commerce_create_native_eth_quote(uuid,uuid,uuid,text,jsonb)',
        'commerce_note_native_eth_submission(uuid,uuid,uuid,text)',
        'commerce_finish_native_eth_payment(uuid,text,jsonb)',
        'commerce_request_native_eth_cancellation(uuid,uuid,text)'
      ]) {
        const [permissions] = (await db.query(`select has_function_privilege('anon',$1,'execute') as anonymous,
          has_function_privilege('authenticated',$1,'execute') as signed_in,
          has_function_privilege('service_role',$1,'execute') as backend`, [`public.${signature}`])).rows;
        assert.deepEqual(permissions, { anonymous: false, signed_in: false, backend: true });
      }
      for (const relation of ['quotes', 'submissions', 'proofs']) {
        const [permissions] = (await db.query(`select has_table_privilege('anon',$1,'select') as anonymous,
          has_table_privilege('authenticated',$1,'select') as signed_in,
          has_table_privilege('service_role',$1,'select') as backend_read,
          has_table_privilege('service_role',$1,'insert,update,delete') as backend_write`, [`public.commerce_native_eth_${relation}`])).rows;
        assert.deepEqual(permissions, { anonymous: false, signed_in: false, backend_read: true, backend_write: false });
      }
    });

    await t.test('Card still settles through its existing Stripe PaymentIntent route', async () => {
      const cardMethod = randomUUID();
      const cardTag = 'e'.repeat(64);
      await rpc('commerce_configure_pure_gateway', [{
        id: cardMethod, version: 0, provider: 'pure_gateway', mode: 'live', currency: 'USD', sale_scope: 'goods', confirmed: true,
        active: true, account_tag: cardTag, countries: ['US'], label: 'Fixture Card', payee: 'Fixture business',
        approval_reference: 'Standalone Card fixture approval'
      }, 'admin-native:fixture']);
      const order = await placeOrder({ checkoutMethod: cardMethod, bindTo: null });
      const id = randomUUID();
      const session = 'pi_fixtureCardNativeEth2026';
      const started = await rpc('commerce_begin_gateway_attempt', [id, order.id, order.customer, 'sale', cardTag]);
      assert.equal(started.provider, 'pure_gateway');
      await rpc('commerce_bind_pure_gateway_session', [id, session, `https://pay.example.test/pay?pi=${session}`, cardTag]);
      const paid = await rpc('commerce_finish_gateway_attempt', [id, 'fixture-card-verified-payment', 'approved',
        'ch_fixtureCardNativeEth2026', order.total_cents, 'USD', null, null]);
      assert.equal(paid.state, 'paid');
      assert.equal((await receipts(order.id))[0].actor, 'verified-gateway:pure_gateway');
    });

    await t.test('a goods quote pins ownership, destination, fresh exchange rates and exact wei', async () => {
      const order = await placeOrder();
      assert.deepEqual((await db.query('select id from auth.users where id=$1', [order.customer])).rows, []);
      const quote = await quoteFor(order);
      assert.ok(BigInt(quote.amount_wei) > BigInt(Number.MAX_SAFE_INTEGER));

      await assert.rejects(create(order, quote, { owner: randomUUID() }));
      await assert.rejects(create(order, quote, { tag: 'a'.repeat(64) }));
      for (const changes of [
        { recipient: '0x' + '33'.repeat(20) },
        { payer: recipient },
        { reference: '0x01' },
        { amount_wei: String(BigInt(quote.amount_wei) - 1n) },
        { rate_micro_usd: quote.rate_sources.coinbase.rate_micro_usd },
        { rate_sources: { ...quote.rate_sources, coinbase: { ...quote.rate_sources.coinbase, rate_micro_usd: '5000000000' } } },
        { rate_sources: { ...quote.rate_sources, coinbase: { ...quote.rate_sources.coinbase, observed_at: '1' } } },
        { valid_before: quote.valid_before + 300 }
      ]) {
        await assert.rejects(create(order, { ...quote, ...changes }), JSON.stringify(changes));
      }
      assert.equal((await attempts(order.id)).length, 0);

      const id = randomUUID();
      const saved = await create(order, quote, { id });
      assert.equal(saved.amount_wei, quote.amount_wei);
      assert.equal(saved.rate_micro_usd, quote.rate_micro_usd);
      assert.equal(saved.start_block, quote.start_block);
      assert.equal(saved.reference, quote.reference);
      assert.equal(saved.status, 'open');
      const repeated = await create(order, await quoteFor(order));
      assert.equal(repeated.reference, saved.reference);
      assert.equal((await attempts(order.id)).length, 1);

      await assert.rejects(note(id, order, hash(), randomUUID()));
      await assert.rejects(note(id, order, '0x01'));
      const candidate = hash();
      assert.equal((await note(id, order, candidate)).status, 'submitted');
      assert.equal((await invoice(order.id)).status, 'accepted');
      assert.deepEqual(await receipts(order.id), []);
    });

    await t.test('a replacement quote keeps the original signed reference available for recovery', async () => {
      const order = await placeOrder();
      const originalId = randomUUID();
      const original = await create(order, await quoteFor(order), { id: originalId });
      // Advance fixture quote age without waiting four minutes. Preserve the
      // original duration and place its anchor before the shifted window.
      await db.query(`update commerce_native_eth_quotes
        set valid_after=valid_after-300, valid_before=valid_before-300
        where id=$1`, [originalId]);

      const replacementId = randomUUID();
      const refreshed = await create(order, await quoteFor(order), { id: replacementId });
      assert.notEqual(refreshed.reference, original.reference);
      assert.equal(refreshed.attempt_id, original.attempt_id);
      assert.equal((await attempts(order.id)).length, 1);
      assert.equal((await db.query('select status from commerce_native_eth_quotes where id=$1', [originalId])).rows[0].status, 'expired');

      // A finalized transaction inside the original block-time window is still
      // recoverable after the shopper obtains a replacement quote.
      const recovered = proofFor(original, { block_timestamp: Number(original.valid_after) - 290 });
      assert.equal((await finish(originalId, recovered)).state, 'paid');
      assert.equal((await finish(replacementId, proofFor(refreshed))).state, 'review');
      assert.equal((await receipts(order.id)).length, 1);
    });

    await t.test('generic receipt functions cannot settle ETH without a bound proof', async () => {
      const order = await placeOrder();
      const confirmed = { id: order.id, version: (await invoice(order.id)).version, receipt_id: randomUUID(),
        external_reference: `ethereum_eth:sale:1:${hash()}`, amount_cents: order.total_cents, currency: 'USD', funds_confirmed: true };
      await assert.rejects(rpc('commerce_admin_command', ['record_payment', confirmed, 'verified-gateway:ethereum_eth']),
        /Finalized native ETH payment proof required/);

      await create(order, await quoteFor(order));
      const [attempt] = await attempts(order.id);
      await assert.rejects(rpc('commerce_admin_command', ['record_payment', { ...confirmed, receipt_id: attempt.id }, 'verified-gateway:ethereum_eth']));
      await assert.rejects(rpc('commerce_finish_gateway_attempt', [attempt.id, 'fixture-unsafe-eth-payment', 'approved',
        `1:${hash()}`, order.total_cents, 'USD', null, null]), /Finalized native ETH payment proof required/);
      await assert.rejects(rpc('commerce_finish_gateway_attempt', [attempt.id, 'fixture-unsafe-eth-decline', 'declined',
        null, null, null, null, null]), /Reconcile the native ETH quote before closing the attempt/);
      assert.equal((await invoice(order.id)).status, 'accepted');
      assert.equal((await attempts(order.id))[0].state, 'started');
      assert.deepEqual(await receipts(order.id), []);
    });

    await t.test('proof is bound to exactly one order and creates one USD receipt', async () => {
      const order = await placeOrder();
      const id = randomUUID();
      const quote = await create(order, await quoteFor(order), { id });
      const proof = proofFor(quote);
      await assert.rejects(finish(id, proof, 'b'.repeat(64)));
      for (const changes of [{ chain_id: 8453 }, { reference: hash() }, { payer: recipient }, { amount_wei: '1' },
        { finalized_number: '22000000' }, { transaction_index: -1 }, { recipient_has_code: null }]) {
        await assert.rejects(finish(id, { ...proof, ...changes }), JSON.stringify(changes));
      }
      assert.deepEqual(await receipts(order.id), []);

      assert.equal((await finish(id, proof)).state, 'paid');
      assert.equal((await finish(id, proof)).replayed, true);
      assert.equal((await invoice(order.id)).status, 'paid');
      const [receipt] = await receipts(order.id);
      assert.equal(receipt.amount_cents, order.total_cents);
      assert.equal(receipt.currency, 'USD');
      assert.equal(receipt.actor, 'verified-gateway:ethereum_eth');

      const second = proofFor(quote);
      assert.equal((await finish(id, second)).state, 'review');
      assert.equal((await finish(id, second)).replayed, true);
      assert.equal((await receipts(order.id)).length, 1);
      assert.equal((await invoice(order.id)).status, 'paid');

      const another = await placeOrder();
      const otherId = randomUUID();
      const otherQuote = await create(another, await quoteFor(another), { id: otherId });
      await assert.rejects(finish(otherId, proofFor(otherQuote, { tx_hash: proof.tx_hash })));
      assert.deepEqual(await receipts(another.id), []);
    });

    await t.test('a finalized transfer to an address with code goes to review', async () => {
      const order = await placeOrder();
      const id = randomUUID();
      const quote = await create(order, await quoteFor(order), { id });
      const proof = proofFor(quote, { recipient_has_code: true });
      assert.equal((await finish(id, proof)).state, 'review');
      const [record] = (await db.query('select review_reason from commerce_native_eth_proofs where tx_hash=$1', [proof.tx_hash])).rows;
      assert.equal(record.review_reason, 'recipient_code_present');
      assert.equal((await invoice(order.id)).status, 'accepted');
      assert.deepEqual(await receipts(order.id), []);
    });

    await t.test('outside-window and cancellation-held payments require review', async () => {
      const lateOrder = await placeOrder();
      const lateId = randomUUID();
      const lateQuoteData = await quoteFor(lateOrder);
      const lateQuote = await create(lateOrder, lateQuoteData, { id: lateId });
      const lateProof = proofFor(lateQuote, { block_timestamp: lateQuoteData.valid_after - 1 });
      assert.equal((await finish(lateId, lateProof)).state, 'review');
      assert.equal((await finish(lateId, lateProof)).replayed, true);
      assert.equal((await invoice(lateOrder.id)).status, 'accepted');
      assert.deepEqual(await receipts(lateOrder.id), []);

      const held = await placeOrder();
      const heldId = randomUUID();
      const heldQuote = await create(held, await quoteFor(held), { id: heldId });
      await assert.rejects(rpc('commerce_cancel_checkout', [held.id, held.customer]));
      assert.equal((await cancel(held)).cancellation_status, 'pending');
      await assert.rejects(create(held, await quoteFor(held)));
      assert.equal((await finish(heldId, proofFor(heldQuote))).state, 'review');
      assert.equal((await invoice(held.id)).cancellation_status, 'review');
      assert.deepEqual(await receipts(held.id), []);
    });
  } finally {
    await db.close();
  }
});
