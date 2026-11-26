begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Expand only the guest payment-method check. The surrounding validators still
-- verify the quote currency, Canadian destination, route and account-only rules.
do $guest$
declare
  target regprocedure := 'commerce_internal.validate_membership_checkout(jsonb)'::regprocedure;
  needle text := $n$if not is_goods or is_cad or method.native_provider is distinct from 'pure_gateway'$n$;
  replacement text := $r$if is_goods is not true
      or (is_cad and (
        method.kind is distinct from 'interac'
        or method.provider_key is distinct from 'interac'
        or method.currency is distinct from 'CAD'
        or method.native_provider is not null
        or request #>> '{address,country}' is distinct from 'CA'
      ))
      or (not is_cad and coalesce(method.native_provider,'') not in ('pure_gateway','polygon_usdc'))$r$;
  definition text;
  matches integer;
begin
  definition:=pg_get_functiondef(target);
  matches:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
  if matches<>1 then
    raise exception 'Unexpected guest payment guard, expected one anchor, found %', matches using errcode='P0001';
  end if;
  execute replace(definition,needle,replacement);
end
$guest$;

commit;
