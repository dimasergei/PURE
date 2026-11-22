create table public.commerce_partner_chargebacks (
  invoice_id uuid primary key references public.commerce_invoices(id),
  processor_reference text not null unique,
  recorded_at timestamptz not null default now()
);
alter table public.commerce_partner_chargebacks enable row level security;
revoke all on public.commerce_partner_chargebacks from public, anon, authenticated, service_role;

create function public.commerce_reverse_partner_chargeback(p_invoice uuid, p_reference text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  pid uuid;
  prior_reference text;
begin
  if length(btrim(coalesce(p_reference,''))) not between 8 and 180 then
    raise exception 'Invalid chargeback reference' using errcode='22023';
  end if;
  perform 1 from public.commerce_invoices where id=p_invoice for update;
  select partner_id into pid from public.commerce_partner_commissions where invoice_id=p_invoice;
  if pid is null then
    raise exception 'No commission for this invoice' using errcode='22023';
  end if;
  perform 1 from public.commerce_partners where customer_id=pid for update;
  select processor_reference into prior_reference from public.commerce_partner_chargebacks where invoice_id=p_invoice;
  if prior_reference is not null and prior_reference <> btrim(p_reference) then
    raise exception 'Chargeback already recorded' using errcode='23505';
  end if;
  insert into public.commerce_partner_chargebacks(invoice_id,processor_reference)
    values(p_invoice,btrim(p_reference)) on conflict(invoice_id) do nothing;
  update public.commerce_partner_commissions set status='reversed'
    where invoice_id=p_invoice and status<>'reversed';
  return jsonb_build_object('invoice_id',p_invoice,'status','reversed');
end $$;
revoke all on function public.commerce_reverse_partner_chargeback(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.commerce_reverse_partner_chargeback(uuid,text) to service_role;
