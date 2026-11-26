create or replace function commerce_internal.issue_repeat_invoice(p_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 p public.pure_repeat_plans%rowtype; m public.commerce_payment_methods%rowtype; invoice uuid:=gen_random_uuid();
 r jsonb; q jsonb; amount integer; method_snapshot jsonb; verified_email text;
begin
 select * into strict p from public.pure_repeat_plans where id=p_id for update;
 if p.status<>'active' then raise exception 'Plan inactive' using errcode='40001'; end if;
 select lower(trim(email)) into verified_email from auth.users where id=p.customer_id and email_confirmed_at is not null;
 if verified_email is null then raise exception 'Account email requires verification' using errcode='P0001';end if;
 r:=p.snapshot->'request'; q:=p.snapshot->'pricing'; amount:=(p.snapshot->>'total_cents')::integer;
 if p.snapshot->>'payment_choice' is distinct from 'per_invoice' then
 select * into m from public.commerce_payment_methods where id=(p.snapshot->>'method_id')::uuid for share;
 if m.id is null or not m.active or m.version is distinct from (p.snapshot->>'method_version')::integer or m.currency<>'USD' or m.sale_scope not in ('goods','both')
   or not exists(select 1 from public.commerce_gateway_accounts a where a.method_id=m.id and a.mode='live'
     and a.provider=m.native_provider and a.provider in ('pure_gateway','rampex','polygon_usdc','base_usdc','ethereum_usdc')
     and (a.provider<>'rampex' or a.rampex_provider='hosted') and r->'address'->>'country'=any(a.countries))
 then raise exception 'Payment method unavailable for this destination' using errcode='P0001'; end if;
 end if;
 if not exists(select 1 from public.commerce_delivery_options where id=q->'delivery'->'selection'->>'shipping' and enabled)
 then raise exception 'Delivery method unavailable' using errcode='P0001'; end if;
 method_snapshot:=jsonb_build_object('kind',m.kind,'label',m.label,'payee',m.payee,'instructions',m.instructions,
   'method_version',m.version,'payment_url','https://getpurelabs.com/pay.html?invoice='||invoice);
 if p.snapshot->>'payment_choice'='per_invoice' then
   method_snapshot:=null;
   r:=r||'{"payment_choice":"per_invoice"}'::jsonb;
 end if;
 r:=r||jsonb_build_object('research_use_confirmed',true,'repeat_plan_id',p.id,'repeat_cycle',p.cycle+1,'repeat_terms',p.snapshot->>'terms',
   'checkout',jsonb_build_object('method_id',m.id,'version','checkout-2026-11-v8','points',0,'credit_cents',0,'coupon','','delivery',q->'delivery'->'selection'));
 insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,request_digest,request_data,terms_version,
    status,currency,pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,method_id,payment_snapshot,expires_at,
    accepted_at,checkout_version,points_redeemed,credit_redeemed_cents,earned_points)
 values(invoice,p.customer_id,verified_email,r->>'name','goods',encode(sha256(convert_to(r::text,'UTF8')),'hex'),r,'launch-2026-11-v1',
    'accepted','USD',q,(q->>'subtotal_cents')::integer,(q->>'discount_cents')::integer,coalesce((q->'delivery'->>'total_cents')::integer,(q->'delivery'->>'shipping_cents')::integer),0,
    amount,m.id,method_snapshot,now()+interval '24 hours',now(),'checkout-2026-11-v8',0,0,0);
 insert into commerce_internal.repeat_invoice_cycles values(p.id,p.cycle+1,invoice);
 insert into public.commerce_events(invoice_id,action,actor,details)
 values(invoice,'checkout_placed','monthly-invoice',jsonb_build_object('amount_cents',amount,'currency','USD','repeat_plan_id',p.id));
 update public.pure_repeat_plans set customer_email=verified_email,cycle=cycle+1,latest_invoice_id=invoice,version=version+1,
    next_due_at=greatest(next_due_at,now())+interval '1 month',resumed_unpaid=false,pause_reason=null where id=p.id;
 return invoice;
end $$;
revoke all on function commerce_internal.issue_repeat_invoice(uuid) from public,anon,authenticated,service_role;


create or replace function commerce_internal.process_repeat_invoices()
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p record; prior public.commerce_invoices%rowtype;
begin
 for p in select id,latest_invoice_id,resumed_unpaid,snapshot from public.pure_repeat_plans where status='active' and next_due_at<=now()
   order by next_due_at limit 100 for update skip locked loop
   select * into prior from public.commerce_invoices where id=p.latest_invoice_id;
   if prior.status not in ('paid','processing','shipped','delivered') and not p.resumed_unpaid and p.snapshot->>'payment_choice' is distinct from 'per_invoice' then
     update public.pure_repeat_plans set status='paused',version=version+1,pause_reason='Previous invoice unpaid or reversed' where id=p.id;
   else
     begin
       perform commerce_internal.issue_repeat_invoice(p.id);
     exception when sqlstate 'P0001' then
       update public.pure_repeat_plans set status='paused',version=version+1,pause_reason='Review payment or delivery method' where id=p.id;
     end;
   end if;
 end loop;
end $$;
revoke all on function commerce_internal.process_repeat_invoices() from public,anon,authenticated,service_role;

-- Count elected shipment protection in the invoice's delivery charge.
do $migration$
declare f text:=pg_get_functiondef('public.pure_repeat_save(uuid,uuid,text,jsonb,text,integer)'::regprocedure);
marker text:=$old$ship:=(q->'delivery'->>'shipping_cents')::int;amount:=sub-disc+ship;$old$;
begin
 if strpos(f,marker)=0 then raise exception 'Unknown monthly pricing function'; end if;
 execute replace(f,marker,$new$
 ship:=(q->'delivery'->>'shipping_cents')::int;
 if p_snapshot->>'payment_choice'='per_invoice' then
   if q#>'{delivery,selection,extras}'='["protection"]'::jsonb then
     select ship+price_cents into ship from public.commerce_delivery_options where id='protection' and enabled
       and price_cents=(q#>>'{delivery,extras_cents}')::int;
   elsif q#>'{delivery,selection,extras}' is distinct from '[]'::jsonb or q#>'{delivery,extras_cents}' is distinct from '0'::jsonb then
     raise exception 'Invalid shipment protection' using errcode='22023';
   end if;
   if ship is null or q#>'{delivery,total_cents}' is distinct from to_jsonb(ship) then
     raise exception 'Delivery amount changed' using errcode='22023';
   end if;
 end if;
 amount:=sub-disc+ship;
$new$);
end $migration$;

create function public.pure_repeat_choose_payment(p_owner uuid,p_invoice uuid,p_method uuid,p_version integer,p_total integer,p_fx jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 r public.commerce_invoices%rowtype;
 m public.commerce_payment_methods%rowtype;
 snapshot jsonb;
 transfer_cents integer;
 rate integer;
begin
 select * into r from public.commerce_invoices where id=p_invoice and customer_id=p_owner for update;
 if not found or r.request_data->>'payment_choice' is distinct from 'per_invoice' then
   raise exception 'Invoice not found' using errcode='P0002';
 end if;
 if r.status<>'accepted' or r.cancellation_requested_at is not null or r.expires_at is null or r.expires_at<=now()
    or r.currency is distinct from 'USD' or r.total_cents is distinct from p_total then
   raise exception 'Invoice unavailable' using errcode='40001';
 end if;
 if r.method_id is not null then
   if r.method_id=p_method then return; end if;
   raise exception 'A payment method was already selected' using errcode='40001';
 end if;
 select * into m from public.commerce_payment_methods where id=p_method and active and version=p_version and sale_scope in ('goods','both') for share;
 if not found then raise exception 'Method unavailable' using errcode='40001';end if;
 snapshot:=jsonb_build_object('kind',m.kind,'label',m.label,'method_version',m.version,'payee',m.payee,'instructions',m.instructions);
 if m.kind='interac' and m.provider_key='interac' and m.native_provider is null and m.currency='CAD' and r.request_data#>>'{address,country}'='CA' then
   rate:=(p_fx->>'fx_ppm')::integer;
   if rate is null or rate not between 100000 and 10000000 or p_fx->>'series' is distinct from 'FXUSDCAD'
     or p_fx->>'source' is distinct from 'Bank of Canada' or coalesce((p_fx->>'expires_at')::timestamptz,now())<=now() then
     raise exception 'Exchange rate unavailable' using errcode='40001';
   end if;
   transfer_cents:=round(r.total_cents::numeric*rate/1000000)::integer;
   if transfer_cents not between 1 and 100000000 then raise exception 'Transfer amount outside limits' using errcode='22023';end if;
   snapshot:=snapshot||jsonb_build_object('currency','CAD','settlement_cents',transfer_cents,'fx',p_fx,'payment_reference',coalesce(r.public_order_number,'INV-'||upper(r.id::text)));
 elsif m.kind='hosted_link' and m.currency='USD' and exists(select 1 from public.commerce_gateway_accounts a where a.method_id=m.id and a.provider=m.native_provider and a.mode='live'
    and a.provider in ('rampex','pure_gateway','polygon_usdc','base_usdc','ethereum_usdc') and (a.provider<>'rampex' or a.rampex_provider='hosted') and r.request_data#>>'{address,country}'=any(a.countries)) then
   snapshot:=snapshot||jsonb_build_object('payment_url','https://getpurelabs.com/pay.html?invoice='||r.id);
 else raise exception 'Method unavailable for destination' using errcode='40001';
 end if;
 update public.commerce_invoices set method_id=m.id,payment_snapshot=snapshot,version=version+1,updated_at=now(),
 request_data=jsonb_set(request_data,'{checkout,method_id}',to_jsonb(m.id)) where id=r.id;
end $$;
revoke all on function public.pure_repeat_choose_payment(uuid,uuid,uuid,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.pure_repeat_choose_payment(uuid,uuid,uuid,integer,integer,jsonb) to service_role;

-- Only the local row used for receipt matching changes currency. The invoice and
-- its item, discount, shipping and tax amounts stay in USD through payment/refund.
do $migration$
declare f text; marker text; routine regprocedure;
begin
 foreach routine in array array['public.commerce_admin_command(text,jsonb,text)'::regprocedure,'public.commerce_admin_record_bank_payment(uuid,jsonb)'::regprocedure] loop
   f:=pg_get_functiondef(routine);
   marker:=case when routine='public.commerce_admin_command(text,jsonb,text)'::regprocedure
     then ' if p_action in (''record_payment'',''record_refund'') then' else ' select * into m from public.commerce_payment_methods where id=r.method_id for share;' end;
   if strpos(f,marker)=0 then raise exception 'Unknown receipt function %',routine; end if;
   execute replace(f,marker,$new$
 if r.currency='USD' and r.request_data->>'payment_choice'='per_invoice' and r.payment_snapshot->>'kind'='interac' and r.payment_snapshot->>'currency'='CAD' then
   r.total_cents:=(r.payment_snapshot->>'settlement_cents')::integer;
   r.currency:='CAD';
 end if;
$new$||marker);
 end loop;
end $migration$;
