alter table public.commerce_partner_commissions
  drop constraint commerce_partner_commissions_rate_bps_check,
  add constraint commerce_partner_commissions_rate_bps_check check (rate_bps in (1000, 2000, 4000));

CREATE OR REPLACE FUNCTION commerce_internal.partner_order_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare pid uuid;first_id uuid;basis integer;rate integer;
begin
 if new.kind<>'goods' or old.status=new.status then return new; end if;
 perform 1 from public.commerce_partners where customer_id in (select partner_id from public.commerce_partner_commissions where invoice_id=new.id) for update;
 if new.status='paid' and old.status='accepted' and new.checkout_version in ('checkout-2026-11-v3','checkout-2026-11-v4','checkout-2026-11-v5','checkout-2026-11-v6','checkout-2026-11-v7','checkout-2026-11-v8','checkout-interac-cad-2026-11-v1','checkout-interac-cad-2026-11-v2') then
  perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text,0));
  select partner_id,first_invoice_id into pid,first_id from public.commerce_referrals where customer_id=new.customer_id;
  if pid is null and new.pricing->'referral' is not null then
   pid:=(new.pricing->'referral'->>'partner_id')::uuid;
   if exists(select 1 from public.commerce_invoices where customer_id=new.customer_id and id<>new.id and kind='goods' and status in ('paid','processing','shipped','delivered','refunded')) then pid:=null;
   elsif pid<>new.customer_id and exists(select 1 from public.commerce_partners where customer_id=pid and status='active') then
    insert into public.commerce_referrals(customer_id,partner_id,first_invoice_id) values(new.customer_id,pid,new.id) on conflict(customer_id) do nothing;
    select partner_id,first_invoice_id into pid,first_id from public.commerce_referrals where customer_id=new.customer_id;
   else pid:=null; end if;
  end if;
  if pid is not null and exists(select 1 from public.commerce_partners where customer_id=pid and status='active') then
   if new.checkout_version in ('checkout-interac-cad-2026-11-v1','checkout-interac-cad-2026-11-v2') then
    if new.currency is distinct from 'CAD' or new.pricing->'usd_basis'->>'currency' is distinct from 'USD'
     or jsonb_typeof(new.pricing->'usd_basis'->'merchandise_cents') is distinct from 'number'
     or coalesce(new.pricing->'usd_basis'->>'merchandise_cents','') !~ '^[0-9]+$'
    then raise exception 'Validated USD commission basis unavailable' using errcode='P0001'; end if;
    basis:=(new.pricing->'usd_basis'->>'merchandise_cents')::integer;
    if basis not between 0 and 100000000 then raise exception 'Invalid USD commission basis' using errcode='P0001'; end if;
   else
    basis:=greatest(0,new.subtotal_cents-new.discount_cents-new.points_redeemed-new.credit_redeemed_cents-coalesce((new.pricing->'membership_addon'->>'fee_cents')::integer,0));
   end if;
   rate:=case when first_id=new.id then 4000 else 1000 end;
   insert into public.commerce_partner_commissions(invoice_id,partner_id,basis_cents,rate_bps,amount_cents)
    values(new.id,pid,basis,rate,floor(basis::numeric*rate/10000)::integer) on conflict(invoice_id) do nothing;
  end if;
 elsif new.status='delivered' then
  update public.commerce_partner_commissions set eligible_at=now()+interval '30 days' where invoice_id=new.id and status='pending';
 elsif new.status in ('refunded','void') then
  update public.commerce_partner_commissions set status='reversed' where invoice_id=new.id;
 end if;
 return new;
end $function$
;
