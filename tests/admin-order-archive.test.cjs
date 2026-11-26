'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { updateArchive } = require('../lib/admin-order-archive');
const { unifiedAdminOrders } = require('../lib/admin-order-query');

const id = index => `da100000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const order = (index, source = 'commerce') => ({ id: id(index), source });
const migration = path.join(__dirname, '../supabase/migrations/20261126013324_admin_bulk_order_archive.sql');

test('archive request validates source, limits selection and deduplicates by ledger', async () => {
  const calls = [];
  const db = { rpc: async (...args) => { calls.push(args); return { data: { updated: 2 } }; } };
  await assert.rejects(updateArchive(db, { action: 'archive', orders: [order(1, 'research_subscription')] }), { status: 400 });
  await assert.rejects(updateArchive(db, { action: 'archive', orders: Array(201).fill(order(1)) }), { status: 400 });
  assert.equal(calls.length, 0);
  await updateArchive(db, { action: 'archive', orders: [order(1), order(1, 'store'), { ...order(1), id: id(1).toUpperCase() }] });
  await updateArchive(db, { action: 'unarchive', order_ids: [id(2)] });
  assert.deepEqual(calls, [
    ['commerce_admin_archive_orders', { p_orders: [order(1), order(1, 'store')], p_archived: true }],
    ['commerce_admin_archive_orders', { p_orders: [order(2, 'store')], p_archived: false }]
  ]);
});

test('bulk archive preserves invoice state, distinguishes skipped orders, records an audit and can restore', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create table public.commerce_invoices (
        id uuid primary key, kind text not null, status text not null, cancellation_status text,
        public_order_number text, total_cents integer not null, version integer not null
      );
      create table public.store_orders (
        id uuid primary key, order_number text not null, fulfillment_status text not null,
        archived_at timestamptz, archived boolean not null default false
      );
      create table public.commerce_events (
        invoice_id uuid references public.commerce_invoices, action text not null, actor text not null, details jsonb not null
      );
    `);
    await db.exec(fs.readFileSync(migration, 'utf8'));
    await db.query(`insert into public.commerce_invoices values
      ($1,'goods','void',null,'P00001001',4290,3,null),
      ($2,'goods','accepted','pending','P00001002',4900,4,null),
      ($3,'goods','delivered',null,'P00001003',5900,5,null),
      ($4,'goods','paid',null,'P00001004',6900,6,null)`, [id(1), id(2), id(3), id(4)]);
    await db.query(`insert into public.store_orders values ($1,'OLD-01','canceled',null,false),($2,'OLD-02','unfulfilled',null,false)`, [id(1), id(5)]);
    const archive = async (selection, setArchived) => (await db.query(
      'select public.commerce_admin_archive_orders($1::jsonb, $2) as result', [JSON.stringify(selection), setArchived]
    )).rows[0].result;
    for (const role of ['anon','authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(archive([order(1)], true), { code: '42501' });
      await db.exec('reset role');
    }

    await db.exec('set role service_role');
    const selected = [order(1), order(1), order(3), order(2), order(4), order(5,'store'), order(1,'store'), order(8)];
    const recorded = await archive(selected, true);
    assert.equal(recorded.updated, 3);
    assert.deepEqual(recorded.orders.map(o => [o.source,o.order_number,o.archived]), [
      ['commerce','P00001001',true], ['commerce','P00001003',true], ['store','OLD-01',true]
    ]);
    assert.deepEqual(recorded.skipped.map(o => [o.id,o.reason]), [
      [id(2),'not_closed'],[id(4),'not_closed'],[id(8),'not_found'],[id(5),'not_closed']
    ]);
    assert.equal((await archive([order(1)], true)).skipped[0].reason, 'already_archived');
    assert.equal((await archive([order(1), order(1,'store')], false)).updated, 2);
    assert.equal((await archive([order(1)], false)).skipped[0].reason, 'already_active');

    await db.exec('reset role');
    const states = (await db.query(`select status, total_cents, version, archived_at is not null archived from public.commerce_invoices order by id`)).rows;
    assert.deepEqual(states, [
      {status:'void',total_cents:4290,version:3,archived:false}, {status:'accepted',total_cents:4900,version:4,archived:false},
      {status:'delivered',total_cents:5900,version:5,archived:true}, {status:'paid',total_cents:6900,version:6,archived:false}
    ]);
    const audits = (await db.query(`select action, count(*)::integer count from public.commerce_events group by action order by action`)).rows;
    assert.deepEqual(audits, [{action:'admin_order_archived',count:3},{action:'admin_order_restored',count:2}]);
  } finally { await db.close(); }
});

test('unified list hides archived orders in current view and still finds them in archived or all', async () => {
  const cases = {
    store_orders: [{ ...order(1), order_number:'OLD-A', archived:true, archived_at:'2026-11-24', fulfillment_status:'canceled' }],
    commerce_invoices: [{ ...order(2), public_order_number:'P00001002', archived_at:'2026-11-24', kind:'goods', status:'void' },
      { ...order(3), public_order_number:'P00001003', kind:'goods', status:'paid' }],
    research_subscriptions: []
  };
  const db = { from(table) { return { select() { return this; }, order() { return this; }, async range() { return { data:cases[table] }; } }; } };
  const fetch = view => unifiedAdminOrders(db,new URLSearchParams({ status:view }));
  const current = (await fetch('current')).orders;
  assert.deepEqual(current.map(row => [row.order_number,row.archive_eligible]), [['P00001003',false]]);
  const archived = (await fetch('archived')).orders;
  assert.deepEqual(archived.map(row => [row.order_number,row.archived,row.archive_eligible]).sort(), [['OLD-A',true,true],['P00001002',true,true]]);
  assert.equal((await fetch('all')).orders.length,3);
});
