begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- A complimentary copy of a paid variant leaves the existing monetary price
-- validation intact. The invoice trigger still checks expiry and exact units.
do $bogo$
declare
  target regprocedure := 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure;
  needle text := $n$if rollout and (pricing ? 'bogo_campaign' or (p_data->>'discount_cents')::integer>0
    and pricing ?| array['campaign_bac','first_order_bac']) then$n$;
  replacement text := $r$if rollout and pricing ? 'bogo_campaign' and (
    coalesce(pricing->>'merchandise_offer','') not in ('none','coupon')
    or code not in ('','BLACKFRIDAY10')
    or request->'checkout' ? 'affiliate_code'
    or request->'bulk_order'='true'::jsonb
    or request ? 'research_builder_mode'
    or addon is not null
  ) then raise exception 'The BOGO offer cannot be combined with this purchase' using errcode='22023';end if;
  if rollout and (p_data->>'discount_cents')::integer>0
    and pricing ?| array['campaign_bac','first_order_bac'] then$r$;
  definition text;
  matches integer;
begin
  definition:=pg_get_functiondef(target);
  matches:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
  if matches<>1 then
    raise exception 'Unexpected BOGO guard, expected one anchor, found %', matches using errcode='P0001';
  end if;
  execute replace(definition,needle,replacement);
end
$bogo$;

commit;
