-- Counts of issued referral cookies only. No visitor, request, URL or product identifiers.
create table commerce_internal.partner_link_days (
  partner_id uuid not null references public.commerce_partners(customer_id) on delete cascade,
  utc_day date not null,
  starts bigint not null check (starts >= 0),
  primary key (partner_id, utc_day)
);
create table commerce_internal.partner_measurement_epoch (
  singleton boolean primary key check (singleton),
  started_on date not null
);
insert into commerce_internal.partner_measurement_epoch values (true, (now() at time zone 'UTC')::date);
alter table commerce_internal.partner_link_days enable row level security;
alter table commerce_internal.partner_measurement_epoch enable row level security;
revoke all on commerce_internal.partner_link_days, commerce_internal.partner_measurement_epoch
  from public, anon, authenticated, service_role;

create function public.commerce_count_partner_start(p_partner uuid) returns void
language sql security definer set search_path = pg_catalog, pg_temp as $$
  insert into commerce_internal.partner_link_days as tally (partner_id, utc_day, starts)
  select p.customer_id, (now() at time zone 'UTC')::date, 1
  from public.commerce_partners p where p.customer_id = p_partner and p.status = 'active'
  on conflict (partner_id, utc_day) do update set starts = tally.starts + 1;
$$;

-- The commission entry is created on payment. Later reversals leave the entry in
-- place. Report them separately and exclude them from retained order and dollar totals.
create function public.commerce_partner_performance(p_partners uuid[]) returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  with reporting as (
    select (now() at time zone 'UTC')::date - 29 as first_day,
           (now() at time zone 'UTC')::date as today, started_on
    from commerce_internal.partner_measurement_epoch
  ), partners as (
    select customer_id as id from public.commerce_partners where customer_id = any(p_partners)
  ), visits as (
    select d.partner_id, sum(d.starts) as starts
    from commerce_internal.partner_link_days d join partners p on p.id = d.partner_id
    cross join reporting r where d.utc_day between r.first_day and r.today group by d.partner_id
  ), orders as (
    select c.partner_id, c.basis_cents, c.amount_cents, i.status,
           c.status <> 'reversed' and i.status in ('paid','processing','shipped','delivered') as retained,
           a.first_invoice_id = i.id as first_order
    from public.commerce_partner_commissions c
    join partners p on p.id = c.partner_id
    join public.commerce_invoices i on i.id = c.invoice_id
    left join public.commerce_referrals a on a.customer_id = i.customer_id and a.partner_id = c.partner_id
    cross join reporting r
    where c.created_at >= (r.first_day::timestamp at time zone 'UTC') and c.created_at <= now()
  ), totals as (
    select partner_id,
           count(*) filter (where retained) as paid_orders,
           count(*) filter (where retained and first_order) as first_orders,
           count(*) filter (where retained and first_order = false) as repeat_orders,
           count(*) filter (where retained and status = 'delivered') as delivered_orders,
           count(*) filter (where not retained) as reversed_orders,
           sum(basis_cents) filter (where retained) as merchandise_cents,
           sum(amount_cents) filter (where retained) as commission_cents
    from orders group by partner_id
  )
  select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
    'window_start', r.first_day, 'tracking_since', r.started_on,
    'starts', coalesce(v.starts, 0), 'paid_orders', coalesce(t.paid_orders, 0),
    'first_orders', coalesce(t.first_orders, 0), 'repeat_orders', coalesce(t.repeat_orders, 0),
    'delivered_orders', coalesce(t.delivered_orders, 0), 'reversed_orders', coalesce(t.reversed_orders, 0),
    'merchandise_cents', coalesce(t.merchandise_cents, 0), 'commission_cents', coalesce(t.commission_cents, 0)
  )), '{}'::jsonb)
  from partners p cross join reporting r
  left join visits v on v.partner_id = p.id left join totals t on t.partner_id = p.id;
$$;
revoke all on function public.commerce_count_partner_start(uuid), public.commerce_partner_performance(uuid[])
  from public, anon, authenticated;
grant execute on function public.commerce_count_partner_start(uuid), public.commerce_partner_performance(uuid[])
  to service_role;
