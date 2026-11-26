-- Keep Solana receipts separate from EVM authorizations. No route is seeded.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.commerce_payment_methods
 drop constraint commerce_payment_methods_native_provider_check,
 add constraint commerce_payment_methods_native_provider_check
 check(native_provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc','solana_usdc'));
alter table public.commerce_gateway_accounts
 drop constraint commerce_gateway_accounts_provider_check,
 add constraint commerce_gateway_accounts_provider_check
 check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc','solana_usdc')),
 drop constraint commerce_gateway_accounts_countries_check,
 add constraint commerce_gateway_accounts_countries_check
 check(cardinality(countries) between 1 and case when provider in ('polygon_usdc','base_usdc','ethereum_usdc','solana_usdc') then 250 else 60 end),
 add column solana_usdc_recipient text,
 add column solana_usdc_recipient_token_account text,
 add constraint solana_usdc_account_destination check(
  (provider<>'solana_usdc' and solana_usdc_recipient is null and solana_usdc_recipient_token_account is null)
  or (provider='solana_usdc' and mode='live'
   and solana_usdc_recipient is not null and solana_usdc_recipient ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
   and solana_usdc_recipient_token_account is not null and solana_usdc_recipient_token_account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
   and solana_usdc_recipient<>solana_usdc_recipient_token_account
  )
 );
alter table public.commerce_gateway_attempts
 drop constraint commerce_gateway_attempts_provider_check,
 add constraint commerce_gateway_attempts_provider_check
 check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc','solana_usdc'));

create table public.commerce_solana_usdc_intents (
 attempt_id uuid primary key references public.commerce_gateway_attempts(id),
 invoice_id uuid unique not null references public.commerce_invoices(id),
 account_tag text not null check(account_tag ~ '^[0-9a-f]{64}$'),
 recipient text not null check(recipient ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 recipient_token_account text not null check(recipient_token_account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 payer text not null check(payer ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 reference text unique not null check(reference ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 amount_units numeric(20,0) not null check(amount_units between 1 and 18446744073709551615),
 valid_after bigint not null check(valid_after>0),
 valid_before bigint not null check(valid_before>valid_after),
 unsigned_transaction text not null check(length(unsigned_transaction)=416 and unsigned_transaction !~ '[^A-Za-z0-9+/]'),
 last_valid_block_height bigint not null check(last_valid_block_height>0),
 broadcast_signature text check(broadcast_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$' and broadcast_signature<>repeat('1',64)),
 status text not null default 'open' check(status in ('open','submitted','paid','review')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(payer<>recipient and payer<>recipient_token_account and reference<>payer and reference<>recipient and reference<>recipient_token_account)
);

-- Retain all candidate signatures. A typo or interrupted verification cannot
-- overwrite a previously recorded transfer. Only finalized proofs are unique across orders.
create table public.commerce_solana_usdc_submissions (
 attempt_id uuid not null references public.commerce_solana_usdc_intents(attempt_id),
 tx_signature text not null check(tx_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$' and tx_signature<>repeat('1',64)),
 created_at timestamptz not null default now(),
 primary key(attempt_id,tx_signature)
);

create table public.commerce_solana_usdc_proofs (
 attempt_id uuid primary key references public.commerce_solana_usdc_intents(attempt_id),
 tx_signature text unique not null check(tx_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$' and tx_signature<>repeat('1',64)),
 slot bigint not null check(slot>0),
 block_hash text not null check(block_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 block_timestamp bigint not null check(block_timestamp>0),
 instruction_index integer not null check(instruction_index between 0 and 2),
 proof jsonb not null,
 created_at timestamptz not null default now()
);

create index commerce_solana_usdc_recent_submissions on public.commerce_solana_usdc_submissions(attempt_id,created_at desc);
create index commerce_solana_usdc_pending on public.commerce_solana_usdc_intents(account_tag,updated_at) where status in ('open','submitted');

alter table public.commerce_solana_usdc_intents enable row level security;
alter table public.commerce_solana_usdc_submissions enable row level security;
alter table public.commerce_solana_usdc_proofs enable row level security;
revoke all on table public.commerce_solana_usdc_intents,public.commerce_solana_usdc_submissions,public.commerce_solana_usdc_proofs from public,anon,authenticated,service_role;
grant select on table public.commerce_solana_usdc_intents,public.commerce_solana_usdc_submissions,public.commerce_solana_usdc_proofs to service_role;

-- The shared settlement RPC may write a paid state only after a bound Solana proof.
create function commerce_internal.require_solana_payment_proof()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not exists(select 1 from public.commerce_solana_usdc_proofs where attempt_id=new.id and tx_signature=new.provider_transaction_id)
 then raise exception 'A bound finalized Solana proof is required' using errcode='22023'; end if;
 return new;
end $$;
revoke all on function commerce_internal.require_solana_payment_proof() from public,anon,authenticated,service_role;
create trigger solana_payment_proof before update of state,provider_transaction_id on public.commerce_gateway_attempts
 for each row when (new.provider='solana_usdc' and new.state='paid') execute function commerce_internal.require_solana_payment_proof();

-- Patch only the provider and USDC discount gates used by shared checkout code.
do $patch$
declare definition text; target regprocedure; needle text; replacement text;
begin
 for target,needle,replacement in
  select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
   $n$method.native_provider not in ('rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc')$n$,
   $n$method.native_provider not in ('rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc','solana_usdc')$n$
  union all
  select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
   $n$coalesce(method.native_provider,'') not in ('pure_gateway','polygon_usdc','base_usdc','ethereum_usdc')$n$,
   $n$coalesce(method.native_provider,'') not in ('pure_gateway','polygon_usdc','base_usdc','ethereum_usdc','solana_usdc')$n$
  union all
  select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
   $n$crypto_eligible:=method.native_provider in ('polygon_usdc','base_usdc','ethereum_usdc') and is_goods$n$,
   $n$crypto_eligible:=method.native_provider in ('polygon_usdc','base_usdc','ethereum_usdc','solana_usdc') and is_goods$n$
  union all
  select 'commerce_internal.place_membership_checkout(jsonb)'::regprocedure,
   $n$provider in ('rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc') and (provider<>'rampex' or rampex_provider='hosted')$n$,
   $n$provider in ('rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc','solana_usdc') and (provider<>'rampex' or rampex_provider='hosted')$n$
 loop
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
   raise exception 'Unexpected % definition: expected one checkout gate',target using errcode='P0001';
  end if;
  execute replace(definition,needle,replacement);
 end loop;
end
$patch$;

create function public.commerce_configure_solana_usdc_gateway(p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 mid uuid:=(p_data->>'id')::uuid;
 m public.commerce_payment_methods%rowtype;
 a public.commerce_gateway_accounts%rowtype;
 codes text[];
 recipient text:=p_data->>'solana_usdc_recipient';
 destination text:=p_data->>'solana_usdc_recipient_token_account';
 tag text;
begin
 tag:=encode(sha256(convert_to('solana_usdc:live:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:'||recipient||':'||destination,'UTF8')),'hex');
 if mid is null or p_data->>'provider' is distinct from 'solana_usdc' or p_data->>'mode' is distinct from 'live'
  or p_data->>'currency' is distinct from 'USD' or p_data->>'sale_scope' is distinct from 'goods'
  or p_data->>'confirmed' is distinct from 'true' or p_data->>'account_tag' is distinct from tag
  or jsonb_typeof(p_data->'active') is distinct from 'boolean' or jsonb_typeof(p_data->'countries') is distinct from 'array'
  or recipient is null or recipient !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or recipient=repeat('1',32)
  or destination is null or destination !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or destination=repeat('1',32) or destination=recipient
  or length(coalesce(p_actor,''))<8 or length(coalesce(p_data->>'label','')) not between 3 and 80
  or length(coalesce(p_data->>'payee','')) not between 2 and 180
  or length(coalesce(p_data->>'approval_reference','')) not between 8 and 400
 then raise exception 'Invalid Solana USDC route' using errcode='22023'; end if;
 select array_agg(value) into codes from jsonb_array_elements_text(p_data->'countries');
 if codes is null or cardinality(codes) not between 1 and 250
  or cardinality(codes)<>(select count(distinct value) from unnest(codes) value)
  or exists(select 1 from unnest(codes) country where country !~ '^[A-Z]{2}$')
 then raise exception 'Supported destinations required' using errcode='22023'; end if;
 select * into m from public.commerce_payment_methods where id=mid for update;
 if found then
  if m.version is distinct from (p_data->>'version')::integer then raise exception 'Gateway changed' using errcode='40001'; end if;
  select * into a from public.commerce_gateway_accounts where method_id=mid for update;
  if m.native_provider is distinct from 'solana_usdc' or m.currency is distinct from 'USD' or m.sale_scope is distinct from 'goods'
   or a.provider is distinct from 'solana_usdc' or a.account_tag is distinct from tag
   or a.solana_usdc_recipient is distinct from recipient or a.solana_usdc_recipient_token_account is distinct from destination
  then raise exception 'Use a new route for a different receiving wallet' using errcode='22023'; end if;
  update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',acceptance_reference=p_data->>'approval_reference',active=(p_data->>'active')::boolean,version=version+1,updated_at=now() where id=mid;
  update public.commerce_gateway_accounts set countries=codes where method_id=mid;
 else
  if (p_data->>'version')::integer is distinct from 0 then raise exception 'Unknown gateway' using errcode='P0002'; end if;
  insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,allowed_host,acceptance_reference,active,provider_key,display_order,sale_scope,native_provider)
  values(mid,'hosted_link',p_data->>'label','USD',p_data->>'payee','Pay native USDC on Solana from a compatible wallet using the exact amount and order reference.','getpurelabs.com',p_data->>'approval_reference',(p_data->>'active')::boolean,'custom',5,'goods','solana_usdc');
  insert into public.commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,solana_usdc_recipient,solana_usdc_recipient_token_account)
  values(mid,'solana_usdc','live',tag,codes,recipient,destination);
 end if;
 insert into public.commerce_events(method_id,action,actor,details) values(mid,'solana_usdc_gateway_configured',p_actor,jsonb_build_object('provider','solana_usdc','active',p_data->'active','recipient_tail',right(recipient,6)));
 return jsonb_build_object('id',mid,'saved',true);
end $$;

create function public.commerce_create_solana_usdc_intent(p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text,p_intent jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 i public.commerce_invoices%rowtype;
 a public.commerce_gateway_accounts%rowtype;
 prior public.commerce_solana_usdc_intents%rowtype;
 attempt jsonb;
 last_second bigint:=(p_intent->>'valid_before')::bigint;
 first_second bigint:=floor(extract(epoch from now()-interval '1 minute'))::bigint;
begin
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if i.status<>'accepted' or i.expires_at<=now() or i.cancellation_requested_at is not null then raise exception 'Order is no longer payable' using errcode='P0001'; end if;
 select * into a from public.commerce_gateway_accounts where method_id=i.method_id;
 if i.kind<>'goods' or i.currency<>'USD' or i.total_cents<1 or a.provider is distinct from 'solana_usdc'
  or a.mode is distinct from 'live' or a.account_tag is distinct from p_account_tag
 then raise exception 'Invalid Solana USDC order route' using errcode='22023'; end if;
 select * into prior from public.commerce_solana_usdc_intents where invoice_id=i.id;
 if found then
  if prior.payer is distinct from p_intent->>'payer' then raise exception 'Use the wallet already bound to this order' using errcode='P0001'; end if;
  return to_jsonb(prior);
 end if;
 if p_intent->>'genesis_hash' is distinct from '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
  or p_intent->>'token' is distinct from 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  or p_intent->>'recipient' is distinct from a.solana_usdc_recipient
  or p_intent->>'recipient_token_account' is distinct from a.solana_usdc_recipient_token_account
  or p_intent->>'amount_units' is distinct from (i.total_cents::numeric*10000)::text
  or p_intent->>'payer' is null or p_intent->>'payer' !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or p_intent->>'payer'=repeat('1',32)
  or p_intent->>'reference' is null or p_intent->>'reference' !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or p_intent->>'reference'=repeat('1',32)
  or length(coalesce(p_intent->>'unsigned_transaction',''))<>416 or p_intent->>'unsigned_transaction' ~ '[^A-Za-z0-9+/]'
  or coalesce((p_intent->>'last_valid_block_height')::bigint,0)<=0
  or last_second is null or last_second<=extract(epoch from now()) or last_second>extract(epoch from least(i.expires_at,now()+interval '1 hour'))
 then raise exception 'Invalid Solana USDC authorization' using errcode='22023'; end if;
 attempt:=public.commerce_begin_gateway_attempt(p_id,p_invoice,p_customer,'sale',p_account_tag);
 if attempt->>'provider' is distinct from 'solana_usdc' or attempt->>'state' is distinct from 'started'
  or attempt->>'id' is distinct from p_id::text or attempt->>'claimed' is distinct from 'true'
 then raise exception 'Existing payment requires reconciliation' using errcode='P0001'; end if;
 insert into public.commerce_solana_usdc_intents(attempt_id,invoice_id,account_tag,recipient,recipient_token_account,payer,reference,amount_units,valid_after,valid_before,unsigned_transaction,last_valid_block_height)
 values(p_id,i.id,p_account_tag,a.solana_usdc_recipient,a.solana_usdc_recipient_token_account,p_intent->>'payer',p_intent->>'reference',i.total_cents::numeric*10000,first_second,last_second,
  p_intent->>'unsigned_transaction',(p_intent->>'last_valid_block_height')::bigint)
 returning * into prior;
 return to_jsonb(prior);
end $$;

create function public.commerce_note_solana_usdc_submission(p_id uuid,p_invoice uuid,p_signature text,p_account_tag text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare intent public.commerce_solana_usdc_intents%rowtype;
begin
 if p_signature is null or p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$' or p_signature=repeat('1',64)
 then raise exception 'Invalid Solana transaction signature' using errcode='22023'; end if;
 select * into intent from public.commerce_solana_usdc_intents where attempt_id=p_id and invoice_id=p_invoice for update;
 if not found or intent.account_tag is distinct from p_account_tag then raise exception 'Unknown Solana authorization' using errcode='P0002'; end if;
 if exists(select 1 from public.commerce_solana_usdc_submissions where attempt_id=p_id and tx_signature=p_signature) then return to_jsonb(intent); end if;
 insert into public.commerce_solana_usdc_submissions(attempt_id,tx_signature) values(p_id,p_signature);
 update public.commerce_solana_usdc_intents set status=case when status='open' then 'submitted' else status end,updated_at=now()
 where attempt_id=p_id returning * into intent;
 return to_jsonb(intent);
end $$;

create function public.commerce_claim_solana_usdc_broadcast(p_id uuid,p_invoice uuid,p_customer uuid,p_signature text,p_account_tag text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; intent public.commerce_solana_usdc_intents%rowtype;
begin
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 select * into intent from public.commerce_solana_usdc_intents where attempt_id=p_id and invoice_id=i.id for update;
 if not found or intent.account_tag is distinct from p_account_tag then raise exception 'Unknown Solana authorization' using errcode='P0002'; end if;
 if i.status<>'accepted' or i.expires_at<=now() or i.cancellation_requested_at is not null
  or intent.valid_before<=extract(epoch from now()) or intent.status not in ('open','submitted')
  or not exists(select 1 from public.commerce_gateway_attempts where id=p_id and state='started')
  or not exists(select 1 from public.commerce_payment_methods where id=i.method_id and native_provider='solana_usdc' and active)
 then raise exception 'Order is no longer available for Solana transfer' using errcode='P0001'; end if;
 if intent.broadcast_signature is not null and intent.broadcast_signature is distinct from p_signature then
  raise exception 'The authorized transaction has already been submitted' using errcode='P0001';
 end if;
 perform public.commerce_note_solana_usdc_submission(p_id,i.id,p_signature,p_account_tag);
 update public.commerce_solana_usdc_intents set broadcast_signature=p_signature where attempt_id=p_id;
 return jsonb_build_object('state','pending','invoice_id',i.id,'tx_signature',p_signature);
end $$;

create function public.commerce_touch_solana_usdc_intent(p_id uuid,p_account_tag text)
returns void language sql security definer set search_path=pg_catalog,pg_temp as $$
 update public.commerce_solana_usdc_intents set updated_at=now() where attempt_id=p_id and account_tag=p_account_tag and status in ('open','submitted');
$$;

create function public.commerce_finish_solana_usdc_payment(p_id uuid,p_account_tag text,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 order_id uuid;
 i public.commerce_invoices%rowtype;
 attempt public.commerce_gateway_attempts%rowtype;
 intent public.commerce_solana_usdc_intents%rowtype;
 prior public.commerce_solana_usdc_proofs%rowtype;
 signature text:=p_proof->>'tx_signature';
 block_time bigint:=(p_proof->>'block_timestamp')::bigint;
 result jsonb;
begin
 select invoice_id into order_id from public.commerce_solana_usdc_intents where attempt_id=p_id;
 select * into i from public.commerce_invoices where id=order_id for update;
 select * into attempt from public.commerce_gateway_attempts where id=p_id for update;
 select * into intent from public.commerce_solana_usdc_intents where attempt_id=p_id for update;
 if intent.attempt_id is null or intent.account_tag is distinct from p_account_tag or attempt.account_tag is distinct from p_account_tag
  or attempt.provider is distinct from 'solana_usdc' or attempt.mode is distinct from 'live' or attempt.operation is distinct from 'sale'
  or attempt.amount_cents is distinct from i.total_cents or attempt.currency is distinct from 'USD' or i.currency is distinct from 'USD'
  or p_proof->>'genesis_hash' is distinct from '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
  or p_proof->>'token' is distinct from 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  or p_proof->>'recipient' is distinct from intent.recipient or p_proof->>'recipient_token_account' is distinct from intent.recipient_token_account
  or p_proof->>'payer' is distinct from intent.payer or p_proof->>'reference' is distinct from intent.reference
  or p_proof->>'amount_units' is distinct from intent.amount_units::text
  or p_proof->>'payer_token_account' is null or p_proof->>'payer_token_account' !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  or block_time is null or block_time<intent.valid_after
  or not exists(select 1 from public.commerce_solana_usdc_submissions where attempt_id=p_id and tx_signature=signature)
 then raise exception 'Finalized Solana proof does not match the saved authorization' using errcode='22023'; end if;
 select * into prior from public.commerce_solana_usdc_proofs where attempt_id=p_id;
 if found then
  if prior.proof is distinct from p_proof then raise exception 'Conflicting Solana receipt' using errcode='23505'; end if;
  return jsonb_build_object('state',intent.status,'invoice_id',i.id,'replayed',true);
 end if;
 insert into public.commerce_solana_usdc_proofs(attempt_id,tx_signature,slot,block_hash,block_timestamp,instruction_index,proof)
 values(p_id,signature,(p_proof->>'slot')::bigint,p_proof->>'block_hash',block_time,(p_proof->>'instruction_index')::integer,p_proof);
 if i.cancellation_requested_at is not null or i.status<>'accepted' or i.expires_at<=now() or block_time>=intent.valid_before or attempt.state<>'started' then
  update public.commerce_gateway_attempts set state='review',error_code='solana_usdc_payment_review',updated_at=now() where id=p_id;
  update public.commerce_solana_usdc_intents set status='review',updated_at=now() where attempt_id=p_id;
  if i.cancellation_requested_at is not null then
   update public.commerce_invoices set cancellation_status='review',version=version+1,updated_at=now() where id=i.id returning * into i;
  end if;
  insert into public.commerce_events(invoice_id,action,actor,details) values(i.id,'solana_usdc_payment_review','verified-gateway:solana_usdc',jsonb_build_object('attempt_id',p_id,'transaction_signature',signature,'fulfillment_held',true));
  return jsonb_build_object('state','review','invoice_id',i.id,'cancellation_status',i.cancellation_status);
 end if;
 result:=public.commerce_finish_gateway_attempt(p_id,'solana-usdc-paid:'||p_id::text,'approved',signature,i.total_cents,'USD',null,null);
 update public.commerce_solana_usdc_intents set status=case when result->>'state'='paid' then 'paid' else 'review' end,updated_at=now() where attempt_id=p_id;
 return result;
end $$;

create function public.commerce_request_solana_usdc_cancellation(p_id uuid,p_customer uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; intent public.commerce_solana_usdc_intents%rowtype;
begin
 if p_id is null or p_customer is null or p_actor is null or p_actor not in ('customer:'||p_customer::text,'admin:unpaid-cancellation')
 then raise exception 'Invalid cancellation request' using errcode='22023'; end if;
 select * into i from public.commerce_invoices where id=p_id and customer_id=p_customer and checkout_version is not null for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if i.status='void' then return jsonb_build_object('id',i.id,'status','void','already_canceled',true); end if;
 if not exists(select 1 from public.commerce_gateway_accounts where method_id=i.method_id and provider='solana_usdc')
 then raise exception 'Invalid Solana order route' using errcode='22023'; end if;
 select * into intent from public.commerce_solana_usdc_intents where invoice_id=i.id;
 if not found then return public.commerce_cancel_checkout(i.id,p_customer); end if;
 if i.cancellation_requested_at is null then
  if i.status<>'accepted' or intent.status not in ('open','submitted')
   or exists(select 1 from public.commerce_receipts where invoice_id=i.id and kind='payment')
   or not exists(select 1 from public.commerce_gateway_attempts where id=intent.attempt_id and provider='solana_usdc' and mode='live' and state='started')
  then raise exception 'This payment requires review before cancellation' using errcode='P0001'; end if;
  -- A plain SPL transfer does not expire with the invoice. Hold the order for review.
  update public.commerce_invoices set cancellation_requested_at=now(),cancellation_status='pending',version=version+1,updated_at=now() where id=i.id returning * into i;
  insert into public.commerce_events(invoice_id,action,actor,details) values(i.id,'cancellation_requested',p_actor,jsonb_build_object('attempt_id',intent.attempt_id,'payment_check_pending',true));
 end if;
 return jsonb_build_object('id',i.id,'status',i.status,'cancellation_status',i.cancellation_status,'cancellation_requested_at',i.cancellation_requested_at);
end $$;

revoke all on function public.commerce_configure_solana_usdc_gateway(jsonb,text),
 public.commerce_create_solana_usdc_intent(uuid,uuid,uuid,text,jsonb),
 public.commerce_note_solana_usdc_submission(uuid,uuid,text,text),public.commerce_finish_solana_usdc_payment(uuid,text,jsonb),
 public.commerce_claim_solana_usdc_broadcast(uuid,uuid,uuid,text,text),public.commerce_touch_solana_usdc_intent(uuid,text),
 public.commerce_request_solana_usdc_cancellation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.commerce_configure_solana_usdc_gateway(jsonb,text),
 public.commerce_create_solana_usdc_intent(uuid,uuid,uuid,text,jsonb),
 public.commerce_note_solana_usdc_submission(uuid,uuid,text,text),public.commerce_finish_solana_usdc_payment(uuid,text,jsonb),
 public.commerce_claim_solana_usdc_broadcast(uuid,uuid,uuid,text,text),public.commerce_touch_solana_usdc_intent(uuid,text),
 public.commerce_request_solana_usdc_cancellation(uuid,uuid,text) to service_role;

commit;
