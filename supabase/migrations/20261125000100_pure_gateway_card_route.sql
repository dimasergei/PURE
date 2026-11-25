-- Card route paid on the owner-operated Get Pure Skin payment page (Stripe PaymentIntents).
-- Adds a disabled-by-default provider. No payment method, customer, invoice, payment or notification is created
-- here; an administrator registers the route afterwards with the Stripe approval reference.
-- Goods orders only: memberships, subscriptions and CAD checkout never use this route.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.commerce_payment_methods drop constraint commerce_payment_methods_native_provider_check;
alter table public.commerce_payment_methods add constraint commerce_payment_methods_native_provider_check check(native_provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway'));
alter table public.commerce_gateway_accounts drop constraint commerce_gateway_accounts_provider_check;
alter table public.commerce_gateway_accounts add constraint commerce_gateway_accounts_provider_check check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway'));
alter table public.commerce_gateway_attempts drop constraint commerce_gateway_attempts_provider_check;
alter table public.commerce_gateway_attempts add constraint commerce_gateway_attempts_provider_check check(provider in ('nmi','payerurl','peptidepay','rampex','polygon_usdc','pure_gateway'));

-- The session reference is provider specific: a PeptidePay checkout session or a Stripe PaymentIntent.
alter table public.commerce_gateway_attempts drop constraint commerce_gateway_attempts_provider_session_id_check;
alter table public.commerce_gateway_attempts add constraint commerce_gateway_attempts_provider_session_id_check check(
 provider_session_id is null
 or (provider='peptidepay' and provider_session_id ~ '^cs_[A-Za-z0-9_-]{6,120}$')
 or (provider='pure_gateway' and provider_session_id ~ '^pi_[A-Za-z0-9_]{6,120}$'));

create function public.commerce_configure_pure_gateway(p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare mid uuid; current_method public.commerce_payment_methods%rowtype; a public.commerce_gateway_accounts%rowtype; country text; codes text[];
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid gateway configuration' using errcode='22023'; end if;
 mid:=(p_data->>'id')::uuid;
 if mid is null or p_data->>'provider' is distinct from 'pure_gateway' or p_data->>'mode' is distinct from 'live'
  or p_data->>'currency' is distinct from 'USD' or p_data->>'sale_scope' is distinct from 'goods'
  or coalesce(p_data->>'account_tag','') !~ '^[a-f0-9]{64}$' or p_data->>'confirmed' is distinct from 'true'
  or jsonb_typeof(p_data->'active') is distinct from 'boolean' or (p_data->>'version')::integer is null or (p_data->>'version')::integer<0
  or length(coalesce(p_actor,''))<8 or length(coalesce(p_data->>'label','')) not between 3 and 80
  or length(coalesce(p_data->>'payee','')) not between 2 and 180 or length(coalesce(p_data->>'approval_reference','')) not between 8 and 400
  or jsonb_typeof(p_data->'countries') is distinct from 'array' then raise exception 'Invalid gateway configuration' using errcode='22023'; end if;
 select array_agg(value) into codes from jsonb_array_elements_text(p_data->'countries');
 if codes is null or cardinality(codes) not between 1 and 60 then raise exception 'Approved destinations required' using errcode='22023'; end if;
 foreach country in array codes loop if country is null or country !~ '^[A-Z]{2}$' then raise exception 'Invalid country' using errcode='22023'; end if; end loop;
 select * into current_method from public.commerce_payment_methods where id=mid for update;
 if found then
  select * into a from public.commerce_gateway_accounts where method_id=mid for update;
  if current_method.version is distinct from (p_data->>'version')::integer then raise exception 'Gateway changed' using errcode='40001'; end if;
  if current_method.native_provider is distinct from 'pure_gateway' or current_method.currency is distinct from 'USD'
   or a.provider is distinct from 'pure_gateway' or a.account_tag is distinct from p_data->>'account_tag' then
   raise exception 'Use a new route for a different gateway account' using errcode='22023'; end if;
  update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',acceptance_reference=p_data->>'approval_reference',
   active=(p_data->>'active')::boolean,sale_scope='goods',version=version+1,updated_at=now() where id=mid;
  update public.commerce_gateway_accounts set countries=codes where method_id=mid;
 else
  if (p_data->>'version')::integer is distinct from 0 then raise exception 'Unknown gateway' using errcode='P0002'; end if;
  insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,allowed_host,acceptance_reference,active,provider_key,display_order,sale_scope,native_provider)
  values(mid,'hosted_link',p_data->>'label','USD',p_data->>'payee','Pay by card on the secure payment page. Payment is confirmed automatically and updates this order.','getpurelabs.com',p_data->>'approval_reference',(p_data->>'active')::boolean,'custom',1,'goods','pure_gateway');
  insert into public.commerce_gateway_accounts(method_id,provider,mode,account_tag,countries) values(mid,'pure_gateway','live',p_data->>'account_tag',codes);
 end if;
 insert into public.commerce_events(method_id,action,actor,details) values(mid,'native_gateway_configured',p_actor,jsonb_build_object('provider','pure_gateway','mode','live','active',p_data->'active','countries',codes));
 return jsonb_build_object('id',mid,'saved',true);
end $$;

-- Bind the server-created PaymentIntent before exposing its payment page or accepting settlement.
create function public.commerce_bind_pure_gateway_session(p_id uuid,p_session text,p_redirect text,p_account_tag text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.commerce_gateway_attempts%rowtype; iid uuid;
begin
 if p_session is null or p_session !~ '^pi_[A-Za-z0-9_]{6,120}$' or p_redirect is null or length(p_redirect)>2000 or position(chr(92) in p_redirect)>0
  or p_redirect !~ ('^https?://[^/?#[:space:]]+/pay[?]pi='||p_session||'$')
  or (left(p_redirect,8)<>'https://' and p_redirect !~ '^http://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?/') then raise exception 'Invalid gateway session binding' using errcode='22023'; end if;
 select invoice_id into iid from public.commerce_gateway_attempts where id=p_id;
 if iid is null then raise exception 'Attempt not found' using errcode='P0002'; end if;
 perform 1 from public.commerce_invoices where id=iid for update;
 select * into a from public.commerce_gateway_attempts where id=p_id for update;
 if a.provider<>'pure_gateway' or a.operation<>'sale' or a.mode<>'live' or a.account_tag is distinct from p_account_tag then raise exception 'Wrong gateway attempt' using errcode='22023'; end if;
 if a.provider_session_id is not null then
  if a.provider_session_id<>p_session or a.redirect_url is distinct from p_redirect then raise exception 'Session binding conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',a.id,'state',a.state,'replayed',true);
 end if;
 if a.state not in ('started','unknown') then raise exception 'Attempt cannot be rebound' using errcode='P0001'; end if;
 -- Binding is the one step that may move an unbound uncertain attempt to redirected (an administrator re-asking for the
 -- same idempotent payment after an outage). Reviewed, paid and refunded attempts never get here.
 update public.commerce_gateway_attempts set provider_session_id=p_session,redirect_url=p_redirect,state='redirected',error_code=null,updated_at=now() where id=a.id;
 insert into public.commerce_gateway_events(provider,event_key,attempt_id,outcome) values('pure_gateway','session-bound:'||a.id::text,a.id,'redirected');
 return jsonb_build_object('id',a.id,'state','redirected','invoice_id',iid,'replayed',false);
end $$;

-- Shared result function: identical to the previous definition except for the pure_gateway provider.
create or replace function public.commerce_finish_gateway_attempt(p_id uuid,p_event text,p_outcome text,p_transaction text,p_amount integer,p_currency text,p_redirect text,p_error text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.commerce_gateway_attempts%rowtype; i public.commerce_invoices%rowtype; prior public.commerce_gateway_events%rowtype; result jsonb; next_state text;
begin
 if p_id is null or p_outcome is null or p_outcome not in ('approved','declined','unknown','redirected','refunded','review')
  or length(coalesce(p_event,'')) not between 3 and 200 or length(coalesce(p_transaction,''))>150 or length(coalesce(p_error,''))>100 then raise exception 'Invalid gateway result' using errcode='22023'; end if;
 select invoice_id into a.invoice_id from public.commerce_gateway_attempts where id=p_id;
 if a.invoice_id is null then raise exception 'Attempt not found' using errcode='P0002'; end if;
 select * into i from public.commerce_invoices where id=a.invoice_id for update;
 select * into a from public.commerce_gateway_attempts where id=p_id for update;
 select * into prior from public.commerce_gateway_events where provider=a.provider and event_key=p_event;
 if found then
  if prior.attempt_id<>a.id or prior.outcome<>p_outcome or prior.provider_transaction_id is distinct from p_transaction or prior.amount_cents is distinct from p_amount or prior.currency is distinct from p_currency then raise exception 'Gateway event conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',a.id,'state',a.state,'invoice_status',i.status,'replayed',true);
 end if;
 insert into public.commerce_gateway_events(provider,event_key,attempt_id,outcome,amount_cents,currency,provider_transaction_id)
 values(a.provider,p_event,a.id,p_outcome,p_amount,p_currency,p_transaction);
 if a.state in ('paid','refunded') then return jsonb_build_object('id',a.id,'state',a.state,'invoice_status',i.status); end if;
 if a.provider='peptidepay' and p_outcome='approved' and (a.provider_session_id is null or p_transaction is null or p_transaction !~ '^0x[a-fA-F0-9]{64}$') then raise exception 'Bound PeptidePay settlement required' using errcode='22023'; end if;
 if a.provider='pure_gateway' and p_outcome='approved' and (a.provider_session_id is null or p_transaction is null or p_transaction !~ '^(ch|py)_[A-Za-z0-9]{6,100}$') then raise exception 'Bound gateway settlement required' using errcode='22023'; end if;
 if p_outcome in ('approved','refunded') then
  if p_amount is distinct from a.amount_cents or p_currency is distinct from a.currency or length(coalesce(p_transaction,''))<2 then
   next_state:='review';
  elsif a.mode<>'live' then
   -- Sandbox provider success never grants production invoice/pass entitlement.
   next_state:='review';p_error:='sandbox_no_live_entitlement';
  elsif (a.operation='sale' and p_outcome<>'approved') or (a.operation='refund' and p_outcome<>'refunded') then next_state:='review';
  else
   next_state:=case when a.operation='sale' then 'paid' else 'refunded' end;
   update public.commerce_gateway_attempts set state=next_state,provider_transaction_id=p_transaction,updated_at=now() where id=a.id;
   begin
    result:=public.commerce_admin_command(case when a.operation='sale' then 'record_payment' else 'record_refund' end,
     jsonb_build_object('id',i.id,'version',i.version,'receipt_id',a.id,'external_reference',a.provider||':'||a.operation||':'||p_transaction,
      'amount_cents',a.amount_cents,'currency',a.currency,'funds_confirmed',true),'verified-gateway:'||a.provider);
   exception when others then
    next_state:='review';p_error:='invoice_reconciliation_required';
   end;
  end if;
 else
  next_state:=p_outcome;
  -- A stale declined/redirected result cannot clear an uncertain result from another worker.
  if a.state='review' or (a.state='unknown' and p_outcome in ('declined','redirected')) then next_state:=a.state; end if;
 end if;
 if p_redirect is not null and (a.provider not in ('payerurl','peptidepay','pure_gateway') or length(p_redirect)>2000
  or (left(p_redirect,8)<>'https://' and not (a.provider='pure_gateway' and p_redirect ~ '^http://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?/'))) then raise exception 'Invalid redirect' using errcode='22023'; end if;
 if a.provider='peptidepay' and p_redirect is not null and p_redirect not in ('https://peptide-pay.com/session/'||a.provider_session_id,'https://www.peptide-pay.com/session/'||a.provider_session_id) then raise exception 'Invalid PeptidePay session destination' using errcode='22023'; end if;
 if a.provider='pure_gateway' and p_redirect is not null and (a.provider_session_id is null or position(chr(92) in p_redirect)>0
  or p_redirect !~ ('^https?://[^/?#[:space:]]+/pay[?]pi='||a.provider_session_id||'$')) then raise exception 'Invalid gateway session destination' using errcode='22023'; end if;
 update public.commerce_gateway_attempts set state=next_state,provider_transaction_id=coalesce(p_transaction,provider_transaction_id),
  redirect_url=coalesce(p_redirect,redirect_url),error_code=p_error,updated_at=now() where id=a.id;
 return jsonb_build_object('id',a.id,'state',next_state,'invoice_id',i.id,'invoice_status',(select status from public.commerce_invoices where id=i.id));
end $$;

-- The checkout validators below are long, shared with every payment route and rewritten by many earlier
-- migrations. Patch the live definition instead of copying it, and fail loudly if its shape is not the
-- one this migration was written against.
do $patch$
declare
 def text; patched text; needle text; replacement text; found_count integer; target regprocedure;
begin
 for target,needle,replacement in
  select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
   $n$method.native_provider not in ('rampex','polygon_usdc')$n$,
   $n$method.native_provider not in ('rampex','polygon_usdc','pure_gateway')$n$
  union all
  select 'commerce_internal.place_membership_checkout(jsonb)'::regprocedure,
   $n$provider in ('rampex','polygon_usdc') and (provider<>'rampex' or rampex_provider='hosted')$n$,
   $n$provider in ('rampex','polygon_usdc','pure_gateway') and (provider<>'rampex' or rampex_provider='hosted')$n$
 loop
  def:=pg_get_functiondef(target);
  found_count:=(length(def)-length(replace(def,needle,'')))/length(needle);
  if found_count<>1 then raise exception 'Unexpected % definition: expected one provider gate, found %',target,found_count using errcode='P0001'; end if;
  patched:=replace(def,needle,replacement);
  execute patched;
 end loop;
end
$patch$;

revoke all on function public.commerce_configure_pure_gateway(jsonb,text),public.commerce_bind_pure_gateway_session(uuid,text,text,text),
 public.commerce_finish_gateway_attempt(uuid,text,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.commerce_configure_pure_gateway(jsonb,text),public.commerce_bind_pure_gateway_session(uuid,text,text,text),
 public.commerce_finish_gateway_attempt(uuid,text,text,text,integer,text,text,text) to service_role;
commit;
