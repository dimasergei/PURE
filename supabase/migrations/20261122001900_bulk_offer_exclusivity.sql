-- Bulk tiers share the existing invoice arithmetic, benefits, and referral validator.
-- Apply volume savings only on new bulk purchases under the current per-compound policy.
create function commerce_internal.validate_bulk_offer()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if new.request_data->'bulk_order' is distinct from 'true'::jsonb
    or new.pricing->>'quantity_discount_version' is distinct from 'pure-bulk-2026-11-v2'
    or new.request_data->'checkout'->>'coupon' is distinct from ''
    or new.request_data->'checkout' ? 'affiliate_code'
    or new.pricing->>'coupon_code' is distinct from ''
    or new.pricing ?| array['bogo_campaign','affiliate_code']
    or new.pricing->>'discount_source' is distinct from 'quantity'
    or new.pricing->'quantity_discount_cents' is distinct from to_jsonb(new.discount_cents)
    or new.pricing->'coupon_discount_cents' is distinct from '0'::jsonb
    or new.pricing->'membership_discount_cents' is distinct from '0'::jsonb
    or new.pricing->'crypto_discount_cents' is distinct from '0'::jsonb
    or new.pricing->'bogo_free_units' is distinct from '0'::jsonb
  then
    raise exception 'Bulk pricing cannot be combined with other merchandise offers' using errcode='22023';
  end if;
  return new;
end $$;

revoke all on function commerce_internal.validate_bulk_offer() from public,anon,authenticated,service_role;
create trigger commerce_validate_bulk_offer before insert on public.commerce_invoices
for each row when (
  new.kind='goods' and (new.request_data->'bulk_order'='true'::jsonb or new.pricing ? 'quantity_discount_version')
  and new.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2')
) execute function commerce_internal.validate_bulk_offer();
