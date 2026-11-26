-- Purchased gift value is a separate liability until a verified recipient claims it.
create table public.pure_gift_orders (
 id uuid primary key,
 purchaser_id uuid not null, purchaser_email text not null,
 recipient_email text not null, recipient_name text not null default '', note text not null default '',
 amount_cents integer not null check (amount_cents between 2500 and 100000),
 send_date date not null, digest text not null check (digest ~ '^[a-f0-9]{64}$'),
 method_id uuid not null references public.commerce_payment_methods(id), payment jsonb not null,
 status text not null default 'pending' check (status in ('pending','funded','claimed','refund_pending','refunded','cancelled')),
 payment_reference text, refund_reference text, claimed_by uuid, claimed_at timestamptz, funded_at timestamptz,
 notification_status text not null default 'waiting' check (notification_status in ('waiting','failed','accepted','review')),
 notification_id text, notification_lease uuid, first_attempt_at timestamptz, notification_round integer not null default 0, notify_after timestamptz not null default now(),
 debit_serial_at_claim bigint, refunded_at timestamptz, created_at timestamptz not null default now(),
 check (char_length(recipient_name)<=80 and char_length(note)<=250),
 check (char_length(recipient_email) between 3 and 254 and recipient_email=lower(trim(recipient_email))),
 check (char_length(purchaser_email) between 3 and 254 and purchaser_email=lower(trim(purchaser_email)))
);
create index pure_gift_purchaser on public.pure_gift_orders(purchaser_id,created_at desc);
create index pure_gift_recipient on public.pure_gift_orders(recipient_email,send_date);
create index pure_gift_admin_queue on public.pure_gift_orders(status,created_at desc);
create unique index pure_gift_payment_receipt on public.pure_gift_orders(method_id,lower(payment_reference)) where payment_reference is not null;
create unique index pure_gift_refund_receipt on public.pure_gift_orders(method_id,lower(refund_reference)) where refund_reference is not null;
alter table public.pure_gift_orders enable row level security;
revoke all on public.pure_gift_orders from public, anon, authenticated, service_role;
grant select on public.pure_gift_orders to service_role;

-- Record debit order under the existing account row lock, including debits by older transactions.
alter table public.commerce_balance_accounts add column gift_debit_serial bigint not null default 0;
create function commerce_internal.count_gift_debits() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 new.gift_debit_serial:=old.gift_debit_serial+1;
 return new;
end $$;
create trigger pure_gift_debit_serial before update of credit_cents on public.commerce_balance_accounts
 for each row when (new.credit_cents<old.credit_cents) execute function commerce_internal.count_gift_debits();
revoke all on function commerce_internal.count_gift_debits() from public,anon,authenticated,service_role;

-- Bank transactions share a reference namespace with ordinary store payments.
-- Serialize the cross-table check even if an administrator submits both at once.
create function commerce_internal.check_gift_bank_reference(p_method uuid,p_ref text)
returns void language plpgsql set search_path=pg_catalog,pg_temp as $$
declare ref text:=lower(trim(p_ref));
begin
 perform pg_advisory_xact_lock(hashtextextended('pure-bank:'||p_method::text||':'||ref,0));
 if exists(select 1 from public.pure_gift_orders where method_id=p_method and
    (lower(payment_reference)=ref or lower(refund_reference)=ref)) then
   raise exception 'Bank reference already recorded' using errcode='23505';
 end if;
end $$;
create function commerce_internal.check_ordinary_gift_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from public.commerce_payment_methods where id=new.method_id and kind='bank_transfer') then
   perform commerce_internal.check_gift_bank_reference(new.method_id,new.external_reference);
 end if;
 return new;
end $$;
create trigger pure_shared_bank_reference before insert or update of method_id,external_reference on public.commerce_receipts
 for each row execute function commerce_internal.check_ordinary_gift_receipt();
revoke all on function commerce_internal.check_gift_bank_reference(uuid,text),commerce_internal.check_ordinary_gift_receipt() from public,anon,authenticated,service_role;

create function public.pure_gift_create(p_data jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare uid uuid:=(p_data->>'purchaser_id')::uuid; g public.pure_gift_orders%rowtype; m public.commerce_payment_methods%rowtype;
 oid uuid:=(p_data->>'id')::uuid; send_on date:=(p_data->>'send_date')::date; utc_today date:=(now() at time zone 'UTC')::date;
begin
 if coalesce(p_data->>'consent','')<>'true' or uid is null or oid is null then raise exception 'Gift order consent required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('gift-customer:'||uid::text,0));
 select * into g from public.pure_gift_orders where id=oid;
 if found then
   if g.purchaser_id<>uid or g.digest is distinct from p_data->>'digest' then raise exception 'Request details changed' using errcode='23505'; end if;
   return oid;
 end if;
 if send_on is null or send_on not between utc_today and utc_today+28 then raise exception 'Choose a date within 28 days' using errcode='22023'; end if;
 if (select count(*) from public.pure_gift_orders where purchaser_id=uid and status='pending' and created_at>now()-interval '24 hours')>=10 then
   raise exception 'Too many pending gift orders' using errcode='P0001';
 end if;
 select * into m from public.commerce_payment_methods where id=(p_data->>'method_id')::uuid and active and currency='USD'
  and kind='bank_transfer' and provider_key='bank_transfer' and native_provider is null and sale_scope='both' for share;
 if not found then raise exception 'USD bank transfer unavailable' using errcode='P0001'; end if;
 insert into public.pure_gift_orders(id,purchaser_id,purchaser_email,recipient_email,recipient_name,note,amount_cents,send_date,digest,method_id,payment)
 values(oid,uid,p_data->>'purchaser_email',p_data->>'recipient_email',coalesce(p_data->>'recipient_name',''),coalesce(p_data->>'note',''),
   (p_data->>'amount_cents')::int,send_on,p_data->>'digest',m.id,jsonb_build_object('payee',m.payee,'instructions',m.instructions,'label',m.label,'version',m.version));
 return oid;
end $$;

create function public.pure_gift_transition(p_id uuid,p_action text,p_data jsonb)
returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare g public.pure_gift_orders%rowtype; ref text:=trim(p_data->>'reference'); uid uuid; credits integer; serial bigint;
begin
 select * into g from public.pure_gift_orders where id=p_id for update;
 if not found then raise exception 'Gift order not found' using errcode='P0002'; end if;
 if p_action in ('fund','refund_finish') then
   if p_data->>'confirmed' is distinct from 'true' or p_data->>'currency' is distinct from 'USD'
      or (p_data->>'amount_cents')::integer is distinct from g.amount_cents or ref is null or char_length(ref) not between 6 and 150 then
     raise exception 'Confirm the exact USD amount and bank reference' using errcode='22023';
   end if;
   if (p_action='fund' and g.payment_reference=ref) or (p_action='refund_finish' and g.refund_reference=ref) then return g.status; end if;
   if (p_action='fund' and g.status<>'pending') or (p_action='refund_finish' and g.status<>'refund_pending') then
     raise exception 'This order has changed' using errcode='P0001'; end if;
   perform commerce_internal.check_gift_bank_reference(g.method_id,ref);
   if exists(select 1 from public.commerce_receipts where method_id=g.method_id and lower(trim(external_reference))=lower(ref)) then
     raise exception 'Bank reference already recorded' using errcode='23505'; end if;
   if p_action='fund' then
     update public.pure_gift_orders set status='funded',payment_reference=ref,funded_at=now() where id=p_id;
     return 'funded';
   end if;
   update public.pure_gift_orders set status='refunded',refund_reference=ref,refunded_at=now() where id=p_id;
   return 'refunded';
 elsif p_action='cancel' then
   if (p_data->>'customer_id')::uuid is distinct from g.purchaser_id then raise exception 'Gift order not found' using errcode='P0002'; end if;
   if p_data->>'confirmed' is distinct from 'true' or g.status not in ('pending','cancelled') then raise exception 'Only unpaid orders can be cancelled' using errcode='P0001'; end if;
   update public.pure_gift_orders set status='cancelled' where id=p_id;
   return 'cancelled';
 elsif p_action='claim' then
   uid:=(p_data->>'customer_id')::uuid;
   if uid is null or lower(trim(p_data->>'email')) is distinct from g.recipient_email then raise exception 'Gift not available' using errcode='P0002'; end if;
   if g.status='claimed' and g.claimed_by=uid then return 'claimed'; end if;
   if g.status<>'funded' or g.send_date>(now() at time zone 'UTC')::date then raise exception 'Gift not available to claim' using errcode='P0001'; end if;
   insert into public.commerce_balance_accounts(customer_id) values(uid) on conflict do nothing;
   select gift_debit_serial into serial from public.commerce_balance_accounts where customer_id=uid for update;
   perform commerce_internal.balance_event(uid,null,'credit',g.amount_cents,'Purchased gift card','gift-claim:'||p_id::text,'customer:'||uid::text);
   update public.pure_gift_orders set status='claimed',claimed_by=uid,claimed_at=now(),debit_serial_at_claim=serial where id=p_id;
   return 'claimed';
 elsif p_action='refund_start' then
   if p_data->>'confirmed' is distinct from 'true' then raise exception 'Confirm the refund hold' using errcode='22023'; end if;
   if g.status in ('refund_pending','refunded') then return g.status; end if;
   if g.status not in ('funded','claimed') then raise exception 'No funded gift to refund' using errcode='P0001'; end if;
   if g.notification_lease is not null and g.notify_after>now() then raise exception 'Gift email in progress. Retry the refund in two minutes.' using errcode='P0001'; end if;
   if g.claimed_by is not null then
     select credit_cents,gift_debit_serial into credits,serial from public.commerce_balance_accounts where customer_id=g.claimed_by for update;
     if credits is null or credits < g.amount_cents or serial is distinct from g.debit_serial_at_claim then
       raise exception 'Credit has been spent. Review the ledger before any refund.' using errcode='P0001';
     end if;
     perform commerce_internal.balance_event(g.claimed_by,null,'credit',-g.amount_cents,'Gift card refund reserved','gift-refund:'||p_id::text,'gift-admin');
   end if;
   update public.pure_gift_orders set status='refund_pending' where id=p_id;
   return 'refund_pending';
 elsif p_action='notify_claim' then
   if g.notification_status in ('accepted','review') or g.status not in ('funded','claimed') or g.send_date>(now() at time zone 'UTC')::date or g.notify_after>now() then return 'skip'; end if;
   if g.first_attempt_at<now()-interval '23 hours' then
     update public.pure_gift_orders set notification_status='review',notification_lease=null where id=p_id;
     return 'review';
   end if;
   update public.pure_gift_orders set notification_lease=(p_data->>'lease')::uuid,first_attempt_at=coalesce(first_attempt_at,now()),
     notify_after=now()+interval '2 minutes' where id=p_id;
   return 'send';
 elsif p_action='notify_reset' then
   if p_data->>'confirmed' is distinct from 'true' or g.notification_status<>'review' then raise exception 'Verify prior email delivery first' using errcode='P0001'; end if;
   update public.pure_gift_orders set notification_status='waiting',notification_lease=null,first_attempt_at=null,
     notification_round=notification_round+1,notify_after=now() where id=p_id;
   return g.status;
 elsif p_action in ('notify_accepted','notify_failed') then
   if g.notification_lease is null or g.notification_lease is distinct from (p_data->>'lease')::uuid then return g.status; end if;
   if p_action='notify_accepted' and coalesce(char_length(p_data->>'provider_id'),0) not between 1 and 200 then raise exception 'Email receipt missing' using errcode='22023'; end if;
   update public.pure_gift_orders set notification_status=case when p_action='notify_accepted' then 'accepted' else 'failed' end,
     notification_id=p_data->>'provider_id',notification_lease=null,notify_after=now()+interval '10 minutes' where id=p_id;
   return g.status;
 end if;
 raise exception 'Invalid gift card action' using errcode='22023';
end $$;
revoke all on function public.pure_gift_create(jsonb),public.pure_gift_transition(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pure_gift_create(jsonb),public.pure_gift_transition(uuid,text,jsonb) to service_role;
-- Wake the signed-worker transport only when a paid gift email is due.
create index pure_gift_due_mail on public.pure_gift_orders(notify_after,send_date)
 where notification_status in ('waiting','failed') and status in ('funded','claimed');
create function commerce_internal.dispatch_due_gift_mail()
returns bigint language plpgsql set search_path=pg_catalog,pg_temp as $$
declare signing_key text; ts text; nonce text; signature text;
begin
 if not exists(select 1 from public.pure_gift_orders where notification_status in ('waiting','failed') and status in ('funded','claimed')
    and send_date<=(now() at time zone 'UTC')::date and notify_after<=now()) then return null; end if;
 select decrypted_secret into signing_key from vault.decrypted_secrets where name='altapure_invoice_worker';
 if coalesce(length(signing_key),0)<32 then return null; end if;
 ts:=floor(extract(epoch from clock_timestamp()))::bigint::text;
 nonce:=gen_random_uuid()::text;
 signature:=encode(extensions.hmac(convert_to('gift-email-retry'||chr(10)||ts||chr(10)||nonce,'UTF8'),convert_to(signing_key,'UTF8'),'sha256'),'hex');
 return net.http_post(url:='https://getpurelabs.com/api/customer-config?gift_order=worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-commerce-job-time',ts,'x-commerce-job-nonce',nonce,'x-commerce-job-signature',signature),
 body:='{}'::jsonb,timeout_milliseconds:=55000);
end $$;
revoke all on function commerce_internal.dispatch_due_gift_mail() from public,anon,authenticated,service_role;
select cron.schedule('pure-paid-gift-delivery','*/5 * * * *','select commerce_internal.dispatch_due_gift_mail()');
create function public.pure_gift_delivery_ready() returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from cron.job where jobname='pure-paid-gift-delivery' and active)
 and exists(select 1 from vault.decrypted_secrets where name='altapure_invoice_worker' and length(decrypted_secret)>=32)
$$;
revoke all on function public.pure_gift_delivery_ready() from public,anon,authenticated;
grant execute on function public.pure_gift_delivery_ready() to service_role;
