begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- No entitlement is created by this migration. Only a verified tester's account
-- can be enabled, and no browser role can read or write an entitlement.
create table public.commerce_card_test_entitlements (
  customer_id uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  redeemed_invoice_id uuid unique references public.commerce_invoices(id)
);
alter table public.commerce_card_test_entitlements enable row level security;
revoke all on public.commerce_card_test_entitlements from public, anon, authenticated, service_role;
grant select, insert (customer_id, expires_at), update (expires_at)
  on public.commerce_card_test_entitlements to service_role;

-- Extend the existing validator so all normal checkout arithmetic, delivery,
-- permissions, and gateway checks still run. Abort on a mismatched schema.
do $patch$
declare
  target regprocedure;
  needle text;
  replacement text;
  definition text;
  matches integer;
begin
  for target, needle, replacement in
    select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
      $n$coupon_rate:=case when code='BLACKFRIDAY10' then 1000 when code='BLACKFRIDAY15' then 1500 else 0 end;$n$,
      $r$coupon_rate:=case when code='BLACKFRIDAY10' then 1000 when code='BLACKFRIDAY15' then 1500 when code='CARDTEST' then 9800 else 0 end;
  if code='CARDTEST' then
    if p_data->>'currency' is distinct from 'USD' or method.native_provider is distinct from 'pure_gateway'
      or request->'bulk_order'='true'::jsonb or request ? 'research_builder_mode'
      or member.invoice_id is not null or addon is not null
      or points<>0 or credit<>0 or quantity_mode
      or request->'checkout' ? 'affiliate_code' or pricing ? 'referral'
      or jsonb_array_length(request->'items')<>1 or request->'items'->0->'qty' is distinct from '1'::jsonb
      or pricing->>'promotion_version' is distinct from 'blackfriday10-2026-11-v1'
    then raise exception 'CARDTEST requires one retail item and Credit/Debit card' using errcode='22023';end if;
    if not exists(select 1 from public.commerce_card_test_entitlements
      where customer_id=(p_data->>'customer_id')::uuid and expires_at>clock_timestamp() and redeemed_invoice_id is null)
    then raise exception 'CARDTEST is unavailable for this account' using errcode='22023';end if;
    earning_rate:=0;
  end if;$r$
    union all
    select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
      $n$if code not in ('','BLACKFRIDAY15','BLACKFRIDAY10')$n$,
      $r$if code not in ('','BLACKFRIDAY15','BLACKFRIDAY10','CARDTEST')$r$
    union all
    select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
      $n$base_parts:=commerce_internal.checkout_discount_parts(amounts,base_rate);$n$,
      $r$if code='CARDTEST' then
      if subtotal<=100 then raise exception 'CARDTEST requires more than $1.00 in merchandise' using errcode='22023';end if;
      base_discount:=least(base_discount,subtotal-100);
      base_parts:=jsonb_build_array(base_discount);
    else
      base_parts:=commerce_internal.checkout_discount_parts(amounts,base_rate);
    end if;$r$
    union all
    select 'commerce_internal.place_membership_checkout(jsonb)'::regprocedure,
      $n$perform commerce_internal.balance_event(uid,oid,'points',-points,'Checkout redemption',oid||':redeem-points','customer:'||uid);$n$,
      $r$if p_data#>>'{request,checkout,coupon}'='CARDTEST' then
    -- The order and this redemption commit together under the existing account
    -- lock. A retry of the same invoice returns the saved order before this point.
    update public.commerce_card_test_entitlements
      set redeemed_invoice_id=oid
      where customer_id=uid and expires_at>clock_timestamp() and redeemed_invoice_id is null;
    if not found then raise exception 'CARDTEST is unavailable for this account' using errcode='22023';end if;
  end if;
  perform commerce_internal.balance_event(uid,oid,'points',-points,'Checkout redemption',oid||':redeem-points','customer:'||uid);$r$
  loop
    definition:=pg_get_functiondef(target);
    matches:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
    if matches<>1 then raise exception 'Unexpected % definition for CARDTEST: expected one anchor, found %',target,matches using errcode='P0001';end if;
    execute replace(definition,needle,replacement);
  end loop;
end
$patch$;

commit;
