-- Add native USDC on Base and Ethereum without seeding or enabling receiving routes.
-- Current Polygon authorizations and proofs retain their original identities.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.commerce_payment_methods
 drop constraint commerce_payment_methods_native_provider_check,
 add constraint commerce_payment_methods_native_provider_check
 check(native_provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc'));
alter table public.commerce_gateway_accounts
 drop constraint commerce_gateway_accounts_provider_check,
 add constraint commerce_gateway_accounts_provider_check
 check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc')),
 drop constraint commerce_gateway_accounts_countries_check,
 add constraint commerce_gateway_accounts_countries_check
 check(cardinality(countries) between 1 and case when provider in ('polygon_usdc','base_usdc','ethereum_usdc') then 250 else 60 end),
 add column base_usdc_recipient text,
 add constraint base_usdc_account_destination check(
  (provider<>'base_usdc' and base_usdc_recipient is null)
  or (provider='base_usdc' and mode='live' and base_usdc_recipient is not null
   and base_usdc_recipient ~ '^0x[0-9a-f]{40}$' and base_usdc_recipient<>'0x0000000000000000000000000000000000000000')
 ),
 add column ethereum_usdc_recipient text,
 add constraint ethereum_usdc_account_destination check(
  (provider<>'ethereum_usdc' and ethereum_usdc_recipient is null)
  or (provider='ethereum_usdc' and mode='live' and ethereum_usdc_recipient is not null
   and ethereum_usdc_recipient ~ '^0x[0-9a-f]{40}$' and ethereum_usdc_recipient<>'0x0000000000000000000000000000000000000000')
 );
alter table public.commerce_gateway_attempts
 drop constraint commerce_gateway_attempts_provider_check,
 add constraint commerce_gateway_attempts_provider_check
 check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc'));

-- Retain the existing global nonce and one-intent-per-invoice constraints.
-- A transaction log is unique per chain and its proof must match the intent's chain.
alter table public.commerce_polygon_usdc_intents
 drop constraint commerce_polygon_usdc_intents_chain_id_check,
 drop constraint commerce_polygon_usdc_intents_token_check,
 add constraint direct_usdc_intent_asset check(
  (chain_id=137 and token='0x3c499c542cef5e3811e1192ce70d8cc03d5c3359')
  or (chain_id=8453 and token='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
  or (chain_id=1 and token='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
 ),
 add unique(attempt_id,chain_id);
alter table public.commerce_polygon_usdc_proofs
 drop constraint commerce_polygon_usdc_proofs_chain_id_check,
 drop constraint commerce_polygon_usdc_proofs_attempt_id_fkey,
 add constraint direct_usdc_proof_intent_chain foreign key(attempt_id,chain_id)
 references public.commerce_polygon_usdc_intents(attempt_id,chain_id);

-- The only price changes are those already defined for an eligible crypto checkout.
do $patch$
declare
 definition text;
 matches integer;
 target regprocedure;
 needle text;
 replacement text;
begin
 for target,needle,replacement in
  select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
   $n$method.native_provider not in ('rampex','polygon_usdc','pure_gateway')$n$,
   $n$method.native_provider not in ('rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc')$n$
  union all
  select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
   $n$coalesce(method.native_provider,'') not in ('pure_gateway','polygon_usdc')$n$,
   $n$coalesce(method.native_provider,'') not in ('pure_gateway','polygon_usdc','base_usdc','ethereum_usdc')$n$
  union all
  select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
   $n$crypto_eligible:=method.native_provider='polygon_usdc' and is_goods$n$,
   $n$crypto_eligible:=method.native_provider in ('polygon_usdc','base_usdc','ethereum_usdc') and is_goods$n$
  union all
  select 'commerce_internal.place_membership_checkout(jsonb)'::regprocedure,
   $n$provider in ('rampex','polygon_usdc','pure_gateway') and (provider<>'rampex' or rampex_provider='hosted')$n$,
   $n$provider in ('rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc') and (provider<>'rampex' or rampex_provider='hosted')$n$
 loop
  definition:=pg_get_functiondef(target);
  matches:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
  if matches<>1 then
   raise exception 'Unexpected % definition: expected one checkout guard, found %',target,matches using errcode='P0001';
  end if;
  execute replace(definition,needle,replacement);
 end loop;
end
$patch$;

-- The public wrappers below pin the provider and chain. The underlying lifecycle
-- uses the same locks, immutable authorizations and cancellation rules on each chain.
create function commerce_internal.direct_usdc_provider(p_chain integer)
returns text language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case p_chain when 137 then 'polygon_usdc' when 8453 then 'base_usdc' when 1 then 'ethereum_usdc' end
$$;

create function commerce_internal.direct_usdc_token(p_chain integer)
returns text language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case p_chain
  when 137 then '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
  when 8453 then '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  when 1 then '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
 end
$$;

create function commerce_internal.configure_new_usdc_gateway(p_chain integer,p_data jsonb,p_actor text)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare
 mid uuid:=(p_data->>'id')::uuid;
 m public.commerce_payment_methods%rowtype;
 a public.commerce_gateway_accounts%rowtype;
 codes text[];
 country text;
 route_provider text:=commerce_internal.direct_usdc_provider(p_chain);
 network text:=case p_chain when 8453 then 'Base' when 1 then 'Ethereum' end;
 recipient text:=lower(p_data->>(route_provider||'_recipient'));
 tag text;
begin
 tag:=encode(sha256(convert_to(route_provider||':live:'||p_chain::text||':'||commerce_internal.direct_usdc_token(p_chain)||':'||recipient,'UTF8')),'hex');
 if network is null or mid is null or p_data->>'provider' is distinct from route_provider or p_data->>'mode' is distinct from 'live'
  or p_data->>'currency' is distinct from 'USD' or p_data->>'sale_scope' is distinct from 'goods'
  or jsonb_typeof(p_data->'active') is distinct from 'boolean' or jsonb_typeof(p_data->'countries') is distinct from 'array'
  or p_data->>'confirmed' is distinct from 'true' or p_data->>'account_tag' is distinct from tag
  or recipient is null or recipient !~ '^0x[0-9a-f]{40}$' or recipient='0x0000000000000000000000000000000000000000'
  or length(coalesce(p_actor,''))<8 then raise exception 'Invalid direct USDC route' using errcode='22023'; end if;
 select array_agg(value) into codes from jsonb_array_elements_text(p_data->'countries');
 if codes is null or cardinality(codes) not between 1 and 250 or cardinality(codes)<>(select count(distinct value) from unnest(codes) value) then raise exception 'Supported destinations required' using errcode='22023'; end if;
 foreach country in array codes loop if country is null or country !~ '^[A-Z]{2}$' then raise exception 'Invalid country' using errcode='22023'; end if; end loop;
 select * into m from public.commerce_payment_methods where id=mid for update;
 if found then
  if m.version is distinct from (p_data->>'version')::integer then raise exception 'Gateway changed' using errcode='40001'; end if;
  select * into a from public.commerce_gateway_accounts where method_id=mid for update;
  if m.native_provider is distinct from route_provider or m.currency is distinct from 'USD' or m.sale_scope is distinct from 'goods'
   or a.provider is distinct from route_provider or a.account_tag is distinct from tag
   or (case p_chain when 8453 then a.base_usdc_recipient when 1 then a.ethereum_usdc_recipient end) is distinct from recipient
  then raise exception 'Use a new route for a different receiving wallet' using errcode='22023'; end if;
  update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',acceptance_reference=p_data->>'approval_reference',active=(p_data->>'active')::boolean,version=version+1,updated_at=now() where id=mid;
  update public.commerce_gateway_accounts set countries=codes where method_id=mid;
 else
  if (p_data->>'version')::integer is distinct from 0 then raise exception 'Unknown gateway' using errcode='P0002'; end if;
  insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,allowed_host,acceptance_reference,active,provider_key,display_order,sale_scope,native_provider)
  values(mid,'hosted_link',p_data->>'label','USD',p_data->>'payee','Pay native USDC on '||network||' from a compatible wallet. Exact order authorization and finalized receipt are required.','getpurelabs.com',p_data->>'approval_reference',(p_data->>'active')::boolean,'custom',5,'goods',route_provider);
  insert into public.commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,base_usdc_recipient,ethereum_usdc_recipient)
  values(mid,route_provider,'live',tag,codes,case when p_chain=8453 then recipient end,case when p_chain=1 then recipient end);
 end if;
 insert into public.commerce_events(method_id,action,actor,details) values(mid,route_provider||'_gateway_configured',p_actor,jsonb_build_object('provider',route_provider,'active',p_data->'active','chain_id',p_chain,'recipient_tail',right(recipient,6)));
 return jsonb_build_object('id',mid,'saved',true);
end $$;

create function commerce_internal.create_direct_usdc_intent(p_chain integer,p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text,p_intent jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; a public.commerce_gateway_accounts%rowtype; prior public.commerce_polygon_usdc_intents%rowtype; attempt jsonb; recipient text;
 provider text:=commerce_internal.direct_usdc_provider(p_chain);
begin
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if i.cancellation_requested_at is not null then raise exception 'Cancellation requested; do not authorize payment' using errcode='P0001'; end if;
 select * into a from public.commerce_gateway_accounts where method_id=i.method_id;
 if i.currency<>'USD' or (i.kind<>'goods' and not (p_chain=137 and i.kind='membership' and i.checkout_version='checkout-2026-11-v8' and commerce_internal.valid_prepaid_membership_invoice(i.id))) or i.total_cents<1 or a.provider is distinct from provider or a.account_tag is distinct from p_account_tag
 then raise exception 'Invalid native USDC order route' using errcode='22023'; end if;
 recipient:=case p_chain when 137 then a.polygon_recipient when 8453 then a.base_usdc_recipient when 1 then a.ethereum_usdc_recipient end;
 select * into prior from public.commerce_polygon_usdc_intents where invoice_id=i.id and chain_id=p_chain order by created_at desc limit 1;
 if found then return to_jsonb(prior); end if;
 if p_intent->>'chain_id' is distinct from p_chain::text or p_intent->>'token' is distinct from commerce_internal.direct_usdc_token(p_chain)
  or p_intent->>'recipient' is distinct from recipient or (p_intent->>'amount_units')::numeric is distinct from i.total_cents::numeric*10000
  or p_intent->>'payer' is null or p_intent->>'payer' !~ '^0x[0-9a-f]{40}$' or p_intent->>'payer'='0x0000000000000000000000000000000000000000'
  or p_intent->>'nonce' is null or p_intent->>'nonce' !~ '^0x[0-9a-f]{64}$'
  or (p_intent->>'valid_after')::bigint is null or (p_intent->>'valid_after')::bigint>extract(epoch from now())
  or (p_intent->>'valid_before')::bigint is null or (p_intent->>'valid_before')::bigint<=extract(epoch from now())
  or (p_intent->>'valid_before')::bigint>extract(epoch from least(i.expires_at,now()+interval '1 hour'))
  or (p_intent->>'start_block')::bigint is null then raise exception 'Invalid immutable USDC authorization' using errcode='22023'; end if;
 attempt:=public.commerce_begin_gateway_attempt(p_id,p_invoice,p_customer,'sale',p_account_tag);
 if attempt->>'provider' is distinct from provider or attempt->>'state' is distinct from 'started' then raise exception 'Existing payment requires reconciliation' using errcode='P0001'; end if;
 insert into public.commerce_polygon_usdc_intents(attempt_id,invoice_id,account_tag,chain_id,token,recipient,payer,amount_units,nonce,valid_after,valid_before,start_block)
 values((attempt->>'id')::uuid,i.id,p_account_tag,p_chain,p_intent->>'token',recipient,p_intent->>'payer',(p_intent->>'amount_units')::numeric,p_intent->>'nonce',(p_intent->>'valid_after')::bigint,(p_intent->>'valid_before')::bigint,(p_intent->>'start_block')::bigint) returning * into prior;
 return to_jsonb(prior);
end $$;

create function commerce_internal.note_direct_usdc_submission(p_chain integer,p_id uuid,p_hash text,p_account_tag text)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare intent public.commerce_polygon_usdc_intents%rowtype;
begin
 if p_hash is not null and p_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'Invalid transaction reference' using errcode='22023'; end if;
 select * into intent from public.commerce_polygon_usdc_intents where attempt_id=p_id and chain_id=p_chain for update;
 if not found or intent.account_tag is distinct from p_account_tag then raise exception 'Unknown payment authorization' using errcode='P0002'; end if;
 if intent.status in ('paid','review','expired') then return to_jsonb(intent); end if;
 update public.commerce_polygon_usdc_intents set candidate_tx_hash=coalesce(p_hash,candidate_tx_hash),status=case when p_hash is null then status else 'submitted' end,updated_at=now() where attempt_id=p_id returning * into intent;
 return to_jsonb(intent);
end $$;

create function commerce_internal.finish_direct_usdc_payment(p_chain integer,p_id uuid,p_account_tag text,p_proof jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare intent public.commerce_polygon_usdc_intents%rowtype; i public.commerce_invoices%rowtype; attempt public.commerce_gateway_attempts%rowtype; previous public.commerce_polygon_usdc_proofs%rowtype; result jsonb;
 provider text:=commerce_internal.direct_usdc_provider(p_chain);
begin
 select invoice_id into intent.invoice_id from public.commerce_polygon_usdc_intents where attempt_id=p_id and chain_id=p_chain;
 select * into i from public.commerce_invoices where id=intent.invoice_id for update;
 select * into attempt from public.commerce_gateway_attempts where id=p_id for update;
 select * into intent from public.commerce_polygon_usdc_intents where attempt_id=p_id and chain_id=p_chain for update;
 if intent.attempt_id is null or intent.account_tag is distinct from p_account_tag or attempt.provider is distinct from provider or attempt.mode is distinct from 'live'
  or attempt.account_tag is distinct from p_account_tag or attempt.amount_cents is distinct from i.total_cents or attempt.currency is distinct from 'USD'
  or p_proof->>'chain_id' is distinct from p_chain::text or p_proof->>'token' is distinct from intent.token
  or p_proof->>'recipient' is distinct from intent.recipient or p_proof->>'payer' is distinct from intent.payer or p_proof->>'nonce' is distinct from intent.nonce
  or (p_proof->>'amount_units')::numeric is distinct from intent.amount_units
  or p_proof->>'tx_hash' is null or p_proof->>'tx_hash' !~ '^0x[0-9a-f]{64}$'
  or p_proof->>'block_hash' is null or p_proof->>'block_hash' !~ '^0x[0-9a-f]{64}$'
  or (p_proof->>'log_index')::integer is null or (p_proof->>'log_index')::integer<0
  or (p_proof->>'block_number')::bigint is null or (p_proof->>'block_number')::bigint<intent.start_block
  or (p_proof->>'finalized_number')::bigint is null or (p_proof->>'finalized_number')::bigint<(p_proof->>'block_number')::bigint
  or (p_proof->>'block_timestamp')::bigint is null or (p_proof->>'block_timestamp')::bigint<=intent.valid_after or (p_proof->>'block_timestamp')::bigint>=intent.valid_before
 then raise exception 'Finalized USDC proof does not match the saved authorization' using errcode='22023'; end if;
 select * into previous from public.commerce_polygon_usdc_proofs where attempt_id=p_id;
 if found then
  if previous.tx_hash is distinct from p_proof->>'tx_hash' or previous.log_index is distinct from (p_proof->>'log_index')::integer or previous.block_hash is distinct from p_proof->>'block_hash'
  then raise exception 'Conflicting USDC receipt' using errcode='23505'; end if;
  return jsonb_build_object('state',intent.status,'invoice_id',i.id,'replayed',true);
 end if;
 insert into public.commerce_polygon_usdc_proofs(attempt_id,chain_id,tx_hash,log_index,block_number,block_hash,block_timestamp,proof)
 values(p_id,p_chain,p_proof->>'tx_hash',(p_proof->>'log_index')::integer,(p_proof->>'block_number')::bigint,p_proof->>'block_hash',(p_proof->>'block_timestamp')::bigint,p_proof);
 if i.cancellation_requested_at is not null or i.status<>'accepted' or i.expires_at<=now() or attempt.state in ('declined','refunded','review') then
  update public.commerce_gateway_attempts set state='review',error_code='usdc_late_payment_review',updated_at=now() where id=p_id;
  update public.commerce_polygon_usdc_intents set status='review',candidate_tx_hash=p_proof->>'tx_hash',updated_at=now() where attempt_id=p_id;
  if i.cancellation_requested_at is not null then
   update public.commerce_invoices set cancellation_status='review',version=version+1,updated_at=now() where id=i.id returning * into i;
   insert into public.commerce_events(invoice_id,action,actor,details) values(i.id,'cancellation_payment_review','verified-gateway:'||provider,jsonb_build_object('attempt_id',p_id,'transaction_hash',p_proof->>'tx_hash','fulfillment_held',true));
  end if;
  return jsonb_build_object('state','review','invoice_id',i.id,'cancellation_status',i.cancellation_status);
 end if;
 result:=public.commerce_finish_gateway_attempt(p_id,replace(provider,'_','-')||'-paid:'||p_id::text,'approved',p_chain::text||':'||(p_proof->>'tx_hash')||':'||(p_proof->>'log_index'),i.total_cents,'USD',null,null);
 update public.commerce_polygon_usdc_intents set status=case when result->>'state'='paid' then 'paid' else 'review' end,candidate_tx_hash=p_proof->>'tx_hash',updated_at=now() where attempt_id=p_id;
 return result;
end $$;

create function commerce_internal.request_direct_usdc_cancellation(p_chain integer,p_id uuid,p_customer uuid,p_actor text)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; intent public.commerce_polygon_usdc_intents%rowtype; attempt public.commerce_gateway_attempts%rowtype;
 provider text:=commerce_internal.direct_usdc_provider(p_chain);
begin
 if p_id is null or p_customer is null or p_actor is null or p_actor not in ('customer:'||p_customer::text,'admin:unpaid-cancellation')
 then raise exception 'Invalid cancellation request' using errcode='22023'; end if;
 select * into i from public.commerce_invoices where id=p_id and customer_id=p_customer and checkout_version is not null for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if i.status='void' then return jsonb_build_object('id',i.id,'status','void','cancellation_status',i.cancellation_status,'already_canceled',true); end if;
 select * into intent from public.commerce_polygon_usdc_intents where invoice_id=i.id and chain_id=p_chain;
 select * into attempt from public.commerce_gateway_attempts where id=intent.attempt_id for update;
 select * into intent from public.commerce_polygon_usdc_intents where invoice_id=i.id and chain_id=p_chain for update;
 if intent.attempt_id is null or attempt.provider is distinct from provider then
  raise exception 'This payment needs reconciliation before cancellation' using errcode='P0001'; end if;
 if i.cancellation_requested_at is not null then
  return jsonb_build_object('id',i.id,'status',i.status,'cancellation_status',i.cancellation_status,'cancellation_requested_at',i.cancellation_requested_at,'authorization_expires_at',to_timestamp(intent.valid_before));
 end if;
 if i.status<>'accepted' or attempt.mode is distinct from 'live'
  or exists(select 1 from public.commerce_receipts where invoice_id=i.id and kind='payment')
  or exists(select 1 from public.commerce_gateway_attempts where invoice_id=i.id and state<>'declined' and (id<>attempt.id or state<>'started'))
  or exists(select 1 from public.commerce_polygon_usdc_proofs where attempt_id=intent.attempt_id)
 then raise exception 'This payment needs reconciliation before cancellation' using errcode='P0001'; end if;
 if intent.status='expired' and attempt.state='declined' then return public.commerce_cancel_checkout(i.id,p_customer); end if;
 if intent.status not in ('open','submitted') or attempt.state<>'started' then raise exception 'This payment needs reconciliation before cancellation' using errcode='P0001'; end if;
 update public.commerce_invoices set cancellation_requested_at=now(),cancellation_status='pending',version=version+1,updated_at=now() where id=i.id returning * into i;
 insert into public.commerce_events(invoice_id,action,actor,details) values(i.id,'cancellation_requested',p_actor,jsonb_build_object('attempt_id',intent.attempt_id,'authorization_expires_at',to_timestamp(intent.valid_before),'payment_check_pending',true));
 return jsonb_build_object('id',i.id,'status',i.status,'cancellation_status','pending','cancellation_requested_at',i.cancellation_requested_at,'authorization_expires_at',to_timestamp(intent.valid_before));
end $$;

create function commerce_internal.release_direct_usdc_intent(p_chain integer,p_id uuid,p_account_tag text,p_finalized_block bigint,p_finalized_timestamp bigint,p_nonce_unused boolean)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare intent public.commerce_polygon_usdc_intents%rowtype; i public.commerce_invoices%rowtype; attempt public.commerce_gateway_attempts%rowtype; result jsonb;
 provider text:=commerce_internal.direct_usdc_provider(p_chain);
begin
 select invoice_id into intent.invoice_id from public.commerce_polygon_usdc_intents where attempt_id=p_id and chain_id=p_chain;
 select * into i from public.commerce_invoices where id=intent.invoice_id for update;
 select * into attempt from public.commerce_gateway_attempts where id=p_id for update;
 select * into intent from public.commerce_polygon_usdc_intents where attempt_id=p_id and chain_id=p_chain for update;
 if intent.attempt_id is null or intent.account_tag is distinct from p_account_tag or p_nonce_unused is distinct from true
  or p_finalized_block is null or p_finalized_block<intent.start_block or p_finalized_timestamp is null or p_finalized_timestamp<=intent.valid_before
  or attempt.provider is distinct from provider or attempt.mode is distinct from 'live' or attempt.account_tag is distinct from p_account_tag
  or attempt.state in ('paid','refunded','review') or exists(select 1 from public.commerce_polygon_usdc_proofs where attempt_id=p_id)
 then raise exception 'Crypto payment cannot safely be released' using errcode='P0001'; end if;
 if i.status='void' and i.cancellation_status='canceled' and intent.status='expired' and attempt.state='declined' then
  return jsonb_build_object('id',i.id,'status','void','cancellation_status','canceled','confirmed_unpaid',true,'invoice_id',i.id,'replayed',true);
 end if;
 if i.status<>'accepted' then raise exception 'Crypto payment cannot safely be released' using errcode='P0001'; end if;
 perform public.commerce_finish_gateway_attempt(p_id,replace(provider,'_','-')||'-expired:'||p_id::text,'declined',null,null,null,null,'authorization_expired_unused');
 update public.commerce_polygon_usdc_intents set status='expired',updated_at=now() where attempt_id=p_id;
 if i.cancellation_requested_at is not null then
  result:=public.commerce_cancel_checkout(i.id,i.customer_id);
  return result||jsonb_build_object('cancellation_status','canceled','confirmed_unpaid',true,'invoice_id',i.id);
 end if;
 return jsonb_build_object('confirmed_unpaid',true,'invoice_id',i.id);
end $$;

create function public.commerce_configure_base_usdc_gateway(p_data jsonb,p_actor text)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.configure_new_usdc_gateway(8453,p_data,p_actor)
$$;

create function public.commerce_configure_ethereum_usdc_gateway(p_data jsonb,p_actor text)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.configure_new_usdc_gateway(1,p_data,p_actor)
$$;

create or replace function public.commerce_create_polygon_usdc_intent(p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text,p_intent jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.create_direct_usdc_intent(137,p_id,p_invoice,p_customer,p_account_tag,p_intent)
$$;

create function public.commerce_create_base_usdc_intent(p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text,p_intent jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.create_direct_usdc_intent(8453,p_id,p_invoice,p_customer,p_account_tag,p_intent)
$$;

create function public.commerce_create_ethereum_usdc_intent(p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text,p_intent jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.create_direct_usdc_intent(1,p_id,p_invoice,p_customer,p_account_tag,p_intent)
$$;

create or replace function public.commerce_note_polygon_usdc_submission(p_id uuid,p_hash text,p_account_tag text)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.note_direct_usdc_submission(137,p_id,p_hash,p_account_tag)
$$;

create function public.commerce_note_base_usdc_submission(p_id uuid,p_hash text,p_account_tag text)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.note_direct_usdc_submission(8453,p_id,p_hash,p_account_tag)
$$;

create function public.commerce_note_ethereum_usdc_submission(p_id uuid,p_hash text,p_account_tag text)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.note_direct_usdc_submission(1,p_id,p_hash,p_account_tag)
$$;

create or replace function public.commerce_finish_polygon_usdc_payment(p_id uuid,p_account_tag text,p_proof jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.finish_direct_usdc_payment(137,p_id,p_account_tag,p_proof)
$$;

create function public.commerce_finish_base_usdc_payment(p_id uuid,p_account_tag text,p_proof jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.finish_direct_usdc_payment(8453,p_id,p_account_tag,p_proof)
$$;

create function public.commerce_finish_ethereum_usdc_payment(p_id uuid,p_account_tag text,p_proof jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.finish_direct_usdc_payment(1,p_id,p_account_tag,p_proof)
$$;

create or replace function public.commerce_request_polygon_usdc_cancellation(p_id uuid,p_customer uuid,p_actor text)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.request_direct_usdc_cancellation(137,p_id,p_customer,p_actor)
$$;

create function public.commerce_request_base_usdc_cancellation(p_id uuid,p_customer uuid,p_actor text)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.request_direct_usdc_cancellation(8453,p_id,p_customer,p_actor)
$$;

create function public.commerce_request_ethereum_usdc_cancellation(p_id uuid,p_customer uuid,p_actor text)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.request_direct_usdc_cancellation(1,p_id,p_customer,p_actor)
$$;

create or replace function public.commerce_release_polygon_usdc_intent(p_id uuid,p_account_tag text,p_finalized_block bigint,p_finalized_timestamp bigint,p_nonce_unused boolean)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.release_direct_usdc_intent(137,p_id,p_account_tag,p_finalized_block,p_finalized_timestamp,p_nonce_unused)
$$;

create function public.commerce_release_base_usdc_intent(p_id uuid,p_account_tag text,p_finalized_block bigint,p_finalized_timestamp bigint,p_nonce_unused boolean)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.release_direct_usdc_intent(8453,p_id,p_account_tag,p_finalized_block,p_finalized_timestamp,p_nonce_unused)
$$;

create function public.commerce_release_ethereum_usdc_intent(p_id uuid,p_account_tag text,p_finalized_block bigint,p_finalized_timestamp bigint,p_nonce_unused boolean)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select commerce_internal.release_direct_usdc_intent(1,p_id,p_account_tag,p_finalized_block,p_finalized_timestamp,p_nonce_unused)
$$;

revoke all on function
 commerce_internal.direct_usdc_provider(integer),
 commerce_internal.direct_usdc_token(integer),
 commerce_internal.configure_new_usdc_gateway(integer,jsonb,text),
 commerce_internal.create_direct_usdc_intent(integer,uuid,uuid,uuid,text,jsonb),
 commerce_internal.note_direct_usdc_submission(integer,uuid,text,text),
 commerce_internal.finish_direct_usdc_payment(integer,uuid,text,jsonb),
 commerce_internal.request_direct_usdc_cancellation(integer,uuid,uuid,text),
 commerce_internal.release_direct_usdc_intent(integer,uuid,text,bigint,bigint,boolean)
 from public,anon,authenticated,service_role;

revoke all on function
 public.commerce_configure_base_usdc_gateway(jsonb,text),
 public.commerce_configure_ethereum_usdc_gateway(jsonb,text),
 public.commerce_create_polygon_usdc_intent(uuid,uuid,uuid,text,jsonb),
 public.commerce_create_base_usdc_intent(uuid,uuid,uuid,text,jsonb),
 public.commerce_create_ethereum_usdc_intent(uuid,uuid,uuid,text,jsonb),
 public.commerce_note_polygon_usdc_submission(uuid,text,text),
 public.commerce_note_base_usdc_submission(uuid,text,text),
 public.commerce_note_ethereum_usdc_submission(uuid,text,text),
 public.commerce_finish_polygon_usdc_payment(uuid,text,jsonb),
 public.commerce_finish_base_usdc_payment(uuid,text,jsonb),
 public.commerce_finish_ethereum_usdc_payment(uuid,text,jsonb),
 public.commerce_request_polygon_usdc_cancellation(uuid,uuid,text),
 public.commerce_request_base_usdc_cancellation(uuid,uuid,text),
 public.commerce_request_ethereum_usdc_cancellation(uuid,uuid,text),
 public.commerce_release_polygon_usdc_intent(uuid,text,bigint,bigint,boolean),
 public.commerce_release_base_usdc_intent(uuid,text,bigint,bigint,boolean),
 public.commerce_release_ethereum_usdc_intent(uuid,text,bigint,bigint,boolean)
 from public,anon,authenticated;

grant execute on function
 public.commerce_configure_base_usdc_gateway(jsonb,text),
 public.commerce_configure_ethereum_usdc_gateway(jsonb,text),
 public.commerce_create_polygon_usdc_intent(uuid,uuid,uuid,text,jsonb),
 public.commerce_create_base_usdc_intent(uuid,uuid,uuid,text,jsonb),
 public.commerce_create_ethereum_usdc_intent(uuid,uuid,uuid,text,jsonb),
 public.commerce_note_polygon_usdc_submission(uuid,text,text),
 public.commerce_note_base_usdc_submission(uuid,text,text),
 public.commerce_note_ethereum_usdc_submission(uuid,text,text),
 public.commerce_finish_polygon_usdc_payment(uuid,text,jsonb),
 public.commerce_finish_base_usdc_payment(uuid,text,jsonb),
 public.commerce_finish_ethereum_usdc_payment(uuid,text,jsonb),
 public.commerce_request_polygon_usdc_cancellation(uuid,uuid,text),
 public.commerce_request_base_usdc_cancellation(uuid,uuid,text),
 public.commerce_request_ethereum_usdc_cancellation(uuid,uuid,text),
 public.commerce_release_polygon_usdc_intent(uuid,text,bigint,bigint,boolean),
 public.commerce_release_base_usdc_intent(uuid,text,bigint,bigint,boolean),
 public.commerce_release_ethereum_usdc_intent(uuid,text,bigint,bigint,boolean)
 to service_role;

commit;
