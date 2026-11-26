-- A reviewed promotion must be configured explicitly. This migration does not
-- create or enable any campaign and does not change payment or checkout code.
create table public.commerce_spin_campaigns (
 code text primary key check (code ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
 name text not null check (length(name) between 1 and 80),
 territory text not null check (length(territory) between 1 and 150),
 minimum_age integer not null check (minimum_age between 18 and 99),
 rules_path text not null check (rules_path ~ '^/[a-zA-Z0-9][a-zA-Z0-9/_-]*[.]html$'),
 terms_version text not null check (terms_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
 skill_question text not null check (length(skill_question) between 1 and 200),
 skill_answer integer not null check (skill_answer between -1000000 and 1000000),
 starts_at timestamptz not null,
 ends_at timestamptz not null check (ends_at > starts_at),
 enabled boolean not null default false
);

create table public.commerce_spin_prizes (
 campaign_code text not null references public.commerce_spin_campaigns(code),
 prize_key text not null check (prize_key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
 label text not null check (length(label) between 1 and 100),
 credit_cents integer not null check (credit_cents between 0 and 100000),
 quantity integer not null check (quantity between 1 and 1000000),
 remaining integer not null check (remaining between 0 and quantity),
 primary key (campaign_code,prize_key)
);

create table public.commerce_spin_entries (
 id uuid primary key default gen_random_uuid(),
 campaign_code text not null references public.commerce_spin_campaigns(code),
 customer_id uuid not null,
 terms_version text not null,
 status text not null check (status in ('credit','no_prize','disqualified')),
 prize_key text,
 prize_label text,
 credit_cents integer not null,
 entered_at timestamptz not null default now(),
 unique (campaign_code,customer_id),
 foreign key (campaign_code,prize_key) references public.commerce_spin_prizes(campaign_code,prize_key),
 check (
   (status = 'disqualified' and prize_key is null and prize_label is null and credit_cents = 0)
   or (status = 'no_prize' and prize_key is not null and prize_label is not null and credit_cents = 0)
   or (status = 'credit' and prize_key is not null and prize_label is not null and credit_cents between 1 and 100000)
 )
);

alter table public.commerce_spin_campaigns enable row level security;
alter table public.commerce_spin_prizes enable row level security;
alter table public.commerce_spin_entries enable row level security;
revoke all on public.commerce_spin_campaigns,public.commerce_spin_prizes,public.commerce_spin_entries from public,anon,authenticated,service_role;

create function public.commerce_spin_campaign(p_campaign text)
returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object(
  'active',true,'name',c.name,'territory',c.territory,'minimum_age',c.minimum_age,
  'rules_path',c.rules_path,'terms_version',c.terms_version,'skill_question',c.skill_question,
  'starts_at',c.starts_at,'ends_at',c.ends_at,
  'prizes',jsonb_agg(jsonb_build_object(
   'key',p.prize_key,'label',p.label,'credit_cents',p.credit_cents,
   'quantity',p.quantity,'remaining',p.remaining
  ) order by p.prize_key)
 )
 from public.commerce_spin_campaigns c
 join public.commerce_spin_prizes p on p.campaign_code=c.code
 where c.code=p_campaign and c.enabled and now()>=c.starts_at and now()<c.ends_at
 group by c.code
 having sum(p.remaining) between 1 and 2147483647
$$;

create function public.commerce_submit_spin(p_campaign text,p_customer uuid,p_version text,p_answer integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 campaign public.commerce_spin_campaigns%rowtype;
 entry public.commerce_spin_entries%rowtype;
 prize public.commerce_spin_prizes%rowtype;
 pool_size bigint;
 ticket bigint;
 entropy bigint;
 limit_value bigint;
begin
 if p_customer is null or p_version is null or p_answer is null then
  raise exception 'Incomplete entry' using errcode='22023';
 end if;
 -- Lock the campaign so a replay or concurrent last-ticket entry cannot
 -- award credit twice or oversubscribe the published prize pool.
 select * into campaign from public.commerce_spin_campaigns where code=p_campaign for update;
 if not found or not campaign.enabled then
  raise exception 'Promotion unavailable' using errcode='22023';
 end if;
 select * into entry from public.commerce_spin_entries
  where campaign_code=p_campaign and customer_id=p_customer;
 if not found then
  if p_version<>campaign.terms_version or now()<campaign.starts_at or now()>=campaign.ends_at then
   raise exception 'Promotion unavailable' using errcode='22023';
  end if;
  select sum(remaining) into pool_size from public.commerce_spin_prizes where campaign_code=p_campaign;
  if coalesce(pool_size,0) not between 1 and 2147483647 then
   raise exception 'Promotion unavailable' using errcode='22023';
  end if;
  if p_answer<>campaign.skill_answer then
   insert into public.commerce_spin_entries(campaign_code,customer_id,terms_version,status,credit_cents)
    values(p_campaign,p_customer,p_version,'disqualified',0) returning * into entry;
  else
   -- Draw one uniform ticket using the 48 random bits before the UUID
   -- version nibble. Reject the partial modulo bucket to avoid bias.
   limit_value:=281474976710656-mod(281474976710656,pool_size);
   loop
    entropy:=('x'||left(replace(gen_random_uuid()::text,'-',''),12))::bit(48)::bigint;
    exit when entropy<limit_value;
   end loop;
   ticket:=mod(entropy,pool_size)+1;
   select p.* into strict prize from public.commerce_spin_prizes p
    join (
     select prize_key,sum(remaining) over (order by prize_key) as ticket_ceiling
     from public.commerce_spin_prizes where campaign_code=p_campaign and remaining>0
    ) eligible on eligible.prize_key=p.prize_key
    where p.campaign_code=p_campaign and eligible.ticket_ceiling>=ticket
    order by eligible.ticket_ceiling limit 1;
   update public.commerce_spin_prizes set remaining=remaining-1
    where campaign_code=p_campaign and prize_key=prize.prize_key;
   insert into public.commerce_spin_entries(campaign_code,customer_id,terms_version,status,prize_key,prize_label,credit_cents)
    values(p_campaign,p_customer,p_version,case when prize.credit_cents>0 then 'credit' else 'no_prize' end,prize.prize_key,prize.label,prize.credit_cents)
    returning * into entry;
   if entry.credit_cents>0 then
    perform public.commerce_issue_credit(entry.id,p_customer,entry.credit_cents,'Spin & Save promotional credit','spin-save');
   end if;
  end if;
 end if;
 return jsonb_build_object(
  'entry_id',entry.id,'status',entry.status,'prize_key',entry.prize_key,
  'label',entry.prize_label,'credit_cents',entry.credit_cents,'currency','USD'
 );
end
$$;

revoke all on function public.commerce_spin_campaign(text),public.commerce_submit_spin(text,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.commerce_spin_campaign(text),public.commerce_submit_spin(text,uuid,text,integer) to service_role;
