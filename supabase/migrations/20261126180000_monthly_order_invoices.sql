-- Monthly consent produces a fresh, unpaid goods invoice. No saved payment instrument is accessed.
create table public.pure_repeat_plans (
  id uuid primary key, customer_id uuid not null references auth.users(id),
  customer_email text not null, status text not null default 'active' check(status in ('active','paused','canceled')),
  snapshot jsonb not null, enrollment_digest text not null, version integer not null default 1,
  next_due_at timestamptz not null, latest_invoice_id uuid references public.commerce_invoices(id),
  cycle integer not null default 0, resumed_unpaid boolean not null default false, pause_reason text, created_at timestamptz not null default now()
);
create index pure_repeat_customer on public.pure_repeat_plans(customer_id,created_at desc);
create index pure_repeat_due on public.pure_repeat_plans(next_due_at) where status='active';
alter table public.pure_repeat_plans enable row level security;
revoke all on public.pure_repeat_plans from public,anon,authenticated,service_role;

create table commerce_internal.repeat_invoice_cycles (
  plan_id uuid not null references public.pure_repeat_plans(id), cycle integer not null,
  invoice_id uuid not null unique references public.commerce_invoices(id),
  primary key(plan_id,cycle)
);
revoke all on commerce_internal.repeat_invoice_cycles from public,anon,authenticated,service_role;

create function commerce_internal.issue_repeat_invoice(p_id uuid)
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
 select * into m from public.commerce_payment_methods where id=(p.snapshot->>'method_id')::uuid for share;
 if m.id is null or not m.active or m.version is distinct from (p.snapshot->>'method_version')::integer or m.currency<>'USD' or m.sale_scope not in ('goods','both')
   or not exists(select 1 from public.commerce_gateway_accounts a where a.method_id=m.id and a.mode='live'
     and a.provider=m.native_provider and a.provider in ('pure_gateway','rampex','polygon_usdc','base_usdc','ethereum_usdc')
     and (a.provider<>'rampex' or a.rampex_provider='hosted') and r->'address'->>'country'=any(a.countries))
 then raise exception 'Payment method unavailable for this destination' using errcode='P0001'; end if;
 if not exists(select 1 from public.commerce_delivery_options where id=q->'delivery'->'selection'->>'shipping' and enabled)
 then raise exception 'Delivery method unavailable' using errcode='P0001'; end if;
 method_snapshot:=jsonb_build_object('kind',m.kind,'label',m.label,'payee',m.payee,'instructions',m.instructions,
   'method_version',m.version,'payment_url','https://getpurelabs.com/pay.html?invoice='||invoice);
 r:=r||jsonb_build_object('research_use_confirmed',true,'repeat_plan_id',p.id,'repeat_cycle',p.cycle+1,'repeat_terms',p.snapshot->>'terms',
   'checkout',jsonb_build_object('method_id',m.id,'version','checkout-2026-11-v8','points',0,'credit_cents',0,'coupon','','delivery',q->'delivery'->'selection'));
 insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,request_digest,request_data,terms_version,
    status,currency,pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,method_id,payment_snapshot,expires_at,
    accepted_at,checkout_version,points_redeemed,credit_redeemed_cents,earned_points)
 values(invoice,p.customer_id,verified_email,r->>'name','goods',encode(sha256(convert_to(r::text,'UTF8')),'hex'),r,'launch-2026-11-v1',
    'accepted','USD',q,(q->>'subtotal_cents')::integer,(q->>'discount_cents')::integer,(q->'delivery'->>'shipping_cents')::integer,0,
    amount,m.id,method_snapshot,now()+interval '24 hours',now(),'checkout-2026-11-v8',0,0,0);
 insert into commerce_internal.repeat_invoice_cycles values(p.id,p.cycle+1,invoice);
 insert into public.commerce_events(invoice_id,action,actor,details)
 values(invoice,'checkout_placed','monthly-invoice',jsonb_build_object('amount_cents',amount,'currency','USD','repeat_plan_id',p.id));
 update public.pure_repeat_plans set customer_email=verified_email,cycle=cycle+1,latest_invoice_id=invoice,version=version+1,
    next_due_at=greatest(next_due_at,now())+interval '1 month',resumed_unpaid=false,pause_reason=null where id=p.id;
 return invoice;
end $$;
revoke all on function commerce_internal.issue_repeat_invoice(uuid) from public,anon,authenticated,service_role;

-- Seed each included builder gift when this invoice is actually paid. The
-- existing first-order gift can share the same physical allocation.
do $patch$
declare
 original text:=pg_get_functiondef('commerce_internal.fulfillment_seed(uuid)'::regprocedure);
 marker text:=$match$  if r.pricing->'campaign_bac' = 'true'::jsonb then$match$;
 addition text:=$add$  if r.request_data ? 'repeat_plan_id' and r.pricing->'bundled_items'->0->>'id'='gift-bac-3' then
    insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials,note)
    values(r.id,'gift-bac-3|3 mL', (r.pricing->'bundled_items'->0)||'{"unit_price_usd_cents":0,"research_stack_included":true}'::jsonb,
      'manual','',null,null,'Include one reconstitution solution with each set of four') on conflict do nothing;
  end if;
$add$;
begin
 if length(original)-length(replace(original,marker,''))<>length(marker) then raise exception 'Unexpected fulfillment seed definition';end if;
 execute replace(original,marker,addition||marker);
end $patch$;

create function public.pure_repeat_save(p_id uuid,p_owner uuid,p_email text,p_snapshot jsonb,p_digest text,p_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p public.pure_repeat_plans%rowtype; q jsonb:=p_snapshot->'pricing'; r jsonb:=p_snapshot->'request';
 row_data jsonb; item jsonb; n integer; idx integer:=0; rate integer; qty integer; unit integer; net integer;
 units integer:=0; sub integer:=0; disc integer:=0; ship integer; amount integer; invoice uuid;
begin
 if p_id is null or p_owner is null or p_email is null or p_email<>lower(trim(p_email)) or length(p_email) not between 3 and 254
   or p_snapshot->>'terms' is distinct from 'pure-monthly-invoice-v1' or coalesce(p_snapshot->>'kind','') not in ('product','builder')
   or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or octet_length(p_snapshot::text)>45000
   or jsonb_typeof(q->'lines') is distinct from 'array' or jsonb_typeof(r->'items') is distinct from 'array'
   or jsonb_typeof(q->'bundled_items') is distinct from 'array' or q->>'currency' is distinct from 'USD'
   or r->'address'->>'country' is null or r->>'name' is null or r->>'name'='' then
   raise exception 'Invalid monthly terms' using errcode='22023';
 end if;
 n:=jsonb_array_length(r->'items'); rate:=case when p_snapshot->>'kind'='product' then 1000 else 4000 end;
 if n not between 1 and 60 or jsonb_array_length(q->'lines')<>n or (rate=1000 and n<>1) then
    raise exception 'Invalid monthly selections' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(r->'items') loop
   row_data:=q->'lines'->idx; idx:=idx+1; qty:=(item->>'qty')::integer; unit:=(item->>'unit_price_usd_cents')::integer;
   if qty is null or unit is null or qty not between 1 and 60 or unit not between 1 and 1000000 or item->>'id' is null
     or item->>'size' is null or not row_data @> item then raise exception 'Invalid invoice line' using errcode='22023'; end if;
   net:=round(unit::numeric*(10000-rate)/10000)::int*qty; units:=units+qty; sub:=sub+unit*qty; disc:=disc+unit*qty-net;
   if row_data->'line_total_cents' is distinct from to_jsonb(net) or row_data->'discount_bps' is distinct from to_jsonb(rate)
      or row_data->'discount_cents' is distinct from to_jsonb(unit*qty-net) then raise exception 'Line total changed' using errcode='22023'; end if;
 end loop;
 if units>60 or (rate=4000 and units%4<>0) or q->'bundled_items' is distinct from
   (case when rate=1000 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id','gift-bac-3','name','Reconstitution Solution','size','3 mL','qty',units/4,'unit_price_cents',0,'line_total_cents',0)) end)
 then raise exception 'Incomplete set' using errcode='22023'; end if;
 ship:=(q->'delivery'->>'shipping_cents')::int;amount:=sub-disc+ship;
 if ship is null or ship<0 or amount not between 1 and 100000000 or q->'subtotal_cents' is distinct from to_jsonb(sub)
  or q->'discount_cents' is distinct from to_jsonb(disc) or p_snapshot->'total_cents' is distinct from to_jsonb(amount)
 then raise exception 'Monthly total changed' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into p from public.pure_repeat_plans where id=p_id for update;
 if p_version is null then
   if found then
     if p.customer_id<>p_owner or p.enrollment_digest<>p_digest then raise exception 'Plan reference conflict' using errcode='23505'; end if;
     return jsonb_build_object('plan_id',p.id,'invoice_id',(select c.invoice_id from commerce_internal.repeat_invoice_cycles c where c.plan_id=p.id and c.cycle=1));
   end if;
   if (select count(*) from public.pure_repeat_plans where customer_id=p_owner and status<>'canceled')>=10
     or (select count(*) from public.commerce_invoices where customer_id=p_owner and status in ('requested','issued','accepted') and coalesce(expires_at,now()+interval '1 day')>now())>=10
   then raise exception 'Too many open plans or orders' using errcode='P0001';end if;
   insert into public.pure_repeat_plans(id,customer_id,customer_email,snapshot,enrollment_digest,next_due_at)
   values(p_id,p_owner,p_email,p_snapshot,p_digest,now());
   invoice:=commerce_internal.issue_repeat_invoice(p_id);
 else
   if p.id is null or p.customer_id<>p_owner then raise exception 'Missing plan' using errcode='P0002';end if;
   if p.version<>p_version or p.status='canceled' or p.snapshot->>'kind' is distinct from p_snapshot->>'kind'
   then raise exception 'Stale plan revision' using errcode='40001';end if;
   update public.pure_repeat_plans set snapshot=p_snapshot,customer_email=p_email,version=version+1 where id=p.id;
 end if;
 return jsonb_build_object('plan_id',p_id,'invoice_id',invoice,'total_cents',amount);
end $$;

create function public.pure_repeat_manage(p_owner uuid,p_id uuid,p_action text,p_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p public.pure_repeat_plans%rowtype;
begin
 select * into p from public.pure_repeat_plans where id=p_id and customer_id=p_owner for update;
 if not found then raise exception 'Plan not found' using errcode='P0002';end if;
 if p_version is distinct from p.version or p.status='canceled' or coalesce(p_action,'') not in ('pause','resume','cancel','skip')
   or (p_action='resume' and p.status<>'paused') or (p_action in ('skip','pause') and p.status<>'active')
 then raise exception 'Plan changed' using errcode='40001';end if;
 update public.pure_repeat_plans set
   status=case p_action when 'cancel' then 'canceled' when 'pause' then 'paused' else 'active' end,
   next_due_at=case when p_action='skip' then greatest(next_due_at,now())+interval '1 month'
                    when p_action='resume' then now()+interval '1 month' else next_due_at end,
   resumed_unpaid=case when p_action='resume' then true else resumed_unpaid end,
   version=version+1,pause_reason=case when p_action='pause' then 'Paused by customer' else null end
 where id=p.id;
 return jsonb_build_object('updated',true);
end $$;

create function public.pure_repeat_list(p_owner uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'next_due_at',p.next_due_at,'version',p.version,
   'snapshot',p.snapshot,'pause_reason',p.pause_reason,'invoice_id',p.latest_invoice_id,'invoice_status',i.status,'expires_at',i.expires_at)
   order by p.created_at desc),'[]'::jsonb) from public.pure_repeat_plans p
 left join public.commerce_invoices i on i.id=p.latest_invoice_id where p.customer_id=p_owner;
$$;

create function commerce_internal.process_repeat_invoices()
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p record; prior public.commerce_invoices%rowtype;
begin
 for p in select id,latest_invoice_id,resumed_unpaid from public.pure_repeat_plans where status='active' and next_due_at<=now()
   order by next_due_at limit 100 for update skip locked loop
   select * into prior from public.commerce_invoices where id=p.latest_invoice_id;
   if prior.status not in ('paid','processing','shipped','delivered') and not p.resumed_unpaid then
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
select cron.schedule('pure-monthly-order-invoices','7 * * * *','select commerce_internal.process_repeat_invoices()');

create function public.pure_repeat_ready()
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from cron.job where jobname='pure-monthly-order-invoices' and active)
$$;
revoke all on function public.pure_repeat_ready(),public.pure_repeat_list(uuid),public.pure_repeat_manage(uuid,uuid,text,integer),
 public.pure_repeat_save(uuid,uuid,text,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.pure_repeat_ready(),public.pure_repeat_list(uuid),public.pure_repeat_manage(uuid,uuid,text,integer),
 public.pure_repeat_save(uuid,uuid,text,jsonb,text,integer) to service_role;
