-- Add one welcome gift when the first merchandise payment is confirmed.
create table commerce_internal.first_order_bac_claims (
  customer_id uuid primary key,
  invoice_id uuid not null references public.commerce_invoices(id)
);
revoke all on commerce_internal.first_order_bac_claims from public,anon,authenticated,service_role;

create function commerce_internal.apply_first_paid_order_bac()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare gifts jsonb;
begin
  if new.kind is distinct from 'goods' or new.status is distinct from 'paid'
    or old.status is not distinct from new.status or new.customer_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pure-first-order-bac:' || new.customer_id::text, 0));
  if exists(
    select 1 from public.commerce_invoices i
    where i.customer_id=new.customer_id and i.id<>new.id and i.kind='goods'
      and (i.paid_at is not null or i.status in ('paid','processing','shipped','delivered','refunded'))
  ) then return new; end if;

  insert into commerce_internal.first_order_bac_claims values(new.customer_id,new.id)
  on conflict (customer_id) do nothing;
  if not found then return new; end if;

  gifts:=coalesce(new.pricing->'bundled_items','[]'::jsonb);
  if not exists(select 1 from jsonb_array_elements(gifts) g where g->>'id'='gift-bac-3') then
    gifts:=gifts||jsonb_build_array(jsonb_build_object(
      'id','gift-bac-3','name','Complimentary BAC Water','size','3 mL',
      'qty',1,'unit_price_cents',0,'line_total_cents',0));
  end if;
  new.pricing:=coalesce(new.pricing,'{}'::jsonb) ||
    jsonb_build_object('campaign_bac',true,'first_order_bac',true,'bundled_items',gifts);
  return new;
end $$;
revoke all on function commerce_internal.apply_first_paid_order_bac() from public,anon,authenticated,service_role;
create trigger commerce_first_paid_order_bac
before update of status on public.commerce_invoices
for each row execute function commerce_internal.apply_first_paid_order_bac();
