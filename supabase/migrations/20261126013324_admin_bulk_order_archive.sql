-- Archiving is an admin list preference. It never changes payment or fulfillment.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.commerce_invoices add column if not exists archived_at timestamptz;

create or replace function public.commerce_admin_archive_orders(p_orders jsonb, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  target record;
  invoice public.commerce_invoices%rowtype;
  legacy public.store_orders%rowtype;
  archive_time timestamptz := case when p_archived then now() end;
  changed_orders jsonb := '[]'::jsonb;
  skipped_orders jsonb := '[]'::jsonb;
  reason text;
  order_number text;
begin
  if p_archived is null or jsonb_typeof(p_orders) is distinct from 'array'
  then raise exception 'Invalid order selection' using errcode = '22023'; end if;
  if jsonb_array_length(p_orders) not between 1 and 200 or exists (
    select 1 from jsonb_array_elements(p_orders) item
    where jsonb_typeof(item) is distinct from 'object'
      or coalesce(item->>'source','') not in ('commerce','store')
      or coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then raise exception 'Invalid order selection' using errcode = '22023'; end if;

  -- Lock in a stable order, so overlapping selections cannot deadlock each other.
  for target in
    select distinct item->>'source' as source, (item->>'id')::uuid as id
    from jsonb_array_elements(p_orders) item
    order by source, id
  loop
    reason := null;
    order_number := null;
    if target.source = 'commerce' then
      select * into invoice from public.commerce_invoices where id = target.id for update;
      if not found then reason := 'not_found';
      elsif (invoice.archived_at is not null) = p_archived then
        reason := case when p_archived then 'already_archived' else 'already_active' end;
      elsif p_archived and (
        not (invoice.status in ('delivered','refunded','void') or (invoice.kind = 'membership' and invoice.status = 'paid'))
        or coalesce(invoice.cancellation_status in ('pending','review'), false)
      ) then reason := 'not_closed';
      else
        update public.commerce_invoices set archived_at = archive_time where id = invoice.id;
        order_number := invoice.public_order_number;
      end if;
    else
      select * into legacy from public.store_orders where id = target.id for update;
      if not found then reason := 'not_found';
      elsif coalesce(legacy.archived, false) = p_archived then
        reason := case when p_archived then 'already_archived' else 'already_active' end;
      elsif p_archived and coalesce(legacy.fulfillment_status,'') not in ('delivered','canceled')
        then reason := 'not_closed';
      else
        update public.store_orders set archived = p_archived, archived_at = archive_time where id = legacy.id;
        order_number := legacy.order_number;
      end if;
    end if;

    if reason is not null then
      skipped_orders := skipped_orders || jsonb_build_array(jsonb_build_object('id',target.id,'source',target.source,'reason',reason));
    else
      insert into public.commerce_events(invoice_id,action,actor,details)
      values (case when target.source = 'commerce' then target.id end,
        case when p_archived then 'admin_order_archived' else 'admin_order_restored' end,
        'admin:orders', jsonb_build_object('source',target.source,'order_id',target.id,'archived',p_archived));
      changed_orders := changed_orders || jsonb_build_array(jsonb_build_object(
        'id',target.id,'source',target.source,'order_number',order_number,'archived',p_archived,'archived_at',archive_time));
    end if;
  end loop;

  return jsonb_build_object('updated',jsonb_array_length(changed_orders),'orders',changed_orders,'skipped',skipped_orders);
end $$;

revoke all on function public.commerce_admin_archive_orders(jsonb,boolean) from public, anon, authenticated;
grant execute on function public.commerce_admin_archive_orders(jsonb,boolean) to service_role;
commit;
