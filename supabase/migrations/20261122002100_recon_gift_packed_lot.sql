-- Complimentary and retail 3 mL recon lines can use the same physical inventory lot.
create or replace function public.commerce_record_packed_lot(p_invoice uuid,p_variant text,p_lot text,p_remove boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare
  item_data jsonb;
  lot_key text;
  matches uuid[];
  invoice_status text;
begin
  select status into invoice_status from public.commerce_invoices where id=p_invoice for update;
  if invoice_status is null or invoice_status not in ('paid','processing','shipped','delivered') then return false; end if;
  select item into item_data from public.commerce_fulfillment_items where invoice_id=p_invoice and variant_key=p_variant;
  if item_data is null then return false; end if;

  lot_key:=(item_data->>'id')||'-'||trim(both '-' from regexp_replace(lower(item_data->>'size'),'[^a-z0-9]+','-','g'));
  select array_agg(l.id) into matches
  from public.enterprise_inventory_lots l
  where l.lot_number=p_lot
    and (l.sku_key=lot_key or (lot_key='gift-bac-3-3-ml' and l.sku_key='bac-3-3-ml'))
    and (l.status='released' or p_remove);
  if cardinality(matches) is distinct from 1 then return false; end if;

  if p_remove then
    delete from public.commerce_packed_lots where invoice_id=p_invoice and variant_key=p_variant and lot_id=matches[1];
  else
    insert into public.commerce_packed_lots(invoice_id,variant_key,lot_id) values(p_invoice,p_variant,matches[1]) on conflict do nothing;
  end if;
  return true;
end $$;
