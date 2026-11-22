-- Human quality review for the two stock SKUs used in the US manual pilot.
-- An individually authenticated database login is provisioned separately by the owner.
create schema pure_pilot_quality;
revoke all on schema pure_pilot_quality from public, anon, authenticated, service_role;

create table pure_pilot_quality.reviewers (
  database_login name primary key,
  reviewer_name text not null check (length(btrim(reviewer_name)) between 3 and 160),
  check (database_login not in ('postgres','authenticator','anon','authenticated','service_role','dashboard_user')
         and database_login::text !~ '^(supabase_|pg_)')
);
create table pure_pilot_quality.releases (
  document_id uuid primary key references public.enterprise_quality_documents(id),
  lot_id uuid not null references public.enterprise_inventory_lots(id),
  sku_key text not null,
  lot_number text not null,
  report_id text not null,
  lab_name text not null,
  report_url text not null,
  report_date date not null,
  review_evidence text not null,
  database_login name not null,
  reviewer_name text not null,
  reviewed_at timestamptz not null
);
alter table pure_pilot_quality.reviewers enable row level security;
alter table pure_pilot_quality.releases enable row level security;
revoke all on all tables in schema pure_pilot_quality from public, anon, authenticated, service_role;

create function pure_pilot_quality.release_received_lot(
  p_lot uuid, p_document uuid, p_sku text, p_printed_lot text,
  p_report_id text, p_report_date date, p_review_evidence text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare
  signer text;
  lot public.enterprise_inventory_lots%rowtype;
  doc public.enterprise_quality_documents%rowtype;
  prior pure_pilot_quality.releases%rowtype;
  review_time timestamptz := transaction_timestamp();
begin
  -- session_user is the authenticated connection identity even inside SECURITY DEFINER.
  -- The operator cannot supply a reviewer's name as a function argument.
  select reviewer_name into signer from pure_pilot_quality.reviewers
  where database_login=session_user for share;
  if not found then raise exception 'An individually authorized pilot reviewer login is required.' using errcode='42501'; end if;

  if p_sku is null or p_sku not in ('tirzepatide-40mg','bac-3-3-ml')
     or p_printed_lot is null or p_printed_lot='DEMO-NOT-A-REAL-LOT'
     or p_report_date is null or not isfinite(p_report_date) or p_report_date>current_date
     or p_review_evidence is null or length(btrim(p_review_evidence)) not between 12 and 500 then
    raise exception 'Provide the exact pilot SKU, lot, report date and independent review evidence.' using errcode='22023';
  end if;

  select * into lot from public.enterprise_inventory_lots where id=p_lot for update;
  if not found or lot.sku_key is distinct from p_sku or lot.lot_number is distinct from p_printed_lot
     or nullif(btrim(lot.evidence_reference),'') is null then
    raise exception 'Receipt or physical lot does not match the selected inventory row.' using errcode='22023';
  end if;
  select * into doc from public.enterprise_quality_documents where id=p_document for update;
  if not found or doc.lot_id is distinct from lot.id or doc.report_id is distinct from p_report_id
     or doc.verification_url is null or doc.verification_url !~ '^https://[^/[:space:]]+/'
     or (doc.report_date is not null and doc.report_date<>p_report_date) then
    raise exception 'Report identity and date must match this received lot.' using errcode='22023';
  end if;

  select * into prior from pure_pilot_quality.releases where document_id=p_document;
  if found then
    if prior.review_evidence=btrim(p_review_evidence) and prior.report_date=p_report_date
       and doc.status='verified' and doc.publication_approved and lot.status='released' then
      return;
    end if;
    raise exception 'Existing review changed or was withdrawn. Inspect its audit record.' using errcode='P0001';
  end if;
  if lot.status not in ('quarantine','released') or lot.on_hand <= lot.damaged
     or doc.status<>'pending' or doc.publication_approved then
    raise exception 'A received, usable pilot lot and a pending report are required.' using errcode='P0001';
  end if;

  insert into pure_pilot_quality.releases
    (document_id,lot_id,sku_key,lot_number,report_id,lab_name,report_url,report_date,review_evidence,database_login,reviewer_name,reviewed_at)
  values (doc.id,lot.id,lot.sku_key,lot.lot_number,doc.report_id,doc.lab_name,doc.verification_url,p_report_date,
          btrim(p_review_evidence),session_user,signer,review_time);
  update public.enterprise_quality_documents set status='verified',publication_approved=true,
    report_date=p_report_date,reviewer=signer,reviewed_at=review_time where id=doc.id;
  if lot.status='quarantine' then
    update public.enterprise_inventory_lots set status='released',reviewed_by=signer,
      reviewed_at=review_time,updated_at=review_time where id=lot.id;
  end if;
end $$;
revoke all on function pure_pilot_quality.release_received_lot(uuid,uuid,text,text,text,date,text)
  from public, anon, authenticated, service_role;
