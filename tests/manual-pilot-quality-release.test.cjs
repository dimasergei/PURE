'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=file=>readFileSync(join(__dirname,'../supabase/migrations',file),'utf8');

test('only the named reviewer can release an exact received pilot lot and persist an audit entry',async()=>{
  const db=new PGlite();
  const row=async sql=>(await db.query(sql)).rows[0];
  try{
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create role pilot_fixture login; create table public.suppliers(id uuid primary key default gen_random_uuid());`);
    await db.exec(migration('20261109225035_enterprise_inventory_quality_foundation.sql'));
    await db.exec(migration('20261110000833_enterprise_coa_review_audit_ledger.sql'));
    await db.exec(migration('20261122002200_manual_pilot_quality_release.sql'));
    await db.exec(`insert into public.suppliers default values;
      insert into public.enterprise_inventory_lots(supplier_id,sku_key,lot_number,fulfillment_site,on_hand,evidence_reference)
      select id,'tirzepatide-40mg','TEST-LOT','fixture-us-site',2,'TEST-RECEIPT' from public.suppliers;
      insert into public.enterprise_quality_documents(lot_id,report_id,lab_name,storage_object_key,verification_url)
      select id,'TEST-REPORT','Fixture lab','fixture/reference','https://example.invalid/signed-report' from public.enterprise_inventory_lots;`);
    const {lot_id,document_id}=await row('select lot_id,id as document_id from public.enterprise_quality_documents');
    const args=[lot_id,document_id,'tirzepatide-40mg','TEST-LOT','TEST-REPORT','2026-01-04','Independent signed fixture evidence'];
    const call=(params=args)=>db.query('select pure_pilot_quality.release_received_lot($1,$2,$3,$4,$5,$6,$7)',params);
    const withArg=(i,value)=>args.map((original,j)=>i===j?value:original);
    await assert.rejects(call(),{code:'42501'}); // Shared database owner has no signed individual identity.
    const grants=(await db.query(`select rolname,
      has_schema_privilege(rolname,'pure_pilot_quality','USAGE') as schema_usage,
      has_function_privilege(rolname,'pure_pilot_quality.release_received_lot(uuid,uuid,text,text,text,date,text)','EXECUTE') as execute,
      has_table_privilege(rolname,'pure_pilot_quality.reviewers','INSERT') as register_reviewer
      from pg_roles where rolname in ('anon','authenticated','service_role','pilot_fixture')`)).rows;
    assert.equal(grants.length,4);
    for(const role of grants)assert.deepEqual([role.schema_usage,role.execute,role.register_reviewer],[false,false,false]);
    await db.exec(`insert into pure_pilot_quality.reviewers values ('pilot_fixture','Fixture Reviewer');
      grant usage on schema pure_pilot_quality to pilot_fixture;
      grant execute on function pure_pilot_quality.release_received_lot(uuid,uuid,text,text,text,date,text) to pilot_fixture;`);
    await db.exec('set role pilot_fixture');
    await assert.rejects(call(),{code:'42501'}); // Changing a role cannot impersonate the authenticated reviewer.
    await db.exec('reset role; set session authorization pilot_fixture');
    await assert.rejects(call(withArg(3,'OTHER-LOT')),{code:'22023'});
    await assert.rejects(call(withArg(4,'OTHER-REPORT')),{code:'22023'});
    await assert.rejects(call(withArg(2,'tirzepatide-60mg')),{code:'22023'});
    await assert.rejects(call(withArg(5,'infinity')),{code:'22023'});
    await assert.rejects(call(withArg(6,'  ')),{code:'22023'});
    await assert.rejects(db.query('select * from public.enterprise_quality_documents'),{code:'42501'});
    await assert.rejects(db.query('delete from pure_pilot_quality.releases'),{code:'42501'});
    await call();
    await call(); // Safe retry after an ambiguous network response.
    await assert.rejects(call(withArg(6,'Different signed fixture evidence')),{code:'P0001'});
    await db.exec('set session authorization postgres');
    assert.deepEqual(await row('select status,reviewed_by from public.enterprise_inventory_lots'),{status:'released',reviewed_by:'Fixture Reviewer'});
    assert.deepEqual(await row('select status,publication_approved,reviewer from public.enterprise_quality_documents'),{status:'verified',publication_approved:true,reviewer:'Fixture Reviewer'});
    assert.deepEqual(await row('select count(*)::int as count, min(database_login::text) as actor from pure_pilot_quality.releases'),{count:1,actor:'pilot_fixture'});
    await db.query("select public.enterprise_review_quality_document($1,'withdraw','Fixture withdrawal overrides prior signoff','fixture-ops')",[document_id]);
    await db.exec('set session authorization pilot_fixture');
    await assert.rejects(call(),{code:'P0001'});
  }finally{await db.close();}
});
