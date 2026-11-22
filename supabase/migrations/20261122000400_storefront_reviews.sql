create table public.commerce_storefront_reviews (
  invoice_id uuid primary key references public.commerce_invoices(id),
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now()
);
alter table public.commerce_storefront_reviews enable row level security;
revoke all on public.commerce_storefront_reviews from public, anon, authenticated, service_role;

create function public.commerce_storefront_review_summary()
returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object('count',count(*),'rating',round(avg(rating),1))
  from public.commerce_storefront_reviews
$$;
revoke all on function public.commerce_storefront_review_summary() from public, anon, authenticated, service_role;
grant execute on function public.commerce_storefront_review_summary() to service_role;
