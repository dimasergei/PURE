-- Apply only terminal Stripe evidence received by the server from its bound
-- gateway. Preserve the existing invoice, receipts, fulfillment, and audit rules.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function commerce_internal.validate_pure_gateway_reversal(
  p_invoice public.commerce_invoices, p_attempt public.commerce_gateway_attempts,
  p_account_tag text, p_evidence jsonb
) returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if p_invoice.id is null or p_invoice.checkout_version is null or p_invoice.kind<>'goods'
    or p_invoice.currency is distinct from 'USD' or coalesce(p_invoice.total_cents,0)<50
    or p_attempt.invoice_id is distinct from p_invoice.id or p_attempt.method_id is distinct from p_invoice.method_id
    or p_attempt.provider is distinct from 'pure_gateway' or p_attempt.operation is distinct from 'sale'
    or p_attempt.mode is distinct from 'live' or p_attempt.amount_cents is distinct from p_invoice.total_cents
    or p_attempt.currency is distinct from p_invoice.currency
    or p_account_tag is null or p_account_tag !~ '^[a-f0-9]{64}$'
    or p_attempt.account_tag is distinct from p_account_tag
    or not exists(select 1 from public.commerce_gateway_accounts
      where method_id=p_invoice.method_id and provider='pure_gateway' and mode='live' and account_tag=p_account_tag)
    or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>10000
    or p_attempt.provider_session_id is null or p_attempt.provider_session_id !~ '^pi_[A-Za-z0-9_]{6,120}$'
    or p_evidence->>'paymentIntentId' is distinct from p_attempt.provider_session_id
    or lower(p_evidence#>>'{metadata,orderId}') is distinct from p_invoice.id::text
    or p_evidence->'amount' is distinct from to_jsonb(p_invoice.total_cents)
    or p_evidence->>'currency' is distinct from 'usd' or p_evidence->'livemode' is distinct from 'true'::jsonb
  then raise exception 'Stripe evidence does not match the saved order and payment attempt' using errcode='22023';end if;
end $$;
revoke all on function commerce_internal.validate_pure_gateway_reversal(public.commerce_invoices,public.commerce_gateway_attempts,text,jsonb)
  from public,anon,authenticated,service_role;

create function public.commerce_apply_pure_gateway_cancellation(
  p_invoice uuid, p_attempt uuid, p_customer uuid, p_account_tag text, p_evidence jsonb, p_actor text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  order_row public.commerce_invoices%rowtype;
  attempt public.commerce_gateway_attempts%rowtype;
  result jsonb;
begin
  if p_customer is null or p_actor is null or p_actor not in ('customer:'||p_customer::text,
    'admin:unpaid-cancellation','admin:card-cancellation','admin:card-reconciliation','verified-gateway:pure_gateway')
  then raise exception 'Invalid card cancellation actor' using errcode='22023';end if;
  select * into order_row from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
  if not found then raise exception 'Order not found' using errcode='P0002';end if;
  select * into attempt from public.commerce_gateway_attempts where id=p_attempt and invoice_id=p_invoice for update;
  perform commerce_internal.validate_pure_gateway_reversal(order_row,attempt,p_account_tag,p_evidence);
  if p_evidence->>'status' is distinct from 'canceled' or p_evidence->'amountReceived' is distinct from '0'::jsonb
    or p_evidence->'amountRefunded' is distinct from '0'::jsonb or attempt.state not in ('redirected','declined')
  then raise exception 'Stripe has not verified this payment as canceled and unpaid' using errcode='22023';end if;
  if order_row.status='void' and attempt.state='declined' then
    return jsonb_build_object('id',order_row.id,'status','void','payment_state','canceled','replayed',true,'already_canceled',true);
  end if;
  if order_row.status<>'accepted' then raise exception 'Order is not awaiting payment' using errcode='P0001';end if;

  -- Keep both changes under the same invoice lock. No new charge can start
  -- between clearing the original attempt and canceling the order.
  result:=public.commerce_finish_gateway_attempt(attempt.id,'pure-gateway-canceled:'||attempt.provider_session_id,
    'declined',null,null,null,null,'pure_gateway_canceled');
  if result->>'state' is distinct from 'declined' then raise exception 'Card cancellation needs reconciliation' using errcode='P0001';end if;
  result:=public.commerce_cancel_checkout(order_row.id,p_customer);
  insert into public.commerce_events(invoice_id,action,actor,details)
    values(order_row.id,'card_gateway_cancellation_verified',p_actor,
      jsonb_build_object('attempt_id',attempt.id,'payment_intent_id',attempt.provider_session_id));
  return result||jsonb_build_object('payment_state','canceled');
end $$;

create function public.commerce_apply_pure_gateway_refund(
  p_invoice uuid, p_attempt uuid, p_account_tag text, p_evidence jsonb, p_actor text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  order_row public.commerce_invoices%rowtype;
  attempt public.commerce_gateway_attempts%rowtype;
  refund_receipt public.commerce_receipts%rowtype;
  refund_event public.commerce_gateway_events%rowtype;
  charge_id text:=p_evidence->>'chargeId';
  refund_id text:=p_evidence#>>'{refund,id}';
  refund_reference text:='pure_gateway:refund:'||refund_id;
  refund_event_key text:='pure-gateway-refunded:'||refund_id;
  result jsonb;
  sale_was_unrecorded boolean:=false;
  replayed boolean:=false;
begin
  if p_actor is null or p_actor not in ('admin:card-refund','admin:card-reconciliation','verified-gateway:pure_gateway')
  then raise exception 'Invalid card refund actor' using errcode='22023';end if;
  -- Fulfillment and label mutations lock the supplier job before the invoice.
  -- The refund transition may also update that job through its existing trigger.
  perform 1 from public.commerce_supplier_jobs where invoice_id=p_invoice for update;
  select * into order_row from public.commerce_invoices where id=p_invoice for update;
  if not found then raise exception 'Order not found' using errcode='P0002';end if;
  select * into attempt from public.commerce_gateway_attempts where id=p_attempt and invoice_id=p_invoice for update;
  perform commerce_internal.validate_pure_gateway_reversal(order_row,attempt,p_account_tag,p_evidence);
  if p_evidence->>'status' is distinct from 'succeeded' or charge_id is null or charge_id !~ '^(ch|py)_[A-Za-z0-9]{6,100}$'
    or p_evidence->'amountReceived' is distinct from to_jsonb(order_row.total_cents)
    or p_evidence->'amountRefunded' is distinct from to_jsonb(order_row.total_cents)
    or refund_id is null or refund_id !~ '^re_[A-Za-z0-9]{6,120}$'
    or p_evidence#>>'{refund,status}' is distinct from 'succeeded'
    or p_evidence#>'{refund,amount}' is distinct from to_jsonb(order_row.total_cents)
  then raise exception 'Stripe has not verified a completed full refund' using errcode='22023';end if;

  -- Store a sale that the gateway previously completed but this store missed.
  -- No paid-only state is committed when the provider already refunded it.
  if order_row.status='accepted' and attempt.state in ('redirected','unknown','review') then
    result:=public.commerce_finish_gateway_attempt(attempt.id,'pure-gateway-refund-sale:'||attempt.provider_session_id,
      'approved',charge_id,order_row.total_cents,order_row.currency,null,null);
    if result->>'state' is distinct from 'paid' then raise exception 'Record of the original Stripe payment needs review' using errcode='P0001';end if;
    select * into order_row from public.commerce_invoices where id=p_invoice;
    select * into attempt from public.commerce_gateway_attempts where id=p_attempt;
    sale_was_unrecorded:=true;
  end if;
  if order_row.status not in ('paid','processing','shipped','delivered','refunded')
    or attempt.state not in ('paid','refunded') or attempt.provider_transaction_id is distinct from charge_id
    or not exists(select 1 from public.commerce_receipts where invoice_id=order_row.id and kind='payment'
      and method_id=order_row.method_id and amount_cents=order_row.total_cents and currency=order_row.currency
      and external_reference='pure_gateway:sale:'||charge_id)
  then raise exception 'Refund does not match a verified Stripe payment for this order' using errcode='P0001';end if;

  select * into refund_receipt from public.commerce_receipts where invoice_id=order_row.id and kind='refund';
  if found then
    if refund_receipt.external_reference not in (refund_id,refund_reference)
      or refund_receipt.amount_cents<>order_row.total_cents or refund_receipt.currency<>order_row.currency
      or refund_receipt.method_id<>order_row.method_id or order_row.status<>'refunded'
    then raise exception 'Existing refund record needs reconciliation' using errcode='23505';end if;
    replayed:=true;
  else
    perform public.commerce_admin_command('record_refund',jsonb_build_object('id',order_row.id,'version',order_row.version,
      'receipt_id',gen_random_uuid(),'external_reference',refund_reference,'amount_cents',order_row.total_cents,
      'currency',order_row.currency,'funds_confirmed',true),p_actor);
  end if;

  insert into public.commerce_gateway_events(provider,event_key,attempt_id,outcome,amount_cents,currency,provider_transaction_id)
    values('pure_gateway',refund_event_key,attempt.id,'refunded',order_row.total_cents,order_row.currency,refund_id)
    on conflict(provider,event_key) do nothing;
  if found then
    insert into public.commerce_events(invoice_id,action,actor,details) values(order_row.id,'card_gateway_refund_verified',p_actor,
      jsonb_build_object('attempt_id',attempt.id,'payment_intent_id',attempt.provider_session_id,'refund_id',refund_id));
  else
    select * into refund_event from public.commerce_gateway_events where provider='pure_gateway' and event_key=refund_event_key;
    if refund_event.attempt_id is distinct from attempt.id or refund_event.outcome is distinct from 'refunded'
      or refund_event.amount_cents is distinct from order_row.total_cents or refund_event.currency is distinct from order_row.currency
      or refund_event.provider_transaction_id is distinct from refund_id
    then raise exception 'Conflicting Stripe refund evidence' using errcode='23505';end if;
  end if;
  update public.commerce_gateway_attempts set state='refunded',error_code=null,updated_at=now()
    where id=attempt.id and state<>'refunded';
  if sale_was_unrecorded then
    update public.commerce_notifications set state='skipped',last_error='stripe_refund_recorded_with_payment',updated_at=now()
      where invoice_id=order_row.id and event_action='payment_recorded' and state='queued' and attempts=0;
  end if;
  return jsonb_build_object('id',order_row.id,'status','refunded','payment_state','refunded','replayed',replayed);
end $$;

revoke all on function public.commerce_apply_pure_gateway_cancellation(uuid,uuid,uuid,text,jsonb,text),
  public.commerce_apply_pure_gateway_refund(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.commerce_apply_pure_gateway_cancellation(uuid,uuid,uuid,text,jsonb,text),
  public.commerce_apply_pure_gateway_refund(uuid,uuid,text,jsonb,text) to service_role;
commit;
