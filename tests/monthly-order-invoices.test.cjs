'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {read,base}=require('./fixtures/commerce-sql-fixture.cjs');
const {pricedBasket}=require('../lib/repeat-orders');
const delivery=require('../lib/delivery-options');
const fixture=[{id:'example',name:'Example',category:'injectables',variants:[{size:'small',price:11.13}]}];

async function setupRepeatDb(db) {
  await base(db);
  await db.exec(read('20261113124000_global_checkout_delivery_options.sql'));
  await db.exec('drop function commerce_internal.queue_invoice_notification()');
  await db.exec(read('20261110061306_invoice_notification_outbox.sql'));
  const queue=read('20261111025932_direct_checkout_balances.sql');
  await db.exec(queue.slice(queue.indexOf('create or replace function commerce_internal.queue_invoice_notification'),queue.indexOf('end $$;',queue.indexOf('create or replace function commerce_internal.queue_invoice_notification'))+7));
  await db.exec("alter table public.commerce_invoices add column membership_invoice_id uuid;create schema cron;create table cron.job(jobname text,active boolean default true);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job(jobname) values($1); return 1; end$$;");
  await db.exec(read('20261122000700_bogo_fulfillment.sql'));
  await db.exec(read('20261126180000_monthly_order_invoices.sql'));
  await db.exec('alter table commerce_invoices add column cancellation_requested_at timestamptz');
  await db.exec(read('20261122001200_commerce_order_numbers.sql'));
  await db.exec(read('20261126185640_monthly_invoice_payment_choice.sql'));
  await db.exec(read('20261126192352_subscribe_three_delivery_term.sql'));
  await db.exec('alter table auth.users add column email text, add column email_confirmed_at timestamptz');
}

test('monthly invoice amount, shipping and included quantity are fixed in USD cents',()=>{
  const builder=pricedBasket('builder',[{id:'example',size:'small',qty:8}],fixture,'CA',delivery.defaults);
  assert.equal(builder.total_cents,668*8);
  assert.equal(builder.pricing.bundled_items[0].qty,2);
  const pdp=pricedBasket('product',[{id:'example',size:'small',qty:3}],fixture,'US',delivery.defaults);
  assert.equal(pdp.total_cents,1002*3+795);
  assert.throws(()=>pricedBasket('builder',[{id:'example',size:'small',qty:3}],fixture,'CA',delivery.defaults));
});

test('owner consent, replay, pause/skip/edit, unpaid cycles, email and fulfilment in PostgreSQL',async()=>{
  const db=new PGlite();
  const run=(sql,params=[])=>db.query(sql,params);
  const scalar=async(sql,params)=>(await run(sql,params)).rows[0].v;
  const owner=randomUUID(),other=randomUUID(),id=randomUUID(),mid=randomUUID();
  try{
    await setupRepeatDb(db);
    await run("insert into auth.users values($1,'owner@example.test',now()),($2,'other@example.test',now())",[owner,other]);
    await run("insert into commerce_payment_methods(id,kind,provider_key,label,currency,payee,instructions,allowed_host,acceptance_reference,active,sale_scope,native_provider) values($1,'hosted_link','custom','Fixture card','USD','Fixture store','Disposable test environment','getpurelabs.com','Test route fixture evidence',true,'goods','rampex')",[mid]);
    await run("insert into commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,rampex_provider) values($1,'rampex','live',repeat('a',64),array['US','CA'],'hosted')",[mid]);
    await run("update commerce_delivery_options set enabled=true where id='express'");
    const basket=pricedBasket('builder',[{id:'example',size:'small',qty:8}],fixture,'CA',delivery.defaults);
    const snapshot={kind:'builder',terms:'pure-monthly-invoice-v1',request:{name:'Test Owner',address:{country:'CA'},items:basket.items},pricing:basket.pricing,total_cents:basket.total_cents,method_id:mid,method_version:1};
    const save=(s,d,v=null)=>scalar('select pure_repeat_save($1,$2,$3,$4,$5,$6) v',[id,owner,'owner@example.test',JSON.stringify(s),d,v]);
    const readPlan=async()=>JSON.parse(JSON.stringify(await scalar('select pure_repeat_list($1) v',[owner])))[0];
    const manage=async(action,uid=owner)=>scalar('select pure_repeat_manage($1,$2,$3,$4) v',[uid,id,action,(await readPlan()).version]);
    const due=async()=>{await run("update pure_repeat_plans set next_due_at=now()-interval '1 second' where id=$1",[id]);await db.exec('select commerce_internal.process_repeat_invoices()');};
    const hash='a'.repeat(64);
    await assert.rejects(save({...snapshot,total_cents:1},hash));
    const first=await save(snapshot,hash);
    assert.equal((await save(snapshot,hash)).invoice_id,first.invoice_id);
    assert.equal(await scalar('select count(*)::int v from commerce_notifications where invoice_id=$1 and audience=\'customer\' and event_action=\'checkout_placed\'',[first.invoice_id]),1);
    assert.equal(await scalar('select status v from commerce_invoices where id=$1',[first.invoice_id]),'accepted');
    assert.equal(await scalar('select total_cents v from commerce_invoices where id=$1',[first.invoice_id]),5344);
    assert.equal(await scalar('select count(*)::int v from commerce_receipts'),0);
    assert.deepEqual(await scalar('select pure_repeat_list($1) v',[other]),[]);
    await assert.rejects(manage('cancel',other));
    await db.exec('set role authenticated');
    await assert.rejects(run('select * from pure_repeat_plans'));
    await assert.rejects(run('select pure_repeat_list($1)',[owner]));
    await db.exec('reset role');
    await run("update commerce_invoices set status='paid',paid_at=now() where id=$1",[first.invoice_id]);
    await run('select commerce_internal.fulfillment_seed($1)',[first.invoice_id]);
    assert.equal(await scalar("select (item->>'qty')::int v from commerce_fulfillment_items where invoice_id=$1 and variant_key='gift-bac-3|3 mL'",[first.invoice_id]),2);
    const changed={...snapshot,request:{...snapshot.request,name:'Updated Name'}};
    await save(changed,'b'.repeat(64),(await readPlan()).version);
    assert.equal(await scalar('select customer_name v from commerce_invoices where id=$1',[first.invoice_id]),'Test Owner');
    await manage('skip');
    await due();
    const second=await readPlan();
    assert.notEqual(second.invoice_id,first.invoice_id);
    assert.equal(await scalar('select customer_name v from commerce_invoices where id=$1',[second.invoice_id]),'Updated Name');
    assert.equal(await scalar("select count(*)::int v from commerce_notifications where invoice_id=$1 and audience='customer' and event_action='checkout_placed'",[second.invoice_id]),1);
    await db.exec('select commerce_internal.process_repeat_invoices()');
    assert.equal(await scalar('select count(*)::int v from commerce_invoices'),2);
    await due();assert.equal((await readPlan()).status,'paused');
    await manage('resume');await manage('pause');await manage('resume');await manage('cancel');await due();
    assert.equal((await readPlan()).status,'canceled');
    assert.equal(await scalar('select count(*)::int v from commerce_invoices'),2);

    const interac=randomUUID(),newPlan=randomUUID();
    await run("insert into commerce_payment_methods(id,kind,provider_key,label,currency,payee,instructions,acceptance_reference,active,sale_scope) values($1,'interac','interac','Interac','CAD','Test store','Send to fixture@example.test','Fixture reference',true,'goods')",[interac]);
    const current=pricedBasket('builder',[{id:'example',size:'small',qty:8}],fixture,'CA',delivery.defaults,true);
    const flexible={...snapshot,payment_choice:'per_invoice',pricing:current.pricing,total_cents:current.total_cents};
    delete flexible.method_id;delete flexible.method_version;
    const start=await scalar('select pure_repeat_save($1,$2,$3,$4,$5,null) v',[newPlan,owner,'owner@example.test',JSON.stringify(flexible),'c'.repeat(64)]);
    const invoice=start.invoice_id;
    assert.equal(await scalar('select method_id v from commerce_invoices where id=$1',[invoice]),null);
    const fx={series:'FXUSDCAD',source:'Bank of Canada',fx_ppm:1350100,expires_at:new Date(Date.now()+60000).toISOString()};
    const choose=(who,method=interac)=>run('select pure_repeat_choose_payment($1,$2,$3,1,$4,$5)',[who,invoice,method,current.total_cents,JSON.stringify(fx)]);
    await assert.rejects(choose(other));await choose(owner);await choose(owner);await assert.rejects(choose(owner,mid));
    const cad=Math.round(current.total_cents*fx.fx_ppm/1000000);
    assert.deepEqual((await run("select currency,total_cents,(payment_snapshot->>'settlement_cents')::int as cad from commerce_invoices where id=$1",[invoice])).rows[0],{currency:'USD',total_cents:current.total_cents,cad});
    await run("update pure_repeat_plans set next_due_at=now()-interval '1 second' where id=$1",[newPlan]);
    await db.exec('select commerce_internal.process_repeat_invoices()');
    const renewal=await scalar('select latest_invoice_id v from pure_repeat_plans where id=$1',[newPlan]);
    assert.notEqual(renewal,invoice);assert.equal(await scalar('select method_id v from commerce_invoices where id=$1',[renewal]),null);
    await run('select pure_repeat_choose_payment($1,$2,$3,1,$4,null)',[owner,renewal,mid,current.total_cents]);
    const version=await scalar('select version v from commerce_invoices where id=$1',[invoice]);
    const receipt={receipt_id:randomUUID(),method_id:interac,expected_version:version,confirm_funds_received:true,external_reference:'TEST-INTERAC-001'};
    await assert.rejects(run("select commerce_admin_command('record_payment',$1,'fixture-admin')",[JSON.stringify({...receipt,id:invoice,version,funds_confirmed:true,amount_cents:current.total_cents,currency:'USD'})]));
    await run('select commerce_admin_record_bank_payment($1,$2)',[invoice,JSON.stringify(receipt)]);
    assert.deepEqual((await run('select currency,amount_cents from commerce_receipts where invoice_id=$1',[invoice])).rows,[{currency:'CAD',amount_cents:cad}]);
    assert.equal(await scalar('select currency v from commerce_invoices where id=$1',[invoice]),'USD');
    const refund={receipt_id:randomUUID(),id:invoice,version:version+1,funds_confirmed:true,amount_cents:cad,currency:'CAD',external_reference:'TEST-REFUND-001'};
    await run("select commerce_admin_command('record_refund',$1,'fixture-admin')",[JSON.stringify(refund)]);
    assert.equal(await scalar("select currency v from commerce_receipts where invoice_id=$1 and kind='refund'",[invoice]),'CAD');
  }finally{await db.close();}
});

test('three-delivery term is enforced through invoice scheduling, shipping and recovery', async () => {
  const db = new PGlite();
  const scalar = async (sql, params) => (await db.query(sql, params)).rows[0].v;
  const owner = randomUUID();
  const term = randomUUID();
  const nextTerm = randomUUID();
  const recoveryTerm = randomUUID();
  const email = 'term-owner@example.test';
  const basket = pricedBasket('builder', [{id:'example', size:'small', qty:4}], fixture, 'US', delivery.defaults);
  const snapshot = {kind:'builder', terms:'pure-monthly-invoice-v2', payment_choice:'per_invoice',
    request:{name:'Term Owner', address:{country:'US'}, items:basket.items}, pricing:basket.pricing, total_cents:basket.total_cents};
  const save = (id, data = snapshot, version = null) => scalar('select pure_repeat_save($1,$2,$3,$4,$5,$6) v',
    [id, owner, email, JSON.stringify(data), 'd'.repeat(64), version]);
  const plan = async id => (await scalar('select pure_repeat_list($1) v', [owner])).find(row => row.id === id);
  const manage = async (id, action) => scalar('select pure_repeat_manage($1,$2,$3,$4) v', [owner,id,action,(await plan(id)).version]);
  const status = async (invoice, value) => {
    if (['shipped','delivered'].includes(value)) {
      await db.query("update commerce_fulfillment_items set status=$2,tracking_carrier='Test Carrier',tracking_number='TERM123' where invoice_id=$1", [invoice,value]);
    }
    return db.query('update commerce_invoices set status=$2 where id=$1', [invoice,value]);
  };
  const expire = invoice => db.query("update commerce_invoices set expires_at=now()-interval '1 second' where id=$1", [invoice]);
  const due = async id => {
    await db.query("update pure_repeat_plans set next_due_at=now()-interval '1 second' where id=$1", [id]);
    await db.exec('select commerce_internal.process_repeat_invoices()');
  };
  try {
    await setupRepeatDb(db);
    await db.query('insert into auth.users values($1,$2,now())', [owner,email]);
    await db.exec("update commerce_delivery_options set enabled=true where id='express'");

    await assert.rejects(save(term, {...snapshot, kind:'product'}), {code:'22023'});
    const first = (await save(term)).invoice_id;
    assert.equal((await save(term)).invoice_id, first);
    assert.equal((await plan(term)).cycle, 1);
    assert.equal((await plan(term)).can_edit, false);
    await assert.rejects(save(nextTerm), {code:'P3S01'});
    await assert.rejects(save(term, snapshot, (await plan(term)).version), {code:'P3S02'});
    for (const action of ['pause','skip','cancel']) await assert.rejects(manage(term, action), {code:'P3S03'});

    await status(first, 'paid');
    assert.equal((await plan(term)).can_edit, false);
    await status(first, 'shipped');
    assert.equal((await plan(term)).can_edit, true);
    await assert.rejects(save(term, {...snapshot, terms:'pure-monthly-invoice-v1'}, (await plan(term)).version), {code:'40001'});
    const updated = {...snapshot, request:{...snapshot.request, name:'Updated Term Owner'}};
    await save(term, updated, (await plan(term)).version);
    await status(first, 'delivered');
    assert.equal((await plan(term)).delivered_count, 1);

    await due(term);
    const second = (await plan(term)).invoice_id;
    assert.notEqual(first, second);
    assert.equal(await scalar('select customer_name v from commerce_invoices where id=$1', [first]), 'Term Owner');
    assert.equal(await scalar('select customer_name v from commerce_invoices where id=$1', [second]), 'Updated Term Owner');
    await status(second, 'paid');
    await status(second, 'shipped');
    await due(term);
    const third = (await plan(term)).invoice_id;
    assert.notEqual(second, third);
    assert.equal((await plan(term)).cycle, 3);
    assert.equal((await plan(term)).next_due_at, null);
    assert.equal((await plan(term)).can_edit, false);
    await due(term);
    assert.equal((await plan(term)).invoice_id, third);
    await assert.rejects(db.query('select commerce_internal.issue_repeat_invoice($1)', [term]), {code:'40001'});
    await status(third, 'paid');
    await status(third, 'shipped');
    await status(third, 'delivered');
    assert.equal((await plan(term)).delivered_count, 2);
    assert.equal((await plan(term)).can_restart, false);
    await assert.rejects(save(nextTerm), {code:'P3S01'});
    await status(second, 'delivered');
    assert.equal((await plan(term)).status, 'completed');
    assert.equal((await plan(term)).delivered_count, 3);
    assert.equal((await plan(term)).can_restart, true);
    await status(first, 'refunded');
    assert.equal((await plan(term)).delivered_count, 3);

    const unpaid = (await save(nextTerm)).invoice_id;
    assert.equal((await plan(nextTerm)).can_cancel, false);
    await expire(unpaid);
    assert.equal((await plan(nextTerm)).can_cancel, true);
    await due(nextTerm);
    assert.equal((await plan(nextTerm)).status, 'paused');
    assert.equal((await plan(nextTerm)).invoice_id, unpaid);
    await assert.rejects(manage(nextTerm, 'resume'), {code:'P3S03'});
    await manage(nextTerm, 'cancel');
    assert.equal((await plan(nextTerm)).can_restart, true);
    assert.ok((await save(recoveryTerm)).invoice_id);
    assert.equal(await scalar('select count(*)::int v from commerce_internal.repeat_invoice_cycles'), 5);
  } finally {
    await db.close();
  }
});
