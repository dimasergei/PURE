-- Disabled by default. Adds no receiving account and never submits a transaction.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.commerce_payment_methods
 drop constraint commerce_payment_methods_native_provider_check,
 add constraint commerce_payment_methods_native_provider_check
 check(native_provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc','ethereum_eth'));
alter table public.commerce_gateway_accounts
 drop constraint commerce_gateway_accounts_provider_check,
 add constraint commerce_gateway_accounts_provider_check
 check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc','ethereum_eth'));
alter table public.commerce_gateway_attempts
 drop constraint commerce_gateway_attempts_provider_check,
 add constraint commerce_gateway_attempts_provider_check
 check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway','base_usdc','ethereum_usdc','ethereum_eth'));

create table public.commerce_native_eth_quotes(
 id uuid primary key,
 invoice_id uuid not null references public.commerce_invoices(id),
 attempt_id uuid not null references public.commerce_gateway_attempts(id),
 chain_id integer not null default 1 check(chain_id=1),
 account_tag text not null check(account_tag ~ '^[0-9a-f]{64}$'),
 usd_cents integer not null check(usd_cents between 1 and 100000000),
 recipient text not null check(recipient ~ '^0x[0-9a-f]{40}$'),
 payer text not null check(payer ~ '^0x[0-9a-f]{40}$' and payer<>recipient),
 reference text not null unique check(reference ~ '^0x[0-9a-f]{64}$'),
 amount_wei text not null check(amount_wei ~ '^[1-9][0-9]{0,77}$'),
 rate_micro_usd text not null check(rate_micro_usd ~ '^[1-9][0-9]{0,12}$'),
 rate_sources jsonb not null,
 start_block bigint not null check(start_block>0),
 start_block_hash text not null check(start_block_hash ~ '^0x[0-9a-f]{64}$'),
 start_block_timestamp bigint not null check(start_block_timestamp>0),
 valid_after bigint not null,
 valid_before bigint not null,
 status text not null default 'open' check(status in ('open','submitted','expired','paid','review')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(start_block_timestamp<=valid_after and valid_before-valid_after between 15 and 300)
);
create unique index native_eth_one_live_quote on public.commerce_native_eth_quotes(invoice_id)
 where status in ('open','submitted');
create index native_eth_invoice_quotes on public.commerce_native_eth_quotes(invoice_id,created_at desc);
create index native_eth_quote_discovery on public.commerce_native_eth_quotes(recipient,start_block);

-- Submission hints remain distinct from the wallet reference and proof.
create table public.commerce_native_eth_submissions(
 quote_id uuid not null references public.commerce_native_eth_quotes(id),
 tx_hash text not null check(tx_hash ~ '^0x[0-9a-f]{64}$'),
 submitted_at timestamptz not null default now(),
 primary key(quote_id,tx_hash)
);
create table public.commerce_native_eth_proofs(
 chain_id integer not null check(chain_id=1),
 tx_hash text not null check(tx_hash ~ '^0x[0-9a-f]{64}$'),
 quote_id uuid not null references public.commerce_native_eth_quotes(id),
 attempt_id uuid not null references public.commerce_gateway_attempts(id),
 block_number bigint not null check(block_number>0),
 block_hash text not null check(block_hash ~ '^0x[0-9a-f]{64}$'),
 block_timestamp bigint not null check(block_timestamp>0),
 transaction_index integer not null check(transaction_index>=0),
 finalized_number bigint not null check(finalized_number>=block_number),
 result text not null check(result in ('paid','review')),
 review_reason text,
 verified_at timestamptz not null default now(),
 primary key(chain_id,tx_hash),
 check((result='review')=(review_reason is not null))
);
create unique index native_eth_one_applied_transfer on public.commerce_native_eth_proofs(attempt_id) where result='paid';
create index native_eth_quote_proofs on public.commerce_native_eth_proofs(quote_id);

alter table public.commerce_native_eth_quotes enable row level security;
alter table public.commerce_native_eth_submissions enable row level security;
alter table public.commerce_native_eth_proofs enable row level security;
revoke all on public.commerce_native_eth_quotes,public.commerce_native_eth_submissions,public.commerce_native_eth_proofs
 from public,anon,authenticated,service_role;
grant select on public.commerce_native_eth_quotes,public.commerce_native_eth_submissions,public.commerce_native_eth_proofs to service_role;

create function commerce_internal.native_eth_quote_json(q public.commerce_native_eth_quotes)
returns jsonb language sql set search_path=pg_catalog,pg_temp as $$
 select to_jsonb(q)||jsonb_build_object(
  'start_block',q.start_block::text,
  'status',case when q.status in ('open','submitted') and q.valid_before<=extract(epoch from clock_timestamp())
   then 'expired' else q.status end
 )
$$;

create function public.commerce_create_native_eth_quote(p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text,p_quote jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 i public.commerce_invoices%rowtype;
 a public.commerce_gateway_accounts%rowtype;
 m public.commerce_payment_methods%rowtype;
 prior public.commerce_native_eth_quotes%rowtype;
 attempt jsonb;
 payer text:=p_quote->>'payer';
 recipient text:=p_quote->>'recipient';
 reference text:=p_quote->>'reference';
 amount text:=p_quote->>'amount_wei';
 rate numeric;
 coinbase numeric;
 kraken numeric;
 clock_seconds bigint;
 coinbase_observed bigint;
 kraken_observed bigint;
 quote_after bigint;
 quote_before bigint;
 anchor_block bigint;
 anchor_seconds bigint;
begin
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 select * into m from public.commerce_payment_methods where id=i.method_id for share;
 select * into a from public.commerce_gateway_accounts where method_id=i.method_id for share;
 if p_id is null or i.currency<>'USD' or i.kind<>'goods' or i.total_cents not between 1 and 100000000
  or m.native_provider is distinct from 'ethereum_eth' or m.currency is distinct from 'USD' or m.sale_scope is distinct from 'goods'
  or m.active is distinct from true or a.provider is distinct from 'ethereum_eth' or a.mode is distinct from 'live'
  or p_account_tag is null or a.account_tag is distinct from p_account_tag
  or not coalesce((i.request_data->'address'->>'country')=any(a.countries),false)
 then raise exception 'Native ETH route is unavailable for this order' using errcode='22023'; end if;
 if i.status<>'accepted' or i.expires_at is null or i.expires_at<=clock_timestamp() or i.cancellation_requested_at is not null
  or exists(select 1 from public.commerce_receipts where invoice_id=i.id and kind='payment')
 then raise exception 'Order is not payable' using errcode='P0001'; end if;
 if coalesce(recipient,'') !~ '^0x[0-9a-f]{40}$' or recipient='0x0000000000000000000000000000000000000000'
  or encode(sha256(convert_to('ethereum_eth:live:1:'||recipient,'UTF8')),'hex') is distinct from p_account_tag
  or coalesce(payer,'') !~ '^0x[0-9a-f]{40}$' or payer in (recipient,'0x0000000000000000000000000000000000000000')
 then raise exception 'Invalid native ETH wallet' using errcode='22023'; end if;
 select * into prior from public.commerce_native_eth_quotes where id=p_id;
 if found and (prior.invoice_id<>i.id or prior.account_tag<>p_account_tag or prior.payer<>payer)
 then raise exception 'Native ETH quote ID conflict' using errcode='23505'; end if;
 if exists(select 1 from public.commerce_gateway_attempts where invoice_id=i.id and operation='sale' and state not in ('started','declined'))
 then raise exception 'Existing payment requires reconciliation' using errcode='P0001'; end if;
 if prior.id is not null then return commerce_internal.native_eth_quote_json(prior); end if;

 clock_seconds:=floor(extract(epoch from clock_timestamp()));
 update public.commerce_native_eth_quotes set status='expired',updated_at=now()
 where invoice_id=i.id and status in ('open','submitted') and valid_before<=clock_seconds;
 select * into prior from public.commerce_native_eth_quotes where invoice_id=i.id and status in ('open','submitted');
 if found then
  if prior.payer<>payer then raise exception 'Wait for the quote to expire before changing wallets' using errcode='P0001'; end if;
  return commerce_internal.native_eth_quote_json(prior);
 end if;

 if jsonb_typeof(p_quote) is distinct from 'object' or coalesce(reference,'') !~ '^0x[0-9a-f]{64}$'
  or coalesce(amount,'') !~ '^[1-9][0-9]{0,77}$'
  or coalesce(p_quote->>'rate_micro_usd','') !~ '^[1-9][0-9]{0,12}$'
  or coalesce(p_quote#>>'{rate_sources,coinbase,rate_micro_usd}','') !~ '^[1-9][0-9]{0,12}$'
  or coalesce(p_quote#>>'{rate_sources,kraken,rate_micro_usd}','') !~ '^[1-9][0-9]{0,12}$'
  or coalesce(p_quote#>>'{rate_sources,coinbase,observed_at}','') !~ '^[1-9][0-9]{0,12}$'
  or coalesce(p_quote#>>'{rate_sources,kraken,observed_at}','') !~ '^[1-9][0-9]{0,12}$'
  or coalesce(p_quote->>'valid_after','') !~ '^[1-9][0-9]{0,12}$'
  or coalesce(p_quote->>'valid_before','') !~ '^[1-9][0-9]{0,12}$'
  or coalesce(p_quote->>'start_block','') !~ '^[1-9][0-9]{0,15}$'
  or coalesce(p_quote->>'start_block_hash','') !~ '^0x[0-9a-f]{64}$'
  or coalesce(p_quote->>'start_block_timestamp','') !~ '^[1-9][0-9]{0,12}$'
 then raise exception 'Invalid native ETH quote' using errcode='22023'; end if;
 rate:=(p_quote->>'rate_micro_usd')::numeric;
 coinbase:=(p_quote#>>'{rate_sources,coinbase,rate_micro_usd}')::numeric;
 kraken:=(p_quote#>>'{rate_sources,kraken,rate_micro_usd}')::numeric;
 coinbase_observed:=(p_quote#>>'{rate_sources,coinbase,observed_at}')::bigint;
 kraken_observed:=(p_quote#>>'{rate_sources,kraken,observed_at}')::bigint;
 quote_after:=(p_quote->>'valid_after')::bigint;
 quote_before:=(p_quote->>'valid_before')::bigint;
 anchor_block:=(p_quote->>'start_block')::bigint;
 anchor_seconds:=(p_quote->>'start_block_timestamp')::bigint;
 if least(coinbase,kraken)<1000000 or greatest(coinbase,kraken)>1000000000000
  or abs(coinbase-kraken)*10000>least(coinbase,kraken)*75 or rate<>div(coinbase+kraken,2)
  or coinbase_observed not between clock_seconds-30 and clock_seconds+2
  or kraken_observed not between clock_seconds-30 and clock_seconds+2
  or amount::numeric<>div(i.total_cents::numeric*10000000000000000000000+rate-1,rate)
  or quote_after not between clock_seconds-15 and clock_seconds
  or quote_before<clock_seconds+15 or quote_before-quote_after>300 or quote_before>extract(epoch from i.expires_at)
  or anchor_seconds not between clock_seconds-3600 and quote_after
 then raise exception 'Native ETH quote data is stale or inconsistent' using errcode='22023'; end if;

 attempt:=public.commerce_begin_gateway_attempt(p_id,i.id,p_customer,'sale',p_account_tag);
 if attempt->>'provider' is distinct from 'ethereum_eth' or attempt->>'state' is distinct from 'started'
  or attempt->>'mode' is distinct from 'live' or attempt->>'account_tag' is distinct from p_account_tag
  or attempt->>'currency' is distinct from 'USD' or (attempt->>'amount_cents')::integer is distinct from i.total_cents
 then raise exception 'Existing payment requires reconciliation' using errcode='P0001'; end if;
 insert into public.commerce_native_eth_quotes(
  id,invoice_id,attempt_id,account_tag,usd_cents,recipient,payer,reference,amount_wei,rate_micro_usd,rate_sources,
  start_block,start_block_hash,start_block_timestamp,valid_after,valid_before
 ) values(
  p_id,i.id,(attempt->>'id')::uuid,p_account_tag,i.total_cents,recipient,payer,reference,amount,rate::text,p_quote->'rate_sources',
  anchor_block,p_quote->>'start_block_hash',anchor_seconds,quote_after,quote_before
 ) returning * into prior;
 return commerce_internal.native_eth_quote_json(prior);
end $$;

create function public.commerce_note_native_eth_submission(p_id uuid,p_invoice uuid,p_customer uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare q public.commerce_native_eth_quotes%rowtype;
begin
 if coalesce(p_hash,'') !~ '^0x[0-9a-f]{64}$' then raise exception 'Invalid Ethereum transaction hash' using errcode='22023'; end if;
 perform 1 from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 select * into q from public.commerce_native_eth_quotes where id=p_id and invoice_id=p_invoice for update;
 if not found then raise exception 'Native ETH quote not found' using errcode='P0002'; end if;
 if not exists(select 1 from public.commerce_native_eth_submissions where quote_id=q.id and tx_hash=p_hash) then
  if (select count(*) from public.commerce_native_eth_submissions where quote_id=q.id)>=12
  then raise exception 'Native ETH submission limit reached' using errcode='P0001'; end if;
  insert into public.commerce_native_eth_submissions(quote_id,tx_hash) values(q.id,p_hash);
 end if;
 if q.status='open' and q.valid_before>extract(epoch from now()) then
  update public.commerce_native_eth_quotes set status='submitted',updated_at=now() where id=q.id returning * into q;
 end if;
 return commerce_internal.native_eth_quote_json(q);
end $$;

-- Keep shared gateway and receipt behavior. Native ETH approvals depend on a
-- finalized proof staged in the same transaction by the RPC below.
create function commerce_internal.guard_native_eth_gateway_payment()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if new.state='paid' and old.state is distinct from 'paid' and not exists(
  select 1 from public.commerce_native_eth_proofs
  where attempt_id=new.id and result='paid' and '1:'||tx_hash=new.provider_transaction_id
 ) then raise exception 'Finalized native ETH payment proof required' using errcode='22023'; end if;
 if new.state='declined' and old.state is distinct from 'declined' and exists(
  select 1 from public.commerce_native_eth_quotes where attempt_id=new.id
 ) then raise exception 'Reconcile the native ETH quote before closing the attempt' using errcode='P0001'; end if;
 return new;
end $$;
create trigger gateway_native_eth_proof_guard before update of state on public.commerce_gateway_attempts
 for each row when (new.provider='ethereum_eth') execute function commerce_internal.guard_native_eth_gateway_payment();

create function commerce_internal.guard_native_eth_receipt()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from public.commerce_payment_methods where id=new.method_id and native_provider='ethereum_eth')
  and not exists(
   select 1 from public.commerce_native_eth_proofs p
   join public.commerce_native_eth_quotes q on q.id=p.quote_id
   where p.attempt_id=new.id and q.invoice_id=new.invoice_id and p.result='paid'
    and q.usd_cents=new.amount_cents and new.currency='USD'
    and new.external_reference='ethereum_eth:sale:1:'||p.tx_hash
    and new.actor='verified-gateway:ethereum_eth'
  )
 then raise exception 'Finalized native ETH payment proof required' using errcode='22023'; end if;
 return new;
end $$;
create trigger receipt_native_eth_proof_guard before insert on public.commerce_receipts
 for each row when (new.kind='payment') execute function commerce_internal.guard_native_eth_receipt();

create function public.commerce_finish_native_eth_payment(p_id uuid,p_account_tag text,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 q public.commerce_native_eth_quotes%rowtype;
 i public.commerce_invoices%rowtype;
 a public.commerce_gateway_attempts%rowtype;
 existing public.commerce_native_eth_proofs%rowtype;
 block_number bigint;
 block_timestamp bigint;
 finalized_number bigint;
 transaction_index integer;
 tx_hash text:=p_proof->>'tx_hash';
 block_hash text:=p_proof->>'block_hash';
 review_reason text;
 gateway_result jsonb;
begin
 select * into q from public.commerce_native_eth_quotes where id=p_id;
 if not found then raise exception 'Native ETH quote not found' using errcode='P0002'; end if;
 select * into i from public.commerce_invoices where id=q.invoice_id for update;
 select * into a from public.commerce_gateway_attempts where id=q.attempt_id for update;
 select * into q from public.commerce_native_eth_quotes where id=p_id for update;
 if p_account_tag is null or q.account_tag is distinct from p_account_tag or a.account_tag is distinct from p_account_tag
  or a.provider is distinct from 'ethereum_eth' or a.mode is distinct from 'live' or a.operation is distinct from 'sale'
  or a.currency is distinct from 'USD' or a.invoice_id is distinct from i.id or a.amount_cents is distinct from q.usd_cents
  or p_proof->>'chain_id' is distinct from '1' or p_proof->>'payer' is distinct from q.payer
  or p_proof->>'recipient' is distinct from q.recipient or p_proof->>'reference' is distinct from q.reference
  or p_proof->>'amount_wei' is distinct from q.amount_wei
  or coalesce(tx_hash,'') !~ '^0x[0-9a-f]{64}$' or coalesce(block_hash,'') !~ '^0x[0-9a-f]{64}$'
  or coalesce(p_proof->>'block_number','') !~ '^[1-9][0-9]{0,15}$'
  or coalesce(p_proof->>'block_timestamp','') !~ '^[1-9][0-9]{0,12}$'
  or coalesce(p_proof->>'finalized_number','') !~ '^[1-9][0-9]{0,15}$'
  or coalesce(p_proof->>'transaction_index','') !~ '^(0|[1-9][0-9]{0,8})$'
  or jsonb_typeof(p_proof->'recipient_has_code') is distinct from 'boolean'
 then raise exception 'Finalized ETH proof does not match the saved quote' using errcode='22023'; end if;
 block_number:=(p_proof->>'block_number')::bigint;
 block_timestamp:=(p_proof->>'block_timestamp')::bigint;
 finalized_number:=(p_proof->>'finalized_number')::bigint;
 transaction_index:=(p_proof->>'transaction_index')::integer;
 if finalized_number<block_number or block_timestamp>extract(epoch from clock_timestamp())+2
  or (block_number=q.start_block and (block_hash<>q.start_block_hash or block_timestamp<>q.start_block_timestamp))
 then raise exception 'Invalid Ethereum canonical proof' using errcode='22023'; end if;

 if exists(select 1 from public.commerce_native_eth_proofs where attempt_id=a.id and result='paid')
  or exists(select 1 from public.commerce_receipts where invoice_id=i.id and kind='payment')
  or a.state in ('paid','refunded') or i.status in ('paid','processing','shipped','delivered','refunded')
 then review_reason:='additional_transfer';
 elsif i.cancellation_requested_at is not null then review_reason:='cancellation_requested';
 elsif block_number<q.start_block or block_timestamp<q.valid_after or block_timestamp>=q.valid_before
 then review_reason:='outside_quote_window';
 elsif (p_proof->>'recipient_has_code')::boolean then review_reason:='recipient_code_present';
 elsif i.status<>'accepted' or i.expires_at is null or i.expires_at<=clock_timestamp() or i.total_cents<>q.usd_cents
  or i.currency<>'USD' or i.kind<>'goods' or i.method_id is distinct from a.method_id or a.state<>'started'
 then review_reason:='invoice_reconciliation_required';
 end if;

 insert into public.commerce_native_eth_proofs(
  chain_id,tx_hash,quote_id,attempt_id,block_number,block_hash,block_timestamp,transaction_index,finalized_number,result,review_reason
 ) values(
  1,tx_hash,q.id,a.id,block_number,block_hash,block_timestamp,transaction_index,finalized_number,
  case when review_reason is null then 'paid' else 'review' end,review_reason
 )
 on conflict on constraint commerce_native_eth_proofs_pkey do nothing returning * into existing;
 if not found then
  select * into existing from public.commerce_native_eth_proofs p where p.chain_id=1 and p.tx_hash=p_proof->>'tx_hash';
  if existing.quote_id is distinct from q.id or existing.block_hash<>block_hash or existing.block_number<>block_number
   or existing.block_timestamp<>block_timestamp or existing.transaction_index<>transaction_index
  then raise exception 'Conflicting native ETH receipt' using errcode='23505'; end if;
  return jsonb_build_object('state',existing.result,'invoice_id',i.id,'quote_id',q.id,
   'review_reason',existing.review_reason,'replayed',true);
 end if;

 if review_reason is null then
  gateway_result:=public.commerce_finish_gateway_attempt(a.id,'native-eth-paid:'||a.id::text,'approved','1:'||tx_hash,q.usd_cents,'USD',null,null);
  if gateway_result->>'state' is distinct from 'paid' then
   review_reason:='invoice_reconciliation_required';
   update public.commerce_native_eth_proofs p set result='review',review_reason='invoice_reconciliation_required'
   where p.chain_id=1 and p.tx_hash=p_proof->>'tx_hash';
  end if;
 end if;
 if review_reason is null then
  update public.commerce_native_eth_quotes set status=case when id=q.id then 'paid' else 'expired' end,updated_at=now()
  where attempt_id=a.id and (id=q.id or status in ('open','submitted'));
 else
  update public.commerce_native_eth_quotes set status='review',updated_at=now() where id=q.id and status<>'paid';
  if a.state not in ('paid','refunded') then
   update public.commerce_gateway_attempts set state='review',error_code='native_eth_receipt_review',updated_at=now() where id=a.id;
  end if;
  if i.cancellation_status='pending' and i.status='accepted' then
   update public.commerce_invoices set cancellation_status='review',version=version+1,updated_at=now() where id=i.id;
  end if;
  insert into public.commerce_events(invoice_id,action,actor,details)
  values(i.id,case when i.cancellation_requested_at is null then 'native_eth_receipt_review' else 'cancellation_payment_review' end,
    'verified-gateway:ethereum_eth',jsonb_build_object('quote_id',q.id,'attempt_id',a.id,'transaction_hash',tx_hash,'reason',review_reason));
 end if;
 return jsonb_build_object('state',case when review_reason is null then 'paid' else 'review' end,
  'invoice_id',i.id,'quote_id',q.id,'review_reason',review_reason,'replayed',false);
end $$;

-- A quote expiry does not revoke a wallet transaction. Cancellation leaves a
-- durable hold so reconciliation can record any transfer that arrives later.
create function public.commerce_request_native_eth_cancellation(p_invoice uuid,p_customer uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; a public.commerce_gateway_attempts%rowtype;
begin
 if p_customer is null or p_actor is null or p_actor not in ('customer:'||p_customer::text,'admin:unpaid-cancellation')
 then raise exception 'Invalid cancellation request' using errcode='22023'; end if;
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer and checkout_version is not null for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if i.cancellation_requested_at is not null or i.status='void' then
  return jsonb_build_object('id',i.id,'status',i.status,'cancellation_status',i.cancellation_status,'cancellation_requested_at',i.cancellation_requested_at);
 end if;
 select * into a from public.commerce_gateway_attempts
 where invoice_id=i.id and operation='sale' and state<>'declined' for update;
 if i.status<>'accepted' or a.provider is distinct from 'ethereum_eth' or a.mode is distinct from 'live' or a.state is distinct from 'started'
  or not exists(select 1 from public.commerce_native_eth_quotes where attempt_id=a.id)
  or exists(select 1 from public.commerce_receipts where invoice_id=i.id and kind='payment')
 then raise exception 'Native ETH payment requires reconciliation' using errcode='P0001'; end if;
 update public.commerce_invoices set cancellation_requested_at=now(),cancellation_status='pending',version=version+1,updated_at=now()
 where id=i.id returning * into i;
 insert into public.commerce_events(invoice_id,action,actor,details) values(
  i.id,'cancellation_requested',p_actor,jsonb_build_object('attempt_id',a.id,'payment_check_pending',true)
 );
 return jsonb_build_object('id',i.id,'status',i.status,'cancellation_status',i.cancellation_status,'cancellation_requested_at',i.cancellation_requested_at);
end $$;

revoke all on function commerce_internal.native_eth_quote_json(public.commerce_native_eth_quotes),
 commerce_internal.guard_native_eth_gateway_payment(),commerce_internal.guard_native_eth_receipt()
 from public,anon,authenticated,service_role;
revoke all on function public.commerce_create_native_eth_quote(uuid,uuid,uuid,text,jsonb),
 public.commerce_note_native_eth_submission(uuid,uuid,uuid,text),
 public.commerce_finish_native_eth_payment(uuid,text,jsonb),
 public.commerce_request_native_eth_cancellation(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.commerce_create_native_eth_quote(uuid,uuid,uuid,text,jsonb),
 public.commerce_note_native_eth_submission(uuid,uuid,uuid,text),
 public.commerce_finish_native_eth_payment(uuid,text,jsonb),
 public.commerce_request_native_eth_cancellation(uuid,uuid,text) to service_role;
commit;
