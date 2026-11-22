-- Actual pack and reconciliation evidence for the single-product US manual pilot.
create table public.commerce_manual_pilot_packs (
 invoice_id uuid primary key references public.commerce_invoices(id),
 variant_key text not null default 'tirzepatide|40mg' check (variant_key = 'tirzepatide|40mg'),
 lot_id uuid not null references public.enterprise_inventory_lots(id),
 document_id uuid not null references public.enterprise_quality_documents(id),
 reservation_id uuid not null references public.enterprise_inventory_events(id),
 physical_quantity integer not null check (physical_quantity between 1 and 100000),
 stock_state text not null default 'reserved' check(stock_state in ('reserved','shipped','released')),
 gift_lot_id uuid references public.enterprise_inventory_lots(id),
 gift_reservation_id uuid references public.enterprise_inventory_events(id),
 gift_stock_state text check(gift_stock_state in ('reserved','shipped','released')),
 gift_variant_key text not null default 'gift-bac-3|3 mL' check(gift_variant_key='gift-bac-3|3 mL'),
 gift_lot_number text check(length(btrim(gift_lot_number)) between 1 and 120),
 revision integer not null check(revision>0),
 cost_reference text check(length(btrim(cost_reference)) between 1 and 180),
 delivered_cost_cents integer check(delivered_cost_cents between 0 and 1000000000),
 processing_fee_cents integer check(processing_fee_cents between 0 and 1000000000),
 overhead_cents integer check(overhead_cents between 0 and 1000000000),
 loss_allowance_cents integer check(loss_allowance_cents between 0 and 1000000000),
 updated_at timestamptz not null default now(),
 foreign key(invoice_id,variant_key,lot_id) references public.commerce_packed_lots(invoice_id,variant_key,lot_id) deferrable initially deferred,
 foreign key(invoice_id,gift_variant_key,gift_lot_id) references public.commerce_packed_lots(invoice_id,variant_key,lot_id) deferrable initially deferred,
 check(num_nonnulls(gift_lot_number,gift_lot_id,gift_reservation_id,gift_stock_state) in (0,4)),
 check(num_nonnulls(cost_reference,delivered_cost_cents,processing_fee_cents,overhead_cents,loss_allowance_cents) in (0,5))
);
alter table public.commerce_manual_pilot_packs enable row level security;
revoke all on public.commerce_manual_pilot_packs from public,anon,authenticated,service_role;

-- The existing packed-lot API can serve other orders with split lots. Once
-- enrolled, each pilot line corresponds to one physical lot in this parcel.
create function commerce_internal.check_pilot_packed_lot() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.commerce_packed_lots a join public.commerce_manual_pilot_packs p on p.invoice_id=a.invoice_id
   where a.invoice_id=new.invoice_id and a.variant_key=new.variant_key and a.lot_id=new.lot_id and
   ((a.variant_key=p.variant_key and a.lot_id<>p.lot_id) or (a.variant_key=p.gift_variant_key and a.lot_id is distinct from p.gift_lot_id))) then
  raise exception 'Reconcile managed pilot lots on the manual packing record';
 end if;
 return new;
end $$;
create constraint trigger manual_pilot_packed_lot after insert or update on public.commerce_packed_lots
 deferrable initially deferred for each row execute function commerce_internal.check_pilot_packed_lot();
revoke all on function commerce_internal.check_pilot_packed_lot() from public,anon,authenticated,service_role;

create function commerce_internal.is_manual_pilot(i public.commerce_invoices) returns boolean
language sql stable set search_path=pg_catalog as $$
 select coalesce(i.kind='goods' and i.currency='USD' and i.request_data#>>'{address,country}'='US'
   and i.request_data->'bulk_order' is distinct from 'true'::jsonb
   and i.request_data->'research_builder' is distinct from 'true'::jsonb
   and nullif(i.request_data->>'research_builder_mode','') is null and i.request_data#>>'{membership_addon,plan}' is null
   and jsonb_array_length(i.request_data->'items')=1
   and i.request_data#>>'{items,0,id}'='tirzepatide' and i.request_data#>>'{items,0,size}'='40mg'
   and exists(select 1 from public.commerce_fulfillment_items f where f.invoice_id=i.id and f.variant_key='tirzepatide|40mg')
   and not exists(select 1 from public.commerce_fulfillment_items f where f.invoice_id=i.id
     and (f.route<>'manual' or f.variant_key not in ('tirzepatide|40mg','gift-bac-3|3 mL'))),false)
$$;

create function commerce_internal.manual_pilot_quantities_match(i public.commerce_invoices) returns boolean
language sql stable set search_path=pg_catalog as $$
 select exists(select 1 from public.commerce_fulfillment_items f where f.invoice_id=i.id and f.variant_key='tirzepatide|40mg'
   and (f.item->>'qty')::int=(i.request_data#>>'{items,0,qty}')::int+coalesce((
    select sum((x->>'qty')::int) from jsonb_array_elements(coalesce(i.pricing#>'{bogo_campaign,free_units}','[]'::jsonb)) x
    where x->>'id'='tirzepatide' and x->>'size'='40mg'),0))
 and not exists(select 1 from jsonb_array_elements(coalesce(i.pricing#>'{bogo_campaign,free_units}','[]'::jsonb)) x
   where x->>'id' is distinct from 'tirzepatide' or x->>'size' is distinct from '40mg')
 and (not (i.pricing->'campaign_bac' is not distinct from 'true'::jsonb
  or exists(select 1 from jsonb_array_elements(coalesce(i.pricing->'bundled_items','[]'::jsonb)) x where x->>'id'='gift-bac-3'))
  or exists(select 1 from public.commerce_fulfillment_items f where f.invoice_id=i.id and f.variant_key='gift-bac-3|3 mL' and f.item->>'qty'='1'))
$$;

create function commerce_internal.manual_pilot_ready(p_invoice uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
 select exists(
  select 1 from public.commerce_manual_pilot_packs p
  join public.enterprise_quality_documents d on d.id=p.document_id and d.lot_id=p.lot_id
  join public.enterprise_inventory_lots l on l.id=p.lot_id
  join public.commerce_packed_lots a on a.invoice_id=p.invoice_id and a.variant_key=p.variant_key and a.lot_id=p.lot_id
  where p.invoice_id=p_invoice and commerce_internal.manual_pilot_quantities_match((select i from public.commerce_invoices i where i.id=p_invoice)) and p.stock_state in ('reserved','shipped')
   and p.physical_quantity=(select (f.item->>'qty')::int from public.commerce_fulfillment_items f
                            where f.invoice_id=p.invoice_id and f.variant_key=p.variant_key)
   and l.sku_key='tirzepatide-40mg' and l.status='released'
   and d.status='verified' and d.publication_approved and d.verification_url like 'https://%'
   and not exists(select 1 from public.commerce_packed_lots other where other.invoice_id=p.invoice_id
     and other.variant_key=p.variant_key and other.lot_id<>p.lot_id)
   and (not exists(select 1 from public.commerce_fulfillment_items gift where gift.invoice_id=p.invoice_id and gift.variant_key=p.gift_variant_key)
    or (p.gift_stock_state in ('reserved','shipped') and exists(select 1
      from public.commerce_packed_lots packed join public.enterprise_inventory_lots g on g.id=packed.lot_id
      where packed.invoice_id=p.invoice_id and packed.variant_key=p.gift_variant_key and packed.lot_id=p.gift_lot_id
       and g.status='released' and g.lot_number=p.gift_lot_number and g.sku_key in ('bac-3-3-ml','gift-bac-3-3-ml'))
     and not exists(select 1 from public.commerce_packed_lots other where other.invoice_id=p.invoice_id
      and other.variant_key=p.gift_variant_key and other.lot_id<>p.gift_lot_id))))
$$;

create function public.commerce_manual_pilot_state(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
 i public.commerce_invoices; p public.commerce_manual_pilot_packs; c public.commerce_partner_commissions;
 options jsonb; gift_options jsonb; record_data jsonb; receipts bigint; commission integer; profit bigint; disputed boolean;
 missing_commission boolean; required_qty integer;
begin
 select * into i from public.commerce_invoices where id=p_invoice;
 if i.id is null or not commerce_internal.is_manual_pilot(i) then return jsonb_build_object('eligible',false); end if;
 select * into p from public.commerce_manual_pilot_packs where invoice_id=i.id;
 if i.status not in ('paid','processing','shipped','delivered') and p.invoice_id is null then return jsonb_build_object('eligible',false); end if;
 select * into c from public.commerce_partner_commissions where invoice_id=i.id;
 select exists(select 1 from public.commerce_partner_chargebacks where invoice_id=i.id) into disputed;
 select sum(case when r.kind='payment' then r.amount_cents else -r.amount_cents end) into receipts
 from public.commerce_receipts r where r.invoice_id=i.id and r.currency='USD';
 -- Taxes collected are not earnings. Hide the margin on reversals and unconfirmed or unmatched settlements.
 if disputed or i.status in ('refunded','void') or receipts is distinct from i.total_cents::bigint then receipts:=null;
 else receipts:=receipts-coalesce(i.tax_cents,0); end if;
 missing_commission:=c.id is null and (i.pricing#>>'{referral,partner_id}' is not null or exists(
   select 1 from public.commerce_referrals r where r.customer_id=i.customer_id and
     (r.first_invoice_id=i.id or r.created_at<=i.paid_at)));
 commission:=case when missing_commission then null when c.status='reversed' then 0 else coalesce(c.amount_cents,0) end;
 select (item->>'qty')::int into required_qty from public.commerce_fulfillment_items where invoice_id=i.id and variant_key='tirzepatide|40mg';

 select coalesce(jsonb_agg(jsonb_build_object('document_id',d.id,'lot_number',l.lot_number,'report_id',d.report_id,
   'lab_name',d.lab_name,'verification_url',d.verification_url) order by l.lot_number,d.report_id,d.id),'[]'::jsonb)
 into options from public.enterprise_inventory_lots l join public.enterprise_quality_documents d on d.lot_id=l.id
 where l.sku_key='tirzepatide-40mg' and l.status='released'
 and (l.id=p.lot_id or l.on_hand-l.reserved-l.damaged>=required_qty) and d.status='verified' and d.publication_approved and d.verification_url like 'https://%';
 select coalesce(jsonb_agg(jsonb_build_object('lot_number',candidate.lot_number) order by candidate.lot_number),'[]'::jsonb)
 into gift_options from (
   select l.lot_number from public.enterprise_inventory_lots l where l.sku_key in ('bac-3-3-ml','gift-bac-3-3-ml')
   and l.status='released' group by l.lot_number having count(*)=1 and bool_or(l.id=p.gift_lot_id or l.on_hand-l.reserved-l.damaged>=1)
 ) candidate;
 if p.invoice_id is not null then
  profit:=receipts-commission-p.delivered_cost_cents-p.processing_fee_cents-p.overhead_cents-p.loss_allowance_cents;
  select (to_jsonb(p)-'lot_id'-'invoice_id'-'variant_key'-'reservation_id'-'gift_lot_id'-'gift_reservation_id'-'gift_variant_key')||jsonb_build_object('lot_number',l.lot_number,'report_id',d.report_id,
    'lab_name',d.lab_name,'verification_url',case when d.status='verified' and d.publication_approved then d.verification_url end,
    'profit_cents',profit,'margin_bps',round(profit::numeric*10000/nullif(receipts,0))) into record_data
  from public.enterprise_inventory_lots l join public.enterprise_quality_documents d on d.lot_id=l.id
  where l.id=p.lot_id and d.id=p.document_id;
 end if;
 return jsonb_build_object('eligible',true,'currency','USD','lots',options,'gift_lots',gift_options,'record',record_data,
   'ready_to_ship',commerce_internal.manual_pilot_ready(i.id),
   'writable',not disputed and (i.status in ('paid','processing') or (p.invoice_id is not null and i.status in ('shipped','delivered'))),
   'receipts_cents',receipts,'commission_cents',commission,'commission_status',case when missing_commission then 'needs_review' else coalesce(c.status,'none') end);
end $$;

create function public.commerce_manual_pilot_save(p_invoice uuid,p_data jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare
 i public.commerce_invoices; old_pack public.commerce_manual_pilot_packs; d public.enterprise_quality_documents;
 l public.enterprise_inventory_lots; post_ship boolean; has_gift boolean; gift text:=nullif(btrim(p_data->>'gift_lot_number'),'');
 reserved_event uuid; gift_event uuid; gift_id uuid; gift_state text; physical_qty integer;
 ref text:=nullif(btrim(p_data->>'cost_reference'),''); rev integer:=(p_data->>'revision')::integer;
begin
 select * into i from public.commerce_invoices where id=p_invoice for update;
 if i.id is null or not commerce_internal.is_manual_pilot(i) or not commerce_internal.manual_pilot_quantities_match(i) or i.status not in ('paid','processing','shipped','delivered')
    or exists(select 1 from public.commerce_partner_chargebacks where invoice_id=i.id) then
  raise exception 'Order is ineligible for the manual pilot'; end if;
 select * into old_pack from public.commerce_manual_pilot_packs where invoice_id=i.id for update;
 if rev is distinct from coalesce(old_pack.revision,0) then raise exception 'Pilot revision changed' using errcode='40001'; end if;
 post_ship:=i.status in ('shipped','delivered') or exists(select 1 from public.commerce_fulfillment_items
   where invoice_id=i.id and status in ('shipped','delivered'));
 if post_ship and (old_pack.invoice_id is null or old_pack.document_id is distinct from (p_data->>'document_id')::uuid
    or old_pack.gift_lot_number is distinct from gift) then raise exception 'Packed lot is fixed after dispatch'; end if;
 select * into d from public.enterprise_quality_documents where id=(p_data->>'document_id')::uuid for share;
 select * into l from public.enterprise_inventory_lots where id=d.lot_id for update;
 if d.id is null or l.id is null or d.report_id is distinct from p_data->>'report_id' or l.lot_number is distinct from p_data->>'lot_number'
    or l.sku_key<>'tirzepatide-40mg' or (not post_ship and (l.status<>'released' or d.status<>'verified' or not d.publication_approved
        or coalesce(d.verification_url,'') not like 'https://%')) then
  raise exception 'A released matching lot and verified report are required'; end if;
 select exists(select 1 from public.commerce_fulfillment_items where invoice_id=i.id and variant_key='gift-bac-3|3 mL') into has_gift;
 if (gift is not null)<>has_gift then raise exception 'Confirm the physical gift lot for this order'; end if;
 select (item->>'qty')::int into physical_qty from public.commerce_fulfillment_items where invoice_id=i.id and variant_key='tirzepatide|40mg';
 reserved_event:=old_pack.reservation_id; gift_event:=old_pack.gift_reservation_id; gift_id:=old_pack.gift_lot_id; gift_state:=old_pack.gift_stock_state;
 if not post_ship then
  if old_pack.lot_id is distinct from l.id or old_pack.physical_quantity is distinct from physical_qty then
   if reserved_event is not null then
    perform public.enterprise_cancel_reservation(reserved_event,'pilot-release:'||i.id||':'||rev,'admin:manual-pilot');
   end if;
   reserved_event:=public.enterprise_reserve_inventory(l.id,physical_qty,'pilot-reserve:'||i.id||':'||(rev+1),'admin:manual-pilot');
  end if;
  if old_pack.lot_id is not null and old_pack.lot_id<>l.id then
   delete from public.commerce_packed_lots where invoice_id=i.id and variant_key='tirzepatide|40mg' and lot_id=old_pack.lot_id;
  end if;
  if exists(select 1 from public.commerce_packed_lots where invoice_id=i.id and variant_key='tirzepatide|40mg' and lot_id<>l.id) then
   raise exception 'Another compound lot is already assigned; reconcile the packed lines'; end if;
  insert into public.commerce_packed_lots(invoice_id,variant_key,lot_id) values(i.id,'tirzepatide|40mg',l.id) on conflict do nothing;
  if has_gift then
   if old_pack.gift_lot_number is not null and old_pack.gift_lot_number<>gift then
    delete from public.commerce_packed_lots a using public.enterprise_inventory_lots g where a.invoice_id=i.id
     and a.variant_key='gift-bac-3|3 mL' and a.lot_id=g.id and g.lot_number=old_pack.gift_lot_number;
   end if;
   if exists(select 1 from public.commerce_packed_lots a join public.enterprise_inventory_lots g on g.id=a.lot_id
     where a.invoice_id=i.id and a.variant_key='gift-bac-3|3 mL' and g.lot_number<>gift) then
    raise exception 'Another gift lot is already assigned'; end if;
   if not public.commerce_record_packed_lot(i.id,'gift-bac-3|3 mL',gift,false) then
    raise exception 'Gift lot must match one released 3 mL inventory lot'; end if;
   select a.lot_id into strict gift_id from public.commerce_packed_lots a
    where a.invoice_id=i.id and a.variant_key='gift-bac-3|3 mL';
   if old_pack.gift_lot_id is distinct from gift_id then
    if gift_event is not null then
     perform public.enterprise_cancel_reservation(gift_event,'pilot-gift-release:'||i.id||':'||rev,'admin:manual-pilot');
    end if;
    gift_event:=public.enterprise_reserve_inventory(gift_id,1,'pilot-gift-reserve:'||i.id||':'||(rev+1),'admin:manual-pilot');
    gift_state:='reserved';
   end if;
  end if;
 end if;
 insert into public.commerce_manual_pilot_packs(invoice_id,lot_id,document_id,reservation_id,physical_quantity,gift_lot_number,gift_lot_id,gift_reservation_id,gift_stock_state,revision,cost_reference,
  delivered_cost_cents,processing_fee_cents,overhead_cents,loss_allowance_cents)
 values(i.id,l.id,d.id,reserved_event,physical_qty,gift,gift_id,gift_event,gift_state,rev+1,ref,(p_data->>'delivered_cost_cents')::int,(p_data->>'processing_fee_cents')::int,
  (p_data->>'overhead_cents')::int,(p_data->>'loss_allowance_cents')::int)
 on conflict(invoice_id) do update set lot_id=excluded.lot_id,document_id=excluded.document_id,reservation_id=excluded.reservation_id,physical_quantity=excluded.physical_quantity,gift_lot_number=excluded.gift_lot_number,
   gift_lot_id=excluded.gift_lot_id,gift_reservation_id=excluded.gift_reservation_id,gift_stock_state=excluded.gift_stock_state,
   revision=excluded.revision,updated_at=now(),cost_reference=coalesce(excluded.cost_reference,old_pack.cost_reference),
   delivered_cost_cents=coalesce(excluded.delivered_cost_cents,old_pack.delivered_cost_cents),
   processing_fee_cents=coalesce(excluded.processing_fee_cents,old_pack.processing_fee_cents),
   overhead_cents=coalesce(excluded.overhead_cents,old_pack.overhead_cents),
   loss_allowance_cents=coalesce(excluded.loss_allowance_cents,old_pack.loss_allowance_cents);
 insert into public.commerce_events(invoice_id,action,actor,details) values(i.id,'manual_pilot_pack_saved','admin:manual-pilot',
  jsonb_build_object('revision',rev+1,'lot_id',l.id,'document_id',d.id,'costs_supplied',ref is not null));
 return true;
end $$;

-- Cover the unified order action and the older individual shipment action.
create function commerce_internal.ship_pilot_reservation(p_reservation uuid,p_reference text) returns void
language plpgsql set search_path=pg_catalog as $$
declare e public.enterprise_inventory_events;
begin
 select * into strict e from public.enterprise_inventory_events where id=p_reservation and event_kind='reserve';
 update public.enterprise_inventory_lots set reserved=reserved-e.quantity,on_hand=on_hand-e.quantity,updated_at=now()
 where id=e.lot_id and status='released' and reserved>=e.quantity and on_hand-damaged>=e.quantity;
 if not found then raise exception 'Recorded lot no longer has reserved units'; end if;
 insert into public.enterprise_inventory_events(lot_id,event_kind,quantity,idempotency_key,actor_reference,reason)
 values(e.lot_id,'ship',e.quantity,p_reference,'admin:manual-pilot','reservation:'||p_reservation);
end $$;
create function commerce_internal.guard_manual_pilot_dispatch() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.commerce_invoices; p public.commerce_manual_pilot_packs; consume_key text;
begin
 if tg_table_name='commerce_invoices' then i:=old;
 else
  select * into i from public.commerce_invoices where id=old.invoice_id for update;
  consume_key:=old.variant_key;
 end if;
 if commerce_internal.is_manual_pilot(i) and (not commerce_internal.manual_pilot_ready(i.id) or
     exists(select 1 from public.commerce_partner_chargebacks where invoice_id=i.id)) then
  raise exception 'Record the pilot parcel and verified lot report before dispatch'; end if;
 select * into p from public.commerce_manual_pilot_packs where invoice_id=i.id for update;
 if (consume_key is null or consume_key=p.variant_key) and p.stock_state='reserved' then
  perform commerce_internal.ship_pilot_reservation(p.reservation_id,'pilot-dispatch:'||i.id);
  update public.commerce_manual_pilot_packs set stock_state='shipped' where invoice_id=i.id;
 end if;
 if (consume_key is null or consume_key=p.gift_variant_key) and p.gift_stock_state='reserved' then
  perform commerce_internal.ship_pilot_reservation(p.gift_reservation_id,'pilot-gift-dispatch:'||i.id);
  update public.commerce_manual_pilot_packs set gift_stock_state='shipped' where invoice_id=i.id;
 end if;
 return new;
end $$;
create trigger manual_pilot_invoice_dispatch before update of status on public.commerce_invoices for each row
 when (new.status in ('shipped','delivered') and old.status not in ('shipped','delivered'))
 execute function commerce_internal.guard_manual_pilot_dispatch();
create trigger manual_pilot_line_dispatch before update of status on public.commerce_fulfillment_items for each row
 when (new.status in ('shipped','delivered') and old.status not in ('shipped','delivered'))
 execute function commerce_internal.guard_manual_pilot_dispatch();

-- A paid order can reverse before or after the parcel leaves. Only unshipped reservations are released.
create function commerce_internal.release_manual_pilot_pack() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.commerce_manual_pilot_packs; target uuid;
begin
 if tg_table_name='commerce_partner_chargebacks' then target:=new.invoice_id; else target:=new.id; end if;
 select * into p from public.commerce_manual_pilot_packs where invoice_id=target for update;
 if p.stock_state='reserved' then
  perform public.enterprise_cancel_reservation(p.reservation_id,'pilot-reversal:'||target,'admin:manual-pilot');
  update public.commerce_manual_pilot_packs set stock_state='released' where invoice_id=target;
 end if;
 if p.gift_stock_state='reserved' then
  perform public.enterprise_cancel_reservation(p.gift_reservation_id,'pilot-gift-reversal:'||target,'admin:manual-pilot');
  update public.commerce_manual_pilot_packs set gift_stock_state='released' where invoice_id=target;
 end if;
 return new;
end $$;
create trigger manual_pilot_invoice_reversal after update of status on public.commerce_invoices for each row
 when (new.status in ('refunded','void') and old.status is distinct from new.status) execute function commerce_internal.release_manual_pilot_pack();
create trigger manual_pilot_dispute after insert on public.commerce_partner_chargebacks for each row execute function commerce_internal.release_manual_pilot_pack();
revoke all on function commerce_internal.release_manual_pilot_pack() from public,anon,authenticated,service_role;

revoke all on function public.commerce_manual_pilot_state(uuid),public.commerce_manual_pilot_save(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_manual_pilot_state(uuid),public.commerce_manual_pilot_save(uuid,jsonb) to service_role;
revoke all on function commerce_internal.is_manual_pilot(public.commerce_invoices),commerce_internal.manual_pilot_quantities_match(public.commerce_invoices),commerce_internal.manual_pilot_ready(uuid),
 commerce_internal.ship_pilot_reservation(uuid,text),commerce_internal.guard_manual_pilot_dispatch() from public,anon,authenticated,service_role;
