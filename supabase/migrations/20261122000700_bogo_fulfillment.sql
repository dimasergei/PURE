create function commerce_internal.validate_campaign_bogo()
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
    if free->>'id' in ('bpc-tb-500','glow','klow','bac-3','bac-10','needles') then
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
create trigger commerce_validate_campaign_bogo before insert on public.commerce_invoices
  for each row execute function commerce_internal.validate_campaign_bogo();

CREATE OR REPLACE FUNCTION commerce_internal.fulfillment_seed(p_invoice uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare r public.commerce_invoices%rowtype; gift boolean;
begin
  select * into r from public.commerce_invoices where id=p_invoice for update;
  if r.id is null or r.kind<>'goods' or r.status not in ('paid','processing') then return;end if;
  -- Preserve existing assignments, parcels and any historical supplier request.
  if exists(select 1 from public.commerce_fulfillment_items where invoice_id=r.id)
    or exists(select 1 from public.commerce_supplier_jobs where invoice_id=r.id) then return;end if;
  insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials)
    select r.id,x->>'id'||'|'||(x->>'size'),
      case when f.qty is null then x else x||jsonb_build_object('qty',(x->>'qty')::int+f.qty,'bogo_free_qty',f.qty) end,
      'manual','',null,null from jsonb_array_elements(coalesce(r.request_data->'items','[]'::jsonb)) x
      left join lateral (select (value->>'qty')::int qty
        from jsonb_array_elements(coalesce(r.pricing->'bogo_campaign'->'free_units','[]'::jsonb))
        where value->>'id'=x->>'id' and value->>'size'=x->>'size') f on true
      on conflict do nothing;
  gift:=(r.request_data->'membership_addon'->>'plan'='elite') or r.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') and exists(
    select 1 from public.commerce_memberships where invoice_id=r.membership_invoice_id and customer_id=r.customer_id and plan='elite' and revoked_at is null
      and starts_at<=r.accepted_at and expires_at>r.accepted_at);
  if gift then
    insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials,note)
    values(r.id,'gift-bac-3|3 mL',jsonb_build_object('id','gift-bac-3','name','Complimentary BAC Water 3mL — PURE BLACK','size','3 mL','qty',1,'unit_price_usd_cents',0,'membership_gift',true),
      'manual','',null,null,'PURE BLACK membership gift: include with the same shipment; do not split this order') on conflict do nothing;
  end if;
  if r.pricing->'campaign_bac' = 'true'::jsonb then
    insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials,note)
    values(r.id,'gift-bac-3|3 mL',jsonb_build_object('id','gift-bac-3','name','Complimentary BAC Water 3mL','size','3 mL','qty',1,'unit_price_usd_cents',0,'campaign_gift',true),
      'manual','',null,null,'Include this gift in the same shipment') on conflict do nothing;
  end if;
  if r.request_data->>'research_builder_mode'='member_stack' then
    insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials,note)
    values(r.id,'gift-bac-3|3 mL',jsonb_build_object('id','gift-bac-3','name','Included BAC Water 3mL — AUTO-STACK',
      'size','3 mL','qty',1,'unit_price_usd_cents',0,'research_stack_included',true),
      'manual','',null,null,'Member Stack included BAC Water: ship with four compounds; no split shipment')
    on conflict do nothing;
  end if;
end $function$
;
