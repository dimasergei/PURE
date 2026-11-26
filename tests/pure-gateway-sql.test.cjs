'use strict';
// Disposable PostgreSQL only (PGlite). No production credentials, provider calls or remote DDL.
// Applies the real migration chain up to the newest checkout validators, then the pure_gateway card route.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json'),delivery=require('../lib/delivery-options');
const gw=require('../lib/pure-gateway');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
const migration='20261125000100_pure_gateway_card_route.sql';
const cardTestMigration='20261125223346_one_use_card_test_coupon.sql';
const reversalMigration='20261126011403_verified_pure_gateway_reversals.sql';
const guestMigration='20261126013508_guest_checkout.sql';
const guestPaymentsMigration='20261126024818_guest_interac_and_crypto.sql';
const directUsdcNetworksMigration='20261126032739_direct_usdc_networks.sql';
const tag=gw.configuration({PURE_GATEWAY_URL:'https://pay.example.test'}).account_tag;
const catalog=[
 {id:'fixture-a',name:'Fixture A',category:'injectables',variants:[{size:'5mg',price:99.99}]},
 {id:'fixture-b',name:'Fixture B',category:'injectables',variants:[{size:'10mg',price:100.01}]}
];
const BASE=['20261110040926_manual_invoice_commerce.sql','20261110074742_payment_provider_options.sql','20261110164316_native_gateway_checkout.sql',
 '20261111013606_peptidepay_invoice_sessions.sql','20261110061306_invoice_notification_outbox.sql','20261111025932_direct_checkout_balances.sql','20261111163930_conversion_memberships_partners.sql',
 '20261111174353_partner_settings_supplier_queue.sql','20261111195957_unified_supplier_fulfillment.sql','20261111210000_single_supplier_per_order.sql',
 '20261112211215_rampex_order_payment_mapping.sql','20261112221052_rampex_multi_hosted.sql','20261113003946_rampex_stripe_only.sql','20261113030240_safe_checkout_cancellation.sql',
 '20261114211235_platinum_membership_benefits.sql','20261115090000_research_subscriptions.sql','20261116140000_unified_order_management.sql','20261116150000_purity_manual_fulfillment.sql'];
const PRICING=['20261117084413_pure_storefront_regular_pricing.sql','20261117192240_pure_canada_next_day_delivery.sql','20261117194109_pure_card_crypto_checkout.sql',
 '20261117221328_pure_stack_crypto_discount.sql','20261118020145_pure_generic_manual_fulfillment.sql','20261118070801_pure_interac_cad_checkout.sql'];
const LATER=['20261118180549_pure_membership_checkout.sql','20261118231100_pure_quantity_tiers.sql','20261118235500_pure_canadian_free_standard_shipping.sql',
 '20261119213000_pure_membership_only_stack.sql','20261119221500_pure_member_stack_tier_benefits.sql','20261119231000_pure_bulk_order_volume_tiers.sql'];
const NEWEST=['20261120103000_economy_shipping_lower_rates.sql','20261120115000_combined_member_checkout_validation.sql','20261120115500_combined_membership_lifecycle_part1.sql',
 '20261120120000_combined_membership_lifecycle_part2.sql','20261122000100_campaign_bac_fulfillment.sql','20261122000200_partner_commission_rates.sql','20261122000300_partner_chargebacks.sql',
 '20261122000400_storefront_reviews.sql','20261122000500_review_credit.sql','20261122000700_bogo_fulfillment.sql','20261122000800_blackfriday10_checkout.sql',
 '20261122001000_partner_first_order_discount.sql','20261122001100_bogo_shipping_threshold.sql','20261122001200_commerce_order_numbers.sql','20261122001300_compound_bulk_checkout.sql',
 '20261122001400_order_lot_coas.sql','20261122001500_shipping_thresholds.sql','20261122001700_catalog_bogo_eligibility.sql','20261122001900_bulk_offer_exclusivity.sql',
 '20261122002100_recon_gift_packed_lot.sql','20261109231123_enterprise_atomic_inventory_reservation.sql','20261109231602_enterprise_atomic_reservation_cancellation.sql',
 '20261122002000_manual_pilot_fulfillment.sql','20261122001600_first_paid_order_bac.sql','20261123000100_exclusive_merchandise_offers.sql'];
const apply=async(db,files)=>{for(const file of files){try{await db.exec(read(file));}catch(error){error.message=file+': '+error.message;throw error;}}};

test('the pure_gateway card route is registered, priced and settled atomically in disposable PostgreSQL',{timeout:240000},async t=>{
 const db=new PGlite();
 const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v))).rows[0].result;
 const load=async id=>(await db.query('select * from public.commerce_invoices where id=$1',[id])).rows[0];
 const attemptRow=async id=>(await db.query('select * from public.commerce_gateway_attempts where id=$1',[id])).rows[0];
 const route={id:randomUUID()},hosted='1efcda11-7310-4c45-b6bb-3cfdd8873784',interac=randomUUID();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema commerce_internal;');
  await apply(db,BASE);
  await db.query("insert into commerce_payment_methods(id,kind,provider_key,label,currency,payee,instructions,allowed_host,acceptance_reference,active,sale_scope,native_provider) values($1,'hosted_link','custom','Fixture Card','USD','Isolated business','Disposable verified payment fixture','getpurelabs.com','Isolated provider acceptance fixture',true,'goods','rampex')",[hosted]);
  await db.query("insert into commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,rampex_provider) values($1,'rampex','live',$2,array['US','CA'],'hosted')",[hosted,'a'.repeat(64)]);
  await apply(db,PRICING);
  await db.exec("create schema cron;create table cron.job(jobname text primary key,schedule text,command text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values($1,$2,$3) on conflict(jobname) do update set schedule=$2,command=$3;return 1;end$$;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);create schema extensions;create function extensions.hmac(bytea,bytea,text) returns bytea language sql as $$select decode(repeat('a',64),'hex')$$;create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;");
  await apply(db,['20261117193534_pure_direct_polygon_usdc.sql','20261117221400_pure_crypto_cancellation_requests.sql']);
  for(const option of delivery.defaults)await db.query('update commerce_delivery_options set label=$2,price_cents=$3,enabled=$4,description=$5 where id=$1',[option.id,option.label,option.price_cents,option.enabled,option.description]);
  await db.query("insert into commerce_payment_methods(id,kind,provider_key,label,currency,payee,instructions,acceptance_reference,active,sale_scope) values($1,'interac','interac','Fixture Interac','CAD','Fixture business','Disposable fixture: receiving@example.test','Isolated receiver approval',true,'goods')",[interac]);
  await apply(db,LATER);
  await db.exec('create table if not exists public.suppliers (id uuid primary key, name text not null)');
  await db.exec(read('20261109225035_enterprise_inventory_quality_foundation.sql'));
  await apply(db,NEWEST);

  const before={validate:(await db.query("select pg_get_functiondef('commerce_internal.validate_membership_checkout(jsonb)'::regprocedure) d")).rows[0].d,
   place:(await db.query("select pg_get_functiondef('commerce_internal.place_membership_checkout(jsonb)'::regprocedure) d")).rows[0].d};
  const aclBefore=(await db.query("select proname,proacl::text acl from pg_proc where proname in ('validate_membership_checkout','place_membership_checkout','commerce_finish_gateway_attempt') order by proname")).rows;
  const historical=await db.query("select count(*)::int n from commerce_gateway_attempts");
  await db.exec(read(migration));

  await t.test('the migration patches only the provider gate of the shared checkout validators and keeps their access rules',async()=>{
   const after={validate:(await db.query("select pg_get_functiondef('commerce_internal.validate_membership_checkout(jsonb)'::regprocedure) d")).rows[0].d,
    place:(await db.query("select pg_get_functiondef('commerce_internal.place_membership_checkout(jsonb)'::regprocedure) d")).rows[0].d};
   for(const key of ['validate','place']){
    assert.notEqual(after[key],before[key]);
    assert.equal(after[key].replace(",'pure_gateway'",''),before[key],key+' differs from the previous definition only by the new provider');
    assert.match(after[key],/'rampex','polygon_usdc','pure_gateway'/);
   }
   assert.deepEqual((await db.query("select proname,proacl::text acl from pg_proc where proname in ('validate_membership_checkout','place_membership_checkout','commerce_finish_gateway_attempt') order by proname")).rows,aclBefore,'execute rights are unchanged');
   assert.equal(historical.rows[0].n,0);
  });

  const setup={id:route.id,version:0,provider:'pure_gateway',mode:'live',currency:'USD',sale_scope:'goods',confirmed:true,active:true,account_tag:tag,countries:['US'],
   label:'Card',payee:'PURE',approval_reference:'Stripe approval ref 2026-11'};
  await t.test('an administrator registers a USD goods-only route; anything broader is refused',async()=>{
   for(const [name,delta,pattern]of [['membership scope',{sale_scope:'membership'},/Invalid gateway/],['both scopes',{sale_scope:'both'},/Invalid gateway/],['CAD',{currency:'CAD'},/Invalid gateway/],
    ['sandbox mode',{mode:'sandbox'},/Invalid gateway/],['short label',{label:'No'},/Invalid gateway/],['bad tag',{account_tag:'abc'},/Invalid gateway/],['unconfirmed',{confirmed:false},/Invalid gateway/],
    ['no countries',{countries:[]},/Approved destinations/],['bad country',{countries:['USA']},/Invalid country/],['not a first version',{version:3},/Unknown gateway/]])
    await assert.rejects(rpc('commerce_configure_pure_gateway',[{...setup,id:randomUUID(),...delta},'admin-native:fixture']),pattern,name);
   await assert.rejects(rpc('commerce_configure_pure_gateway',[setup,'short']),/Invalid gateway/);
   assert.equal((await db.query('select count(*)::int n from commerce_payment_methods where native_provider=$1',['pure_gateway'])).rows[0].n,0);
   assert.deepEqual(await rpc('commerce_configure_pure_gateway',[setup,'admin-native:fixture']),{id:route.id,saved:true});
   const method=(await db.query('select * from commerce_payment_methods where id=$1',[route.id])).rows[0];
   assert.equal(method.native_provider,'pure_gateway');assert.equal(method.sale_scope,'goods');assert.equal(method.active,true);assert.equal(method.version,1);
   const account=(await db.query('select * from commerce_gateway_accounts where method_id=$1',[route.id])).rows[0];
   assert.equal(account.provider,'pure_gateway');assert.equal(account.mode,'live');assert.equal(account.account_tag,tag);
   await assert.rejects(rpc('commerce_configure_pure_gateway',[{...setup,version:0},'admin-native:fixture']),/Gateway changed/);
   await assert.rejects(rpc('commerce_configure_pure_gateway',[{...setup,version:1,account_tag:'b'.repeat(64)},'admin-native:fixture']),/different gateway account/);
   await rpc('commerce_configure_pure_gateway',[{...setup,version:1,countries:['US','CA'],label:'Card'},'admin-native:fixture']);
   assert.deepEqual((await db.query('select countries from commerce_gateway_accounts where method_id=$1',[route.id])).rows[0].countries,['US','CA']);
  });

  async function make({method=route.id,country='US',kind='goods',customer=randomUUID(),products=catalog}={}){
   const row=(await db.query('select * from commerce_payment_methods where id=$1',[method])).rows[0],user={id:customer,email:'gateway-fixture@example.test'};
   const body={id:randomUUID(),kind,plan:kind==='membership'?'vip':undefined,billing_period:kind==='membership'?'monthly':undefined,method_id:method,checkout_version:config.version,consent:true,research_use:true,name:'Isolated researcher',
    coupon:'',points:0,credit_cents:0,items:products.map(x=>({id:x.id,size:x.variants[0].size,qty:1})),
    address:{line1:'123 Fixture Street',city:'Fixture City',region:'NY',postal_code:'10001',country},delivery:{shipping:'standard',extras:[]}};
   const record=await checkout.normalize({},user,body,products);
   const quote=checkout.price(record,row,null,{points:0,credit_cents:0},null,delivery.defaults,null,null);
   return{...record,...quote,checkout_version:config.version,customer};
  }
  const place=p=>rpc('commerce_place_checkout',[p]);

  await t.test('goods checkout is accepted on the new route; memberships and unsupported countries are not; existing routes still work',async()=>{
   const order=await make();
   const placed=await place(order);
   assert.equal(placed.status,'accepted');
   const saved=await load(order.id);
   assert.equal(saved.method_id,route.id);assert.equal(saved.total_cents,order.total_cents);assert.match(saved.payment_snapshot.payment_url,/^https:\/\/getpurelabs\.com\/pay\.html\?invoice=/);
   await assert.rejects(make({kind:'membership'}),/does not support this purchase/,'pricing already refuses a membership on a goods-only route');
   // Even a hand-built membership request aimed at the route is stopped by the database.
   const sneaky=await make({method:hosted,kind:'membership'});
   sneaky.method_id=route.id;sneaky.method_version=(await db.query('select version from commerce_payment_methods where id=$1',[route.id])).rows[0].version;
   if(sneaky.request?.checkout)sneaky.request.checkout.method_id=route.id;
   await assert.rejects(place(sneaky),/Payment method changed|Choose|Invalid|Live gateway/,'a goods-only route can not take a membership');
   const original=await make({method:hosted});
   assert.equal((await place(original)).status,'accepted','the existing Rampex hosted Card route is unchanged');
   await db.query("update commerce_payment_methods set active=false where id=$1",[route.id]);
   await assert.rejects(place(await make({})),/Payment method changed|inactive/);
   await db.query("update commerce_payment_methods set active=true where id=$1",[route.id]);
   await assert.rejects(place(await make({country:'CA'}).then(p=>({...p,request:{...p.request,address:{...p.request.address,country:'GB'}}}))),/./,'a destination outside the configured countries is rejected');
  });

  const payable=async()=>{const order=await make();await place(order);return order;};
  const begin=(order,attemptId=randomUUID())=>rpc('commerce_begin_gateway_attempt',[attemptId,order.id,order.customer,'sale',tag]);
  const redirect=pi=>'https://pay.example.test/pay?pi='+pi;

  await t.test('one attempt per order is bound to its PaymentIntent before any redirect is exposed',async()=>{
   const order=await payable(),attempt=await begin(order);
   assert.equal(attempt.claimed,true);assert.equal(attempt.provider,'pure_gateway');assert.equal(attempt.state,'started');assert.equal(attempt.amount_cents,order.total_cents);
   const again=await begin(order,randomUUID());assert.equal(again.claimed,false);assert.equal(again.id,attempt.id,'a second submission returns the same attempt');
   const bind=(pi,url,t_=tag)=>rpc('commerce_bind_pure_gateway_session',[attempt.id,pi,url,t_]);
   for(const [name,pi,url]of [['peptidepay style session','cs_abcdefghij',redirect('cs_abcdefghij')],['other payment in url','pi_fixture123456',redirect('pi_other0000001')],['wrong path','pi_fixture123456','https://pay.example.test/other?pi=pi_fixture123456'],
    ['extra query','pi_fixture123456',redirect('pi_fixture123456')+'&x=1'],['fragment','pi_fixture123456',redirect('pi_fixture123456')+'#x'],['backslash','pi_fixture123456','https://pay.example.test\\@evil.example/pay?pi=pi_fixture123456'],
    ['plain http to a public host','pi_fixture123456','http://pay.example.test/pay?pi=pi_fixture123456'],['javascript','pi_fixture123456','javascript:alert(1)'],['no url','pi_fixture123456',null]])
    await assert.rejects(bind(pi,url),/Invalid gateway session|violates check|null/i,name);
   await assert.rejects(bind('pi_fixture123456',redirect('pi_fixture123456'),'f'.repeat(64)),/Wrong gateway attempt/);
   assert.equal((await attemptRow(attempt.id)).provider_session_id,null,'a rejected binding leaves nothing behind');
   const bound=await bind('pi_fixture123456',redirect('pi_fixture123456'));
   assert.equal(bound.state,'redirected');
   const row=await attemptRow(attempt.id);assert.equal(row.provider_session_id,'pi_fixture123456');assert.equal(row.redirect_url,redirect('pi_fixture123456'));
   assert.equal((await bind('pi_fixture123456',redirect('pi_fixture123456'))).replayed,true);
   await assert.rejects(bind('pi_fixture999999',redirect('pi_fixture999999')),/Session binding conflict/);
   await assert.rejects(db.query("update commerce_gateway_attempts set provider_session_id='cs_abcdefghij' where id=$1",[attempt.id]),/check/i,'the session reference format is provider specific');
   await db.exec("begin");try{await db.query("update commerce_gateway_attempts set provider_session_id='pi_fixture123456',provider='peptidepay' where id=$1",[attempt.id]);assert.fail('a PaymentIntent is not a PeptidePay session');}catch(error){assert.match(error.message,/check/i);}finally{await db.exec('rollback');}
  });

  const finish=(attemptId,event,outcome,tx,amount,currency,error=null)=>rpc('commerce_finish_gateway_attempt',[attemptId,event,outcome,tx,amount,currency,null,error]);

  await t.test('only a bound, exactly matching charge records the payment; everything else goes to review or is refused',async()=>{
   const order=await payable(),attempt=await begin(order);
   await assert.rejects(finish(attempt.id,'pure-gateway-paid:pi_x00000000','approved','ch_3FixtureCharge01',order.total_cents,'USD'),/Bound gateway settlement required/,'an unbound attempt can never be paid');
   await rpc('commerce_bind_pure_gateway_session',[attempt.id,'pi_fixture333333',redirect('pi_fixture333333'),tag]);
   for(const tx of ['0x'+'a'.repeat(64),'abc','ch_x','cs_fixture123456',null])await assert.rejects(finish(attempt.id,'pure-gateway-paid:'+tx,'approved',tx,order.total_cents,'USD'),/Bound gateway settlement required|Invalid gateway result/,String(tx));
   assert.equal((await load(order.id)).status,'accepted');
   const wrong=await finish(attempt.id,'pure-gateway-paid:wrong-amount','approved','ch_3FixtureCharge01',order.total_cents-1,'USD');
   assert.equal(wrong.state,'review');assert.equal((await load(order.id)).status,'accepted','a mismatch never marks the order paid');
  });

  await t.test('a verified charge pays the order once, replays are harmless and conflicting events are rejected',async()=>{
   const order=await payable(),attempt=await begin(order);
   await rpc('commerce_bind_pure_gateway_session',[attempt.id,'pi_fixture777777',redirect('pi_fixture777777'),tag]);
   const key='pure-gateway-paid:pi_fixture777777';
   const done=await finish(attempt.id,key,'approved','ch_3FixtureCharge77',order.total_cents,'USD');
   assert.equal(done.state,'paid');assert.equal((await load(order.id)).status,'paid');
   assert.equal((await db.query("select external_reference from commerce_receipts where invoice_id=$1",[order.id]).catch(()=>({rows:[]}))).rows.length<=1,true);
   const replay=await finish(attempt.id,key,'approved','ch_3FixtureCharge77',order.total_cents,'USD');
   assert.equal(replay.replayed,true);assert.equal((await load(order.id)).status,'paid');
   await assert.rejects(finish(attempt.id,key,'approved','ch_3FixtureCharge78',order.total_cents,'USD'),/Gateway event conflict/);
   const row=await attemptRow(attempt.id);assert.equal(row.state,'paid');assert.equal(row.provider_transaction_id,'ch_3FixtureCharge77');
   const second=await payable(),other=await begin(second);
   await rpc('commerce_bind_pure_gateway_session',[other.id,'pi_fixture888888',redirect('pi_fixture888888'),tag]);
   await assert.rejects(finish(other.id,'pure-gateway-paid:pi_fixture888888','approved','ch_3FixtureCharge77',second.total_cents,'USD'),/unique|duplicate/i,'one provider charge can never pay two orders');
  });

  await t.test('a provider refund is flagged for review without changing a paid order, and an in-flight card payment blocks cancellation',async()=>{
   const order=await payable(),attempt=await begin(order);
   await rpc('commerce_bind_pure_gateway_session',[attempt.id,'pi_fixture555555',redirect('pi_fixture555555'),tag]);
   await assert.rejects(rpc('commerce_cancel_checkout',[order.id,order.customer]),/./,'a payment in progress cannot be canceled until it is reviewed');
   assert.equal((await load(order.id)).status,'accepted');
   await finish(attempt.id,'pure-gateway-paid:pi_fixture555555','approved','ch_3FixtureCharge55',order.total_cents,'USD');
   const review=await finish(attempt.id,'pure-gateway-review:pi_fixture555555:pure_gateway_refund_review','review',null,null,null,'pure_gateway_refund_review');
   assert.equal(review.state,'paid');assert.equal((await load(order.id)).status,'paid');
   assert.equal((await db.query("select count(*)::int n from commerce_gateway_events where provider='pure_gateway' and outcome='review'")).rows[0].n>=1,true,'the refund report is kept for the payments desk');
  });

  await t.test('a canceled PaymentIntent frees the order for a new attempt, and a membership can not use the route',async()=>{
   const order=await payable(),attempt=await begin(order);
   await rpc('commerce_bind_pure_gateway_session',[attempt.id,'pi_fixture444444',redirect('pi_fixture444444'),tag]);
   const canceled=await finish(attempt.id,'pure-gateway-canceled:pi_fixture444444','declined',null,null,null,'pure_gateway_canceled');
   assert.equal(canceled.state,'declined');
   const next=await begin(order);assert.equal(next.claimed,true);assert.notEqual(next.id,attempt.id);
   assert.equal((await db.query("select count(*)::int n from commerce_invoices where kind='membership' and method_id=$1",[route.id])).rows[0].n,0);
  });
  await t.test('CARDTEST validates its own price and route, expires, and redeems with the order exactly once',async()=>{
   await db.exec(read(cardTestMigration));
   const access=(await db.query(`select
     has_table_privilege('anon','public.commerce_card_test_entitlements','select') as anon_read,
     has_table_privilege('authenticated','public.commerce_card_test_entitlements','select') as signed_in_read,
     has_table_privilege('service_role','public.commerce_card_test_entitlements','select') as service_read,
     has_column_privilege('service_role','public.commerce_card_test_entitlements','redeemed_invoice_id','update') as service_can_reset`)).rows[0];
   assert.deepEqual(access,{anon_read:false,signed_in_read:false,service_read:true,service_can_reset:false});

   const tester=randomUUID();
   await db.query('insert into auth.users(id) values ($1)',[tester]);
   const item={...catalog[0],variants:[{...catalog[0].variants[0],price:24.99}]};
   const makeTestOrder=async(method=route.id)=>{
    const order=await make({method,customer:tester,products:[item]});
    const discount=2399;
    order.request.checkout.coupon='CARDTEST';
    order.discount_cents=discount;
    order.total_cents=100+order.shipping_cents;
    order.earned_points=0;
    Object.assign(order.pricing,{coupon_code:'CARDTEST',coupon_discount_cents:discount,discount_cents:discount,
     discount_source:'coupon',merchandise_offer:'coupon',usd_earned_points_basis_cents:100});
    Object.assign(order.pricing.lines[0],{discount_cents:discount,discount_bps:9800,discount_reason:'coupon_cardtest',
     coupon_discount_cents:discount,line_total_cents:100});
    return order;
   };
   const order=await makeTestOrder();
   await assert.rejects(place(order),/CARDTEST is unavailable for this account/);
   await db.query("insert into public.commerce_card_test_entitlements(customer_id,expires_at) values ($1,now()-interval '1 day')",[tester]);
   await assert.rejects(place(order),/CARDTEST is unavailable for this account/);
   await db.query("update public.commerce_card_test_entitlements set expires_at=now()+interval '1 day' where customer_id=$1",[tester]);
   await assert.rejects(place(await makeTestOrder(hosted)),/CARDTEST requires one retail item and Credit\/Debit card/);
   const stacked=structuredClone(order);
   stacked.request.checkout.affiliate_code='PARTNER';
   await assert.rejects(place(stacked),/CARDTEST requires one retail item and Credit\/Debit card/);
   const largerCart=structuredClone(order);
   largerCart.request.items[0].qty=2;
   await assert.rejects(place(largerCart),/CARDTEST requires one retail item and Credit\/Debit card/);
   const forgedPrice=structuredClone(order);
   forgedPrice.pricing.lines[0].line_total_cents=99;
   await assert.rejects(place(forgedPrice),/coupon or Crypto arithmetic changed/);
   assert.equal((await db.query('select redeemed_invoice_id from public.commerce_card_test_entitlements where customer_id=$1',[tester])).rows[0].redeemed_invoice_id,null);

   assert.equal((await place(order)).status,'accepted');
   assert.equal((await db.query('select redeemed_invoice_id from public.commerce_card_test_entitlements where customer_id=$1',[tester])).rows[0].redeemed_invoice_id,order.id);
   assert.equal((await place(order)).replayed,true);
   await assert.rejects(place(await makeTestOrder()),/CARDTEST is unavailable for this account/);
   const attempt=await begin(order);
   assert.equal(attempt.amount_cents,100+order.shipping_cents);
   assert.equal(attempt.currency,'USD');
   assert.equal((await place(await make())).status,'accepted');
  });
  await db.exec(read(reversalMigration));
  await db.exec(read(guestMigration));
  await t.test('a guest can place and pay for a Card order without an auth user or account rewards',async()=>{
   const order=await make({products:[catalog[0]]});
   order.request.checkout.guest=true;
   order.earned_points=0;
   assert.deepEqual((await db.query('select id from auth.users where id=$1',[order.customer])).rows,[]);
   await assert.rejects(place({...order,earned_points:1}),/points earning basis changed/);
   const otherMethod=await make({method:hosted,products:[catalog[0]]});
   otherMethod.request.checkout.guest=true;
   otherMethod.earned_points=0;
   await assert.rejects(place(otherMethod),/Invalid guest checkout sale/);
   assert.equal((await place(order)).status,'accepted');
   assert.equal((await place(order)).replayed,true);
   assert.equal((await load(order.id)).request_data.checkout.guest,true);
   await assert.rejects(begin({...order,customer:randomUUID()}),/invoice|eligible/i);
   const attempt=await begin(order),session='pi_guestFixture123456';
   await rpc('commerce_bind_pure_gateway_session',[attempt.id,session,redirect(session),tag]);
   assert.equal((await finish(attempt.id,'pure-gateway-paid:'+session,'approved','ch_guestFixture123456',order.total_cents,'USD')).state,'paid');
   const paid=await load(order.id);
   assert.equal(paid.status,'paid');
   assert.equal(paid.earned_points,0);
   assert.equal(paid.pricing.first_order_bac,undefined);
   assert.equal((await db.query('select points from commerce_balance_accounts where customer_id=$1',[order.customer])).rows[0].points,0);
  });
  await db.exec(read(guestPaymentsMigration));
  await t.test('a Canadian guest can save a fixed CAD Interac order without a receipt or account rewards',async()=>{
   const customer=randomUUID(), item=catalog[0], now=new Date();
   const method=(await db.query('select * from commerce_payment_methods where id=$1',[interac])).rows[0];
   const record=await checkout.normalize({}, {id:customer,email:'guest-cad@example.test'}, {
    id:randomUUID(),kind:'goods',name:'Fixture guest',method_id:interac,checkout_version:config.version,
    consent:true,research_use:true,items:[{id:item.id,size:item.variants[0].size,qty:1}],
    address:{line1:'100 Fixture Street',city:'Waterloo',region:'ON',postal_code:'N2L 1A1',country:'CA'},
    delivery:{shipping:'economy',extras:[]}
   },catalog);
   record.request.checkout.guest=true;
   record.request.checkout.input_digest=record.digest;
   record.request.checkout.payment_kind='interac';
   record.request.checkout.payment_method_version=method.version;
   record.request.preferred_payment={method_id:interac,provider_key:'interac',label:method.label,currency:'CAD'};
   const fx={fx_ppm:1375000,source:'Bank of Canada',series:'FXUSDCAD',
    rate_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),
    quoted_at:now.toISOString(),expires_at:new Date(now.getTime()+900000).toISOString(),token:'fixture'};
   const order={...record,...checkout.price(record,method,null,{points:0,credit_cents:0},null,delivery.defaults,fx),
    checkout_version:checkout.INTERAC_VERSION};
   await assert.rejects(rpc('commerce_place_interac_checkout',[{...order,earned_points:1}]),/points earning basis changed/);
   const result=await rpc('commerce_place_interac_checkout',[order]);
   assert.equal(result.status,'accepted');
   assert.equal(result.manual_transfer,true);
   assert.equal(result.currency,'CAD');
   assert.equal(result.total_cents,order.total_cents);
   const saved=await load(order.id);
   assert.equal(saved.request_data.checkout.guest,true);
   assert.equal(saved.paid_at,null);
   assert.equal(saved.earned_points,0);
   assert.equal(saved.payment_snapshot.instructions,method.instructions);
   assert.deepEqual((await db.query('select id from auth.users where id=$1',[customer])).rows,[]);
   assert.deepEqual((await db.query('select id from commerce_receipts where invoice_id=$1',[order.id])).rows,[]);
  });
  const reverseFixture=async suffix=>{
   const order=await payable(),attempt=await begin(order),session='pi_reverse'+suffix,charge='ch_reverse'+suffix;
   await rpc('commerce_bind_pure_gateway_session',[attempt.id,session,redirect(session),tag]);
   const canceled={paymentIntentId:session,metadata:{orderId:order.id},status:'canceled',currency:'usd',livemode:true,
    amount:order.total_cents,amountReceived:0,amountRefunded:0};
   const refunded={...canceled,status:'succeeded',chargeId:charge,amountReceived:order.total_cents,amountRefunded:order.total_cents,
    refund:{id:'re_reverse'+suffix,status:'succeeded',amount:order.total_cents,createdAt:'2026-11-26T01:00:00.000Z'}};
   return {order,attempt,session,charge,canceled,refunded};
  };

  await t.test('a canceled Stripe intent and its unpaid order close under the same lock',async()=>{
   const {order,attempt,canceled}=await reverseFixture('cancel1');
   const actor='customer:'+order.customer;
   const cancel=(evidence=canceled,account=tag,customer=order.customer,by=actor)=>
    rpc('commerce_apply_pure_gateway_cancellation',[order.id,attempt.id,customer,account,evidence,by]);
   for(const [delta,expected] of [[{paymentIntentId:'pi_reversewrong'},/saved order/],
    [{metadata:{orderId:randomUUID()}},/saved order/],[{livemode:false},/saved order/],
    [{currency:'cad'},/saved order/],[{amount:canceled.amount+1},/saved order/],
    [{amountReceived:1},/canceled and unpaid/],[{status:'requires_payment_method'},/canceled and unpaid/]])
    await assert.rejects(cancel({...canceled,...delta}),expected);
   await assert.rejects(cancel(canceled,'f'.repeat(64)),/saved order/);
   await assert.rejects(cancel(canceled,tag,randomUUID(),'admin:unpaid-cancellation'),/Order not found/);
   assert.equal((await attemptRow(attempt.id)).state,'redirected');
   assert.equal((await load(order.id)).status,'accepted');
   const result=await cancel();
   assert.equal(result.status,'void');assert.equal(result.payment_state,'canceled');
   assert.equal((await attemptRow(attempt.id)).state,'declined');
   assert.equal((await cancel()).replayed,true);
   await assert.rejects(begin(order),/./,'canceling also prevents a new payment attempt');
   assert.equal((await db.query("select count(*)::int n from commerce_events where invoice_id=$1 and action='card_gateway_cancellation_verified'",[order.id])).rows[0].n,1);
  });

  await t.test('only full matched Stripe refunds write a receipt, stop fulfillment, and replay safely',async()=>{
   const {order,attempt,session,charge,refunded}=await reverseFixture('refund1');
   const refund=(evidence=refunded,account=tag)=>rpc('commerce_apply_pure_gateway_refund',
    [order.id,attempt.id,account,evidence,'admin:card-reconciliation']);
   await finish(attempt.id,'pure-gateway-paid:'+session,'approved',charge,order.total_cents,'USD');
   for(const [delta,expected] of [[{livemode:false},/saved order/],
    [{amountRefunded:order.total_cents-1},/completed full refund/],
    [{refund:{...refunded.refund,status:'pending'}},/completed full refund/],
    [{refund:{...refunded.refund,amount:order.total_cents-1}},/completed full refund/],
    [{chargeId:'ch_reversewrong'},/verified Stripe payment/]])
    await assert.rejects(refund({...refunded,...delta}),expected);
   assert.equal((await load(order.id)).status,'paid');
   assert.equal((await refund()).status,'refunded');
   assert.equal((await attemptRow(attempt.id)).state,'refunded');
   assert.equal((await refund()).replayed,true);
   await assert.rejects(refund({...refunded,refund:{...refunded.refund,id:'re_reverseconflicting'}}),/Existing refund record/);
   const receipt=(await db.query("select external_reference,amount_cents from commerce_receipts where invoice_id=$1 and kind='refund'",[order.id])).rows;
   assert.deepEqual(receipt,[{external_reference:'pure_gateway:refund:'+refunded.refund.id,amount_cents:order.total_cents}]);
   const current=await load(order.id);
   await assert.rejects(rpc('commerce_admin_fulfill_order',[order.id,{version:current.version,action:'update_order',status:'processing',note:'Should never resume shipping'}]),/./);
   assert.equal((await db.query("select count(*)::int n from commerce_events where invoice_id=$1 and action='card_gateway_refund_verified'",[order.id])).rows[0].n,1);
  });

  await t.test('external refunds can reconcile before payment delivery without queueing a paid confirmation',async()=>{
   const {order,attempt,session,charge,refunded}=await reverseFixture('refund2');
   const result=await rpc('commerce_apply_pure_gateway_refund',[order.id,attempt.id,tag,refunded,'verified-gateway:pure_gateway']);
   assert.equal(result.status,'refunded');
   const receipts=(await db.query('select kind from commerce_receipts where invoice_id=$1 order by kind',[order.id])).rows;
   assert.deepEqual(receipts.map(row=>row.kind),['payment','refund']);
   const notices=(await db.query("select event_action,state from commerce_notifications where invoice_id=$1 and event_action in ('payment_recorded','full_refund_recorded') order by event_action",[order.id])).rows;
   assert.ok(notices.some(n=>n.event_action==='full_refund_recorded'&&n.state==='queued'));
   assert.ok(notices.filter(n=>n.event_action==='payment_recorded').every(n=>n.state==='skipped'));
   assert.equal((await finish(attempt.id,'pure-gateway-paid:'+session,'approved',charge,order.total_cents,'USD')).state,'refunded');
   const [roles]=(await db.query(`select
    has_function_privilege('anon','public.commerce_apply_pure_gateway_refund(uuid,uuid,text,jsonb,text)','execute') as anonymous,
    has_function_privilege('authenticated','public.commerce_apply_pure_gateway_cancellation(uuid,uuid,uuid,text,jsonb,text)','execute') as signed_in,
    has_function_privilege('service_role','public.commerce_apply_pure_gateway_refund(uuid,uuid,text,jsonb,text)','execute') as backend`)).rows;
   assert.deepEqual(roles,{anonymous:false,signed_in:false,backend:true});
  });

  await t.test('direct USDC extends guest checkout to Base and Ethereum without modifying historical Polygon payments',async t=>{
   const randomHash=()=> '0x'+randomBytes(32).toString('hex');
   const recipient='0x'+'a'.repeat(40),payer='0x'+'b'.repeat(40);
   const networks=[
    {provider:'polygon_usdc',chain:137,token:'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',field:'polygon_recipient'},
    {provider:'base_usdc',chain:8453,token:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',field:'base_usdc_recipient'},
    {provider:'ethereum_usdc',chain:1,token:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',field:'ethereum_usdc_recipient'}
   ];
   const [polygon,base,ethereum]=networks;
   const tagFor=(n,receiver=recipient)=>createHash('sha256').update(`${n.provider}:live:${n.chain}:${n.token}:${receiver}`).digest('hex');
   const configure=(n,changes={})=>rpc(`commerce_configure_${n.provider}_gateway`,[{
    id:n.id,version:0,provider:n.provider,mode:'live',currency:'USD',sale_scope:'goods',confirmed:true,active:true,
    account_tag:tagFor(n),[n.field]:recipient,countries:['US','CA'],label:'Native USDC',payee:'PURE',approval_reference:'Isolated USDC receiver approval',...changes
   },'fixture-admin']);
   for(const network of networks)network.id=randomUUID();
   const guest=async n=>{
    const order=await make({method:n.id,products:[catalog[0]]});
    order.request.checkout.guest=true;
    order.earned_points=0;
    return order;
   };
   const authorization=(n,order)=>{
    const now=Math.floor(Date.now()/1000);
    return {chain_id:n.chain,token:n.token,recipient,payer,amount_units:String(BigInt(order.total_cents)*10000n),
     nonce:randomHash(),valid_after:now-60,valid_before:now+900,start_block:'42'};
   };
   const create=(n,order,intent=authorization(n,order))=>rpc(`commerce_create_${n.provider}_intent`,[randomUUID(),order.id,order.customer,tagFor(n),intent]);
   const proof=intent=>({chain_id:intent.chain_id,token:intent.token,recipient:intent.recipient,payer:intent.payer,
    nonce:intent.nonce,amount_units:String(intent.amount_units),tx_hash:randomHash(),log_index:1,block_number:'43',
    block_hash:randomHash(),block_timestamp:intent.valid_after+61,finalized_number:'44'});
   const settle=(n,intent,evidence)=>rpc(`commerce_finish_${n.provider}_payment`,[intent.attempt_id,tagFor(n),evidence]);
   const cancel=(n,order)=>rpc(`commerce_request_${n.provider}_cancellation`,[order.id,order.customer,'customer:'+order.customer]);
   const release=(n,intent,block=intent.start_block,timestamp=intent.valid_before+1,unused=true)=>rpc(`commerce_release_${n.provider}_intent`,[intent.attempt_id,tagFor(n),block,timestamp,unused]);

   await configure(polygon);
   const previous=await guest(polygon);
   assert.equal((await place(previous)).status,'accepted');
   const polygonIntent=await create(polygon,previous),polygonProof=proof(polygonIntent);
   assert.equal((await settle(polygon,polygonIntent,polygonProof)).state,'paid');
   const polygonRow=await attemptRow(polygonIntent.attempt_id);
   const checkoutGuards=async()=>(await db.query(`select proname,pg_get_functiondef(oid) definition,proacl::text grants from pg_proc
    where pronamespace='commerce_internal'::regnamespace and proname in ('validate_membership_checkout','place_membership_checkout') order by proname`)).rows;
   const originalGuards=await checkoutGuards();
   await db.exec(read(directUsdcNetworksMigration));
   const restoredGuards=(await checkoutGuards()).map(row=>({...row,definition:row.definition
    .replaceAll(",'base_usdc','ethereum_usdc'",'')
    .replace("method.native_provider in ('polygon_usdc') and is_goods","method.native_provider='polygon_usdc' and is_goods")}));
   assert.deepEqual(restoredGuards,originalGuards,'guest rules and validation of all existing routes differ only by the two crypto providers');
   assert.deepEqual(await attemptRow(polygonIntent.attempt_id),polygonRow);
   assert.equal((await settle(polygon,polygonIntent,polygonProof)).replayed,true);
   assert.equal((await db.query("select count(*)::int n from commerce_payment_methods where native_provider in ('base_usdc','ethereum_usdc')")).rows[0].n,0);

   for(const n of [base,ethereum])await t.test(`${n.provider} independently admits only approved goods orders and exact receipts`,async()=>{
    await assert.rejects(configure(n,{account_tag:tagFor(polygon)}),/Invalid direct USDC route/);
    await assert.rejects(configure(n,{sale_scope:'both'}),/Invalid direct USDC route/);
    await configure(n,{active:false});
    await assert.rejects(async()=>place(await guest(n)),/Payment method changed|inactive/);
    await configure(n,{version:1});
    const changedWallet='0x'+'c'.repeat(40);
    await assert.rejects(configure(n,{version:2,[n.field]:changedWallet,account_tag:tagFor(n,changedWallet)}),/different receiving wallet/);
    const order=await guest(n);
    assert.deepEqual((await db.query('select id from auth.users where id=$1',[order.customer])).rows,[]);
    assert.equal(order.pricing.crypto_discount_cents,previous.pricing.crypto_discount_cents,'crypto discount remains the same across chains');
    assert.equal((await place(order)).status,'accepted');
    const original=authorization(n,order);
    for(const unexpected of [{chain_id:polygon.chain},{token:polygon.token},{recipient:payer},{amount_units:'1'}])
     await assert.rejects(create(n,order,{...original,...unexpected}),/Invalid immutable USDC authorization/);
    const intent=await create(n,order,original),receipt=proof(intent);
    assert.equal((await create(n,order)).nonce,original.nonce);
    const sharedHash={...receipt,tx_hash:polygonProof.tx_hash};
    await assert.rejects(settle(polygon,intent,sharedHash),/does not match/);
    for(const delta of [{chain_id:polygon.chain},{token:polygon.token},{amount_units:'1'},{nonce:randomHash()},{finalized_number:'42'}])
     await assert.rejects(settle(n,intent,{...sharedHash,...delta}),/does not match/);
    assert.equal((await settle(n,intent,sharedHash)).state,'paid','the identical transaction hash is independent on a different chain');
    assert.equal((await settle(n,intent,sharedHash)).replayed,true);
    const [paid]=(await db.query('select count(*)::int n from commerce_receipts where invoice_id=$1',[order.id])).rows;
    assert.equal(paid.n,1);

    const another=await guest(n);
    assert.equal((await place(another)).status,'accepted');
    await assert.rejects(create(n,another,{...authorization(n,another),nonce:original.nonce}),/unique constraint/);
    const anotherIntent=await create(n,another);
    await assert.rejects(settle(n,anotherIntent,{...proof(anotherIntent),tx_hash:sharedHash.tx_hash}),/unique constraint/);
    const otherNetwork=n===base?ethereum:base;
    await assert.rejects(rpc(`commerce_note_${otherNetwork.provider}_submission`,[anotherIntent.attempt_id,randomHash(),tagFor(n)]),/Unknown payment authorization/);
    await assert.rejects(cancel(otherNetwork,another),/needs reconciliation/);
    assert.equal((await cancel(n,another)).cancellation_status,'pending');
    await assert.rejects(create(n,another),/Cancellation requested/);
    await assert.rejects(release(n,anotherIntent,42,anotherIntent.valid_before),/cannot safely be released/);
    await assert.rejects(release(n,anotherIntent,42,anotherIntent.valid_before+1,false),/cannot safely be released/);
    if(n===base){
     assert.equal((await release(n,anotherIntent)).status,'void');
     assert.equal((await release(n,anotherIntent)).replayed,true);
    }else{
     assert.equal((await settle(n,anotherIntent,proof(anotherIntent))).state,'review');
     assert.equal((await load(another.id)).cancellation_status,'review');
     assert.deepEqual((await db.query('select id from commerce_receipts where invoice_id=$1',[another.id])).rows,[]);
    }
    const [privileges]=(await db.query(`select
     has_function_privilege('authenticated',$1,'execute') as signed_in,
     has_function_privilege('service_role',$1,'execute') as backend,
     has_function_privilege('service_role','commerce_internal.finish_direct_usdc_payment(integer,uuid,text,jsonb)','execute') as internal`,
    [`public.commerce_finish_${n.provider}_payment(uuid,text,jsonb)`])).rows;
    assert.deepEqual(privileges,{signed_in:false,backend:true,internal:false});
   });
  });

  await t.test('Solana binds an exact finalized proof to one goods invoice and holds late payments',async()=>{
   const solana=require('../lib/solana-usdc');
   const gateway=require('../lib/solana-usdc-checkout');
   const recipient=solana.createReference();
   const config=gateway.configuration({SOLANA_USDC_RECIPIENT:recipient,SOLANA_USDC_RPC_URL:'https://primary.example.test',SOLANA_USDC_SECONDARY_RPC_URL:'https://backup.other.test'});
   const routeId=randomUUID();
   const originalGuards=(await db.query("select proname,pg_get_functiondef(oid) definition,proacl::text grants from pg_proc where pronamespace='commerce_internal'::regnamespace and proname in ('validate_membership_checkout','place_membership_checkout') order by proname")).rows;
   await db.exec(read('20261126050000_solana_usdc_checkout.sql'));
   const guards=(await db.query("select proname,pg_get_functiondef(oid) definition,proacl::text grants from pg_proc where pronamespace='commerce_internal'::regnamespace and proname in ('validate_membership_checkout','place_membership_checkout') order by proname")).rows;
   assert.deepEqual(guards.map(row=>({...row,definition:row.definition.replaceAll(",'solana_usdc'",'')})),originalGuards);
   assert.deepEqual((await db.query("select id from commerce_payment_methods where native_provider='solana_usdc'")).rows,[]);
   const settings={id:routeId,version:0,provider:'solana_usdc',mode:'live',currency:'USD',sale_scope:'goods',confirmed:true,active:true,
    account_tag:config.account_tag,solana_usdc_recipient:recipient,solana_usdc_recipient_token_account:config.recipient_token_account,
    countries:['US'],label:'Solana USDC',payee:'Fixture merchant',approval_reference:'Disposable authorization fixture'};
   const configure=changes=>rpc('commerce_configure_solana_usdc_gateway',[{...settings,...changes},'fixture-admin']);
   await assert.rejects(configure({sale_scope:'both'}),/Invalid Solana USDC route/);
   await assert.rejects(configure({solana_usdc_recipient_token_account:solana.createReference()}),/Invalid Solana USDC route/);
   await configure();
   async function makeSolanaOrder(){
    const order=await make({method:routeId,products:[catalog[0]]});
    order.request.checkout.guest=true;
    order.earned_points=0;
    assert.equal((await place(order)).status,'accepted');
    return order;
   }
   const payer=solana.createReference();
   const authorize=(order,overrides={})=>rpc('commerce_create_solana_usdc_intent',[randomUUID(),order.id,order.customer,config.account_tag,{
    genesis_hash:solana.GENESIS_HASH,token:solana.TOKEN,recipient,recipient_token_account:config.recipient_token_account,payer,
    reference:solana.createReference(),amount_units:String(order.total_cents*10000),valid_before:Math.floor(Date.now()/1000)+300,
    unsigned_transaction:'A'.repeat(416),last_valid_block_height:500,...overrides
   }]);
   const note=(intent,signature,invoiceId=intent.invoice_id)=>rpc('commerce_note_solana_usdc_submission',[intent.attempt_id,invoiceId,signature,config.account_tag]);
   const settle=(intent,evidence)=>rpc('commerce_finish_solana_usdc_payment',[intent.attempt_id,config.account_tag,evidence]);
   const cancel=order=>rpc('commerce_request_solana_usdc_cancellation',[order.id,order.customer,'customer:'+order.customer]);
   const evidence=intent=>({genesis_hash:solana.GENESIS_HASH,token:solana.TOKEN,recipient,recipient_token_account:intent.recipient_token_account,
    payer:intent.payer,payer_token_account:solana.createReference(),reference:intent.reference,amount_units:String(intent.amount_units),
    tx_signature:'2'.repeat(87),instruction_index:0,slot:420,block_hash:solana.createReference(),block_timestamp:intent.valid_after});

   const order=await makeSolanaOrder();
   await assert.rejects(authorize(order,{amount_units:'1'}),/Invalid Solana USDC authorization/);
   const intent=await authorize(order), proof=evidence(intent);
   assert.equal((await authorize(order)).reference,intent.reference);
   await assert.rejects(authorize(order,{payer:solana.createReference()}),/wallet already bound/);
   await assert.rejects(settle(intent,proof),/does not match/);
   await assert.rejects(finish(intent.attempt_id,'solana-bypass-fixture','approved',proof.tx_signature,order.total_cents,'USD'),/bound finalized Solana proof/);
   await assert.rejects(note(intent,proof.tx_signature,randomUUID()),/Unknown Solana authorization/);
   const claim=(saved,order,signature)=>rpc('commerce_claim_solana_usdc_broadcast',[saved.attempt_id,order.id,order.customer,signature,config.account_tag]);
   assert.equal((await claim(intent,order,proof.tx_signature)).state,'pending');
   assert.equal((await claim(intent,order,proof.tx_signature)).tx_signature,proof.tx_signature);
   await assert.rejects(claim(intent,order,'3'.repeat(87)),/already been submitted/);
   assert.equal((await note(intent,proof.tx_signature)).status,'submitted');
   await note(intent,'3'.repeat(87));
   await note(intent,proof.tx_signature);
   assert.equal((await db.query('select count(*)::int n from commerce_solana_usdc_submissions where attempt_id=$1',[intent.attempt_id])).rows[0].n,2);
   for(const changes of [{reference:solana.createReference()},{recipient_token_account:solana.createReference()},{amount_units:'1'},
    {block_timestamp:intent.valid_after-1},{token:solana.createReference()},{genesis_hash:solana.createReference()}])
    await assert.rejects(settle(intent,{...proof,...changes}),/does not match/);
   assert.equal((await settle(intent,proof)).state,'paid');
   assert.equal((await settle(intent,proof)).replayed,true);
   assert.equal((await db.query("select count(*)::int n from commerce_receipts where invoice_id=$1 and kind='payment'",[order.id])).rows[0].n,1);

   const another=await makeSolanaOrder();
   await assert.rejects(authorize(another,{reference:intent.reference}),/unique constraint/);
   const other=await authorize(another), otherProof=evidence(other);
   await note(other,proof.tx_signature);
   await assert.rejects(settle(other,otherProof),/unique constraint/);
   assert.equal((await cancel(another)).cancellation_status,'pending');
   await assert.rejects(claim(other,another,'3'.repeat(87)),/no longer available for Solana transfer/);
   await assert.rejects(authorize(another),/no longer payable/);
   await assert.rejects(rpc('commerce_cancel_checkout',[another.id,another.customer]),/Payment in progress/);
   const late={...otherProof,block_timestamp:other.valid_before,tx_signature:'4'.repeat(87)};
   await note(other,late.tx_signature);
   assert.equal((await settle(other,late)).state,'review');
   assert.equal((await load(another.id)).cancellation_status,'review');
   assert.deepEqual((await db.query('select id from commerce_receipts where invoice_id=$1',[another.id])).rows,[]);
   const untouched=await makeSolanaOrder();
   assert.equal((await cancel(untouched)).status,'void');
   const [acl]=(await db.query(`select has_function_privilege('authenticated','public.commerce_finish_solana_usdc_payment(uuid,text,jsonb)','execute') as customer,
    has_function_privilege('service_role','public.commerce_finish_solana_usdc_payment(uuid,text,jsonb)','execute') as backend,
    has_table_privilege('anon','public.commerce_solana_usdc_proofs','select') as browser_proofs,
    has_table_privilege('service_role','public.commerce_solana_usdc_proofs','insert') as direct_insert`)).rows;
   assert.deepEqual(acl,{customer:false,backend:true,browser_proofs:false,direct_insert:false});
  });
 }finally{await db.close();}
});
