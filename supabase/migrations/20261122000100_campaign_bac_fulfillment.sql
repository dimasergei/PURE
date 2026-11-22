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
    select r.id,x->>'id'||'|'||(x->>'size'),x,'manual','',null,null from jsonb_array_elements(coalesce(r.request_data->'items','[]'::jsonb)) x on conflict do nothing;
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
