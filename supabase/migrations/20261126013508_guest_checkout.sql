begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Guest orders use the existing invoice and gateway pipeline. They have a
-- synthetic invoice owner, so account-only offers must not be awarded to it.
do $guest$
declare
  target regprocedure;
  needle text;
  replacement text;
  definition text;
  matches integer;
begin
  for target, needle, replacement in
    select 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure,
      $n$earning_basis:=greatest(0,usd_net-points-credit);$n$,
      $r$if request #> '{checkout,guest}' = 'true'::jsonb then
    if not is_goods or is_cad or method.native_provider is distinct from 'pure_gateway'
      or member.invoice_id is not null or addon is not null
      or request->'bulk_order'='true'::jsonb or request ? 'research_builder_mode'
      or points<>0 or credit<>0 or pricing ? 'referral'
      or coalesce(request #>> '{checkout,affiliate_code}','')<>''
      or request #>> '{checkout,coupon}'='CARDTEST'
      or (p_data->>'total_cents')::integer<50
    then raise exception 'Invalid guest checkout sale' using errcode='22023';end if;
    earning_rate:=0;
  end if;
  earning_basis:=greatest(0,usd_net-points-credit);$r$
    union all
    select 'commerce_internal.queue_review_invitation()'::regprocedure,
      $n$if new.kind<>'goods'$n$,
      $r$if new.request_data #> '{checkout,guest}' = 'true'::jsonb or new.kind<>'goods'$r$
    union all
    select 'commerce_internal.apply_first_paid_order_bac()'::regprocedure,
      $n$if (new.pricing ? 'merchandise_offer'$n$,
      $r$if new.request_data #> '{checkout,guest}' = 'true'::jsonb or (new.pricing ? 'merchandise_offer'$r$
  loop
    definition:=pg_get_functiondef(target);
    matches:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
    if matches<>1 then raise exception 'Unexpected % definition for guest checkout: expected one anchor, found %',target,matches using errcode='P0001';end if;
    execute replace(definition,needle,replacement);
  end loop;
end
$guest$;

commit;
