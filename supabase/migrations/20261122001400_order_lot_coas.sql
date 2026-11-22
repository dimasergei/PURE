-- The warehouse records actual packed lots against the exact fulfillment line.
create table public.commerce_packed_lots (
  invoice_id uuid not null,
  variant_key text not null,
  lot_id uuid not null references public.enterprise_inventory_lots(id),
  primary key (invoice_id, variant_key, lot_id),
  foreign key (invoice_id, variant_key) references public.commerce_fulfillment_items(invoice_id, variant_key)
);
alter table public.commerce_packed_lots enable row level security;
revoke all on public.commerce_packed_lots from public, anon, authenticated, service_role;
grant select on public.commerce_packed_lots to service_role;

create function public.commerce_record_packed_lot(p_invoice uuid,p_variant text,p_lot text,p_remove boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare item_data jsonb; lot_key text; matches uuid[]; invoice_status text;
begin
  select status into invoice_status from public.commerce_invoices where id=p_invoice for update;
  if invoice_status is null or invoice_status not in ('paid','processing','shipped','delivered') then return false; end if;
  select item into item_data from public.commerce_fulfillment_items where invoice_id=p_invoice and variant_key=p_variant;
  if item_data is null then return false; end if;
  lot_key:=(item_data->>'id')||'-'||trim(both '-' from regexp_replace(lower(item_data->>'size'),'[^a-z0-9]+','-','g'));
  select array_agg(id) into matches from public.enterprise_inventory_lots
  where sku_key=lot_key and lot_number=p_lot and (status='released' or p_remove);
  if cardinality(matches) is distinct from 1 then return false; end if;
  if p_remove then
    delete from public.commerce_packed_lots where invoice_id=p_invoice and variant_key=p_variant and lot_id=matches[1];
  else
    insert into public.commerce_packed_lots values(p_invoice,p_variant,matches[1]) on conflict do nothing;
  end if;
  return true;
end $$;
revoke all on function public.commerce_record_packed_lot(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.commerce_record_packed_lot(uuid,text,text,boolean) to service_role;

create function public.commerce_order_coas(p_customer uuid,p_ids uuid[])
returns table(invoice_id uuid, variant_key text, lot_number text, report_id text, verification_url text)
language sql stable security definer set search_path=pg_catalog as $$
  select p.invoice_id,p.variant_key,l.lot_number,d.report_id,d.verification_url
  from public.commerce_packed_lots p
  join public.commerce_invoices i on i.id=p.invoice_id
  join public.enterprise_inventory_lots l on l.id=p.lot_id
  join public.enterprise_quality_documents d on d.lot_id=p.lot_id
  where i.customer_id=p_customer and i.id=any(p_ids) and i.status in ('shipped','delivered')
    and d.status='verified' and d.publication_approved and d.verification_url like 'https://%';
$$;
revoke all on function public.commerce_order_coas(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.commerce_order_coas(uuid,uuid[]) to service_role;
