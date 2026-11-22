-- Existing references remain usable. New orders receive a single public reference.
create sequence commerce_internal.public_order_sequence
  as integer start with 1000 maxvalue 99999999 no cycle;

alter table public.commerce_invoices
  add column public_order_number text unique
  check (public_order_number ~ '^P[0-9]{8}$');

create function commerce_internal.assign_public_order_number()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if new.public_order_number is distinct from old.public_order_number then
      raise exception 'Order numbers cannot be changed';
    end if;
    return new;
  end if;
  new.public_order_number := 'P' || lpad(nextval('commerce_internal.public_order_sequence')::text, 8, '0');
  return new;
end
$$;
revoke all on function commerce_internal.assign_public_order_number() from public, anon, authenticated;
create trigger assign_public_order_number
  before insert or update of public_order_number on public.commerce_invoices
  for each row execute function commerce_internal.assign_public_order_number();

create function commerce_internal.snapshot_public_order_number()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare reference text;
begin
  select public_order_number into reference from public.commerce_invoices where id=new.invoice_id;
  if reference is not null then
    new.snapshot := new.snapshot || jsonb_build_object('public_order_number', reference);
  end if;
  return new;
end
$$;
revoke all on function commerce_internal.snapshot_public_order_number() from public, anon, authenticated;
create trigger snapshot_public_order_number
  before insert on public.commerce_notifications
  for each row execute function commerce_internal.snapshot_public_order_number();
