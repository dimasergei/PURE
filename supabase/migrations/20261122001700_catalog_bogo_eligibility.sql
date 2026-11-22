-- These three premixes ship as individual physical vials. The server selects
-- eligible compound sizes from the catalog. Preserve quantity and expiry checks.
create or replace function commerce_internal.validate_campaign_bogo()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare offer jsonb:=new.pricing->'bogo_campaign'; free jsonb; matching integer;
begin
  if offer is null then return new; end if;
  if new.kind<>'goods' or new.request_data->'bulk_order'='true'::jsonb
    or new.request_data ? 'research_builder_mode'
    or jsonb_typeof(offer->'free_units') is distinct from 'array'
    or coalesce((offer->>'ends_at')::timestamptz<=clock_timestamp(),true)
  then raise exception 'The BOGO offer changed' using errcode='22023'; end if;
  for free in select value from jsonb_array_elements(offer->'free_units') loop
    if free->>'id' in ('bac-3','bac-10','needles','gift-bac-3') then
      raise exception 'The variant is excluded from BOGO' using errcode='22023';
    end if;
    select count(*) into matching from jsonb_array_elements(new.request_data->'items') x
    where x->>'id'=free->>'id' and x->>'size'=free->>'size' and x->'qty'=free->'qty';
    if matching<>1 or (select count(*) from jsonb_array_elements(offer->'free_units') x
      where x->>'id'=free->>'id' and x->>'size'=free->>'size')<>1
    then raise exception 'Invalid complimentary quantity' using errcode='22023';end if;
  end loop;
  return new;
end $$;
revoke all on function commerce_internal.validate_campaign_bogo() from public,anon,authenticated,service_role;
