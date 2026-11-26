begin;

create table commerce_internal.mobile_funnel_days (
  utc_day date not null,
  browser text not null check (browser in ('iphone_safari', 'android_chrome')),
  stage text not null check (stage in ('cart', 'checkout')),
  tally bigint not null default 1 check (tally > 0),
  primary key (utc_day, browser, stage)
);

alter table commerce_internal.mobile_funnel_days enable row level security;
revoke all on commerce_internal.mobile_funnel_days from public, anon, authenticated, service_role;

create function public.pure_record_mobile_funnel(p_browser text, p_stage text)
returns void language sql security definer set search_path = pg_catalog, pg_temp as $$
  insert into commerce_internal.mobile_funnel_days as days (utc_day, browser, stage)
  values ((now() at time zone 'UTC')::date, p_browser, p_stage)
  on conflict (utc_day, browser, stage) do update set tally = days.tally + 1;
$$;

create function public.pure_mobile_funnel_report()
returns table (browser text, carts bigint, checkouts bigint, paid bigint)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  with period as (
    select (now() at time zone 'UTC')::date as today
  ), browsers as (
    select unnest(array['iphone_safari', 'android_chrome']) as browser
  ), counters as (
    select d.browser,
           sum(d.tally) filter (where d.stage = 'cart')::bigint as carts,
           sum(d.tally) filter (where d.stage = 'checkout')::bigint as checkouts
    from commerce_internal.mobile_funnel_days d, period p
    where d.utc_day between p.today - 29 and p.today
    group by d.browser
  ), verified as (
    select i.request_data #>> '{measurement,browser}' as browser, count(*) as paid
    from public.commerce_invoices i, period p
    where i.kind = 'goods' and i.paid_at is not null and i.total_cents > 0
      and i.request_data #>> '{checkout,coupon}' is distinct from 'CARDTEST'
      and i.request_data #>> '{measurement,day}'
        between to_char(p.today - 29, 'YYYY-MM-DD') and to_char(p.today, 'YYYY-MM-DD')
      and not exists (
        select 1 from public.commerce_gateway_attempts a
        where a.invoice_id = i.id and a.operation = 'sale' and a.mode = 'sandbox' and a.state = 'paid'
      )
    group by i.request_data #>> '{measurement,browser}'
  )
  select b.browser, coalesce(c.carts, 0), coalesce(c.checkouts, 0), coalesce(v.paid, 0)
  from browsers b left join counters c on c.browser = b.browser
  left join verified v on v.browser = b.browser;
$$;

revoke all on function public.pure_record_mobile_funnel(text, text), public.pure_mobile_funnel_report()
  from public, anon, authenticated, service_role;
grant execute on function public.pure_record_mobile_funnel(text, text), public.pure_mobile_funnel_report()
  to service_role;

commit;
