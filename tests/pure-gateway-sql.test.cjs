'use strict';
// Disposable PostgreSQL only (PGlite). No production credentials, provider calls or remote DDL.
// Applies the real migration chain up to the newest checkout validators, then the pure_gateway card route.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json'),delivery=require('../lib/delivery-options');
const gw=require('../lib/pure-gateway');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
const migration='20261125000100_pure_gateway_card_route.sql';
const cardTestMigration='20261125223346_one_use_card_test_coupon.sql';
const reversalMigration='20261126011403_verified_pure_gateway_reversals.sql';
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
 }finally{await db.close();}
});
