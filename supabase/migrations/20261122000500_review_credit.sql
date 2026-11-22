create table public.commerce_review_invitations (
  invoice_id uuid primary key references public.commerce_invoices(id),
  customer_id uuid not null,
  due_at timestamptz not null
);
create table public.commerce_review_credits (
  code uuid primary key default gen_random_uuid(),
  invoice_id uuid unique not null references public.commerce_storefront_reviews(invoice_id),
  customer_id uuid not null,
  issued_at timestamptz not null default now(),
  redeemed_at timestamptz
);
create index commerce_review_credits_customer_idx on public.commerce_review_credits(customer_id,issued_at desc);
alter table public.commerce_review_invitations enable row level security;
alter table public.commerce_review_credits enable row level security;
revoke all on public.commerce_review_invitations,public.commerce_review_credits from public,anon,authenticated,service_role;

create function commerce_internal.queue_review_invitation()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare event_id uuid; due timestamptz:=now()+interval '168 hours';
begin
  if new.kind<>'goods' or new.status<>'delivered' or old.status='delivered' then return new; end if;
  insert into public.commerce_review_invitations(invoice_id,customer_id,due_at)
    values(new.id,new.customer_id,due) on conflict do nothing;
  if not found then return new; end if;
  insert into public.commerce_events(invoice_id,action,actor)
    values(new.id,'review_invitation','review-scheduler') returning id into event_id;
  insert into public.commerce_notifications(event_id,invoice_id,audience,event_action,snapshot,next_attempt_at)
    values(event_id,new.id,'customer','review_invitation',
      jsonb_build_object('id',new.id,'customer_email',new.customer_email),due);
  return new;
end $$;
revoke all on function commerce_internal.queue_review_invitation() from public,anon,authenticated,service_role;
create trigger commerce_review_invitation after update of status on public.commerce_invoices
  for each row execute function commerce_internal.queue_review_invitation();

create function public.commerce_submit_review(p_customer uuid,p_invoice uuid,p_rating integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare issued public.commerce_review_credits%rowtype; new_review boolean;
begin
  if p_rating is null or p_rating not between 1 and 5 or not exists(
    select 1 from public.commerce_review_invitations q join public.commerce_invoices i on i.id=q.invoice_id
    where q.invoice_id=p_invoice and q.customer_id=p_customer and i.status='delivered' and q.due_at<=now()
  ) then raise exception 'Review is unavailable for this order' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_customer::text,0));
  insert into public.commerce_storefront_reviews(invoice_id,rating) values(p_invoice,p_rating) on conflict do nothing;
  new_review:=found;
  select * into issued from public.commerce_review_credits where invoice_id=p_invoice;
  if not found and new_review and not exists(select 1 from public.commerce_review_credits
    where customer_id=p_customer and issued_at>now()-interval '90 days') then
    insert into public.commerce_review_credits(invoice_id,customer_id) values(p_invoice,p_customer) returning * into issued;
  end if;
  return jsonb_build_object('submitted',true,'code',issued.code,'redeemed',issued.redeemed_at is not null);
end $$;

create function public.commerce_redeem_review_credit(p_customer uuid,p_code uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare reward public.commerce_review_credits%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_customer::text,0));
  update public.commerce_review_credits set redeemed_at=now()
    where code=p_code and customer_id=p_customer and redeemed_at is null returning * into reward;
  if not found then raise exception 'Credit code is unavailable or already redeemed' using errcode='22023'; end if;
  perform public.commerce_issue_credit(reward.code,p_customer,5000,'Honest review reward','review-credit');
  return jsonb_build_object('credited_cents',5000,'currency','USD');
end $$;
revoke all on function public.commerce_submit_review(uuid,uuid,integer),public.commerce_redeem_review_credit(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.commerce_submit_review(uuid,uuid,integer),public.commerce_redeem_review_credit(uuid,uuid) to service_role;
