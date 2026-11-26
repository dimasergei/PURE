'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { handle } = require('../lib/spin-save');

const env = { SITE_URL: 'https://getpurelabs.com', PURE_SPIN_CAMPAIGN: 'fixture-spin' };
const request = {
  method: 'POST',
  headers: { origin: env.SITE_URL, 'content-type': 'application/json', authorization: 'Bearer ' + 'x'.repeat(40) },
  body: { terms_version: 'fixture-v1', answer: 5, eligible: true }
};
const migration = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');

function response() {
  return {
    setHeader() {},
    status(status) { this.statusCode = status; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('Spin & Save requires explicit configuration, same-origin consent and a verified account', async () => {
  const disabled = await handle({ method: 'GET' }, response(), { env: {} });
  assert.deepEqual(disabled.body, { active: false });
  assert.equal((await handle(request, response(), { env: {} })).statusCode, 404);
  assert.equal((await handle({ ...request, headers: { ...request.headers, origin: 'https://elsewhere.test' } }, response(), { env })).statusCode, 403);
  assert.equal((await handle({ ...request, body: { ...request.body, eligible: false } }, response(), { env })).statusCode, 400);
  assert.equal((await handle({ ...request, headers: {} }, response(), { env })).statusCode, 403);
  assert.equal((await handle({ ...request, headers: { ...request.headers, authorization: '' } }, response(), { env })).statusCode, 401);

  const user = { id: randomUUID() };
  const calls = [];
  const db = {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (...args) => { calls.push(args); return { data: { status: 'no_prize' } }; }
  };
  assert.equal((await handle(request, response(), { db, env })).statusCode, 401);
  assert.deepEqual(calls, []);
  user.email_confirmed_at = '2026-11-26T12:00:00Z';
  const result = await handle({ ...request, body: { ...request.body, credit_cents: 100000, customer_id: randomUUID() } }, response(), { db, env });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls, [['commerce_submit_spin', {
    p_campaign: 'fixture-spin', p_customer: user.id, p_version: 'fixture-v1', p_answer: 5
  }]]);
});

test('a replay returns the same prize and the final ticket is granted only once', async () => {
  const pg = new PGlite();
  const winner = randomUUID();
  const disqualified = randomUUID();
  const another = randomUUID();
  const publicCampaign = async () => (await pg.query("select public.commerce_spin_campaign('fixture-spin') campaign")).rows[0].campaign;
  const submit = async (customer, answer, version = 'fixture-v1') =>
    (await pg.query("select public.commerce_submit_spin('fixture-spin', $1, $2, $3) outcome", [customer, version, answer])).rows[0].outcome;
  try {
    await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema commerce_internal;');
    for (const name of ['20261110040926_manual_invoice_commerce.sql', '20261111025932_direct_checkout_balances.sql', '20261126090000_pure_spin_save.sql']) {
      await pg.exec(migration(name));
    }
    const acl = await pg.query(`select
      has_function_privilege('anon','public.commerce_submit_spin(text,uuid,text,integer)','EXECUTE') public_submit,
      has_function_privilege('authenticated','public.commerce_submit_spin(text,uuid,text,integer)','EXECUTE') account_submit,
      has_table_privilege('service_role','public.commerce_spin_campaigns','UPDATE') service_update`);
    assert.deepEqual(acl.rows[0], { public_submit: false, account_submit: false, service_update: false });
    assert.equal(await publicCampaign(), null, 'migration creates no campaign');

    await pg.exec(`insert into public.commerce_spin_campaigns values (
      'fixture-spin','Isolated fixture','Ontario',19,'/fixture-rules.html','fixture-v1','2 + 3',5,
      now()-interval '1 minute',now()+interval '1 minute',false);
      insert into public.commerce_spin_prizes values ('fixture-spin','credit','Account credit',700,1,1);`);
    assert.equal(await publicCampaign(), null, 'a configured but disabled campaign stays off');
    await assert.rejects(submit(winner, 5), /Promotion unavailable/);
    await pg.exec("update public.commerce_spin_campaigns set enabled=true where code='fixture-spin'");
    const publicData = await publicCampaign();
    assert.equal(publicData.active, true);
    assert.equal(publicData.skill_question, '2 + 3');
    assert.equal(Object.hasOwn(publicData, 'skill_answer'), false);
    assert.deepEqual(publicData.prizes, [{ key: 'credit', label: 'Account credit', quantity: 1, remaining: 1, credit_cents: 700 }]);

    await assert.rejects(submit(winner, 5, 'expired-rules'), /Promotion unavailable/);
    const bad = await submit(disqualified, 4);
    assert.equal(bad.status, 'disqualified');
    assert.deepEqual(await submit(disqualified, 5), bad);
    assert.equal((await publicCampaign()).prizes[0].remaining, 1);

    const first = await submit(winner, 5);
    assert.equal(first.status, 'credit');
    assert.equal(first.credit_cents, 700);
    assert.deepEqual(await submit(winner, 5), first);
    assert.equal(await publicCampaign(), null);
    await assert.rejects(submit(another, 5), /Promotion unavailable/);

    const credits = await pg.query("select credit_cents from public.commerce_balance_accounts where customer_id=$1", [winner]);
    assert.deepEqual(credits.rows, [{ credit_cents: 700 }]);
    const events = await pg.query("select count(*)::int count from public.commerce_balance_events where customer_id=$1", [winner]);
    assert.equal(events.rows[0].count, 1);
  } finally {
    await pg.close();
  }
});
