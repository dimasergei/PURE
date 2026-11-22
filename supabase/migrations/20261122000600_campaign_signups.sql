create table public.commerce_campaign_signups (
  email text primary key,
  phone text not null,
  consent_at timestamptz not null default now()
);
alter table public.commerce_campaign_signups enable row level security;
revoke all on public.commerce_campaign_signups from public, anon, authenticated, service_role;
grant insert on public.commerce_campaign_signups to service_role;
