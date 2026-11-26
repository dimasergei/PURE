-- The builder's three-delivery term applies only to explicitly accepted v2 plans.
alter table public.pure_repeat_plans drop constraint pure_repeat_plans_status_check,
  add constraint pure_repeat_plans_status_check check (status in ('active','paused','canceled','completed'));

alter table commerce_internal.repeat_invoice_cycles
  add column shipped_at timestamptz,
  add column delivered_at timestamptz;

create function commerce_internal.repeat_term_can_edit(p_id uuid, p_status text, p_cycle integer)
returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
  select p_status='active' and p_cycle<3 and exists (
    select 1 from commerce_internal.repeat_invoice_cycles
    where plan_id=p_id and cycle=1 and shipped_at is not null
  );
$$;

create function commerce_internal.repeat_term_can_cancel(p_status text, p_invoice_status text, p_expires_at timestamptz)
returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
  select p_status='paused' or (p_status='active' and coalesce(
    p_invoice_status in ('void','refunded') or (p_invoice_status='accepted' and p_expires_at<=now()), false
  ));
$$;

create function commerce_internal.record_repeat_term_delivery()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare term_id uuid;
begin
  select p.id into term_id from commerce_internal.repeat_invoice_cycles c
  join public.pure_repeat_plans p on p.id=c.plan_id
  where c.invoice_id=new.id and p.snapshot->>'terms'='pure-monthly-invoice-v2'
  for update of p;
  if not found then return new; end if;

  update commerce_internal.repeat_invoice_cycles
  set shipped_at=coalesce(shipped_at,now()),
      delivered_at=case when new.status='delivered' then coalesce(delivered_at,now()) else delivered_at end
  where invoice_id=new.id;

  if new.status='delivered' and (select count(*) from commerce_internal.repeat_invoice_cycles
     where plan_id=term_id and delivered_at is not null)=3 then
    update public.pure_repeat_plans
    set status='completed', version=version+1, pause_reason=null
    where id=term_id and status='active';
  end if;
  return new;
end $$;

create trigger record_repeat_term_delivery after update of status on public.commerce_invoices for each row
when (new.status in ('shipped','delivered') and new.status is distinct from old.status)
execute function commerce_internal.record_repeat_term_delivery();

revoke all on function commerce_internal.repeat_term_can_edit(uuid,text,integer),
  commerce_internal.repeat_term_can_cancel(text,text,timestamptz),
  commerce_internal.record_repeat_term_delivery() from public,anon,authenticated,service_role;

-- Retain the installed invoice validation, idempotency, and payment-choice rules.
do $migration$
declare
  save_sql text:=pg_get_functiondef('public.pure_repeat_save(uuid,uuid,text,jsonb,text,integer)'::regprocedure);
  issue_sql text:=pg_get_functiondef('commerce_internal.issue_repeat_invoice(uuid)'::regprocedure);
  save_terms text:=$marker$p_snapshot->>'terms' is distinct from 'pure-monthly-invoice-v1'$marker$;
  save_open text:=$marker$   if (select count(*) from public.pure_repeat_plans where customer_id=p_owner and status<>'canceled')>=10$marker$;
  save_edit text:=$marker$   update public.pure_repeat_plans set snapshot=p_snapshot,customer_email=p_email,version=version+1 where id=p.id;$marker$;
  issue_active text:=$marker$if p.status<>'active' then$marker$;
  issue_cycle text:=$marker$insert into commerce_internal.repeat_invoice_cycles values(p.id,p.cycle+1,invoice);$marker$;
begin
  if strpos(save_sql,save_terms)=0 or strpos(save_sql,save_open)=0 or strpos(save_sql,save_edit)=0
     or strpos(issue_sql,issue_active)=0 or strpos(issue_sql,issue_cycle)=0 then
    raise exception 'Unexpected installed monthly invoice functions';
  end if;

  save_sql:=replace(save_sql,save_terms,$new$
  (p_snapshot->>'terms' is distinct from 'pure-monthly-invoice-v1'
    and not coalesce(p_snapshot->>'terms'='pure-monthly-invoice-v2'
        and p_snapshot->>'kind'='builder' and p_snapshot->>'payment_choice'='per_invoice',false))$new$);
  save_sql:=replace(save_sql,save_open,$new$
   if p_snapshot->>'terms'='pure-monthly-invoice-v2' and exists (
     select 1 from public.pure_repeat_plans
     where customer_id=p_owner and snapshot->>'terms'='pure-monthly-invoice-v2' and status in ('active','paused')
   ) then raise exception 'Finish the current three-delivery term first' using errcode='P3S01'; end if;
   if (select count(*) from public.pure_repeat_plans where customer_id=p_owner and status in ('active','paused'))>=10$new$);
  save_sql:=replace(save_sql,save_edit,$new$
   if p.snapshot->>'terms' is distinct from p_snapshot->>'terms' then
     raise exception 'The original plan terms must be retained' using errcode='40001';
   end if;
   if p.snapshot->>'terms'='pure-monthly-invoice-v2'
     and not commerce_internal.repeat_term_can_edit(p.id,p.status,p.cycle) then
     raise exception 'Selections can be changed after the first shipment and before the final invoice' using errcode='P3S02';
   end if;
   update public.pure_repeat_plans set snapshot=p_snapshot,customer_email=p_email,version=version+1 where id=p.id;$new$);
  execute save_sql;

  issue_sql:=replace(issue_sql,issue_active,$new$if p.status<>'active' or (p.snapshot->>'terms'='pure-monthly-invoice-v2' and p.cycle>=3) then$new$);
  issue_sql:=replace(issue_sql,issue_cycle,$new$insert into commerce_internal.repeat_invoice_cycles(plan_id,cycle,invoice_id) values(p.id,p.cycle+1,invoice);$new$);
  execute issue_sql;
end $migration$;

create or replace function public.pure_repeat_manage(p_owner uuid,p_id uuid,p_action text,p_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p public.pure_repeat_plans%rowtype; prior public.commerce_invoices%rowtype;
begin
 select * into p from public.pure_repeat_plans where id=p_id and customer_id=p_owner for update;
 if not found then raise exception 'Plan not found' using errcode='P0002';end if;
 if p_version is distinct from p.version or p.status in ('canceled','completed') or coalesce(p_action,'') not in ('pause','resume','cancel','skip')
   or (p_action='resume' and p.status<>'paused') or (p_action in ('skip','pause') and p.status<>'active')
 then raise exception 'Plan changed' using errcode='40001';end if;
 if p.snapshot->>'terms'='pure-monthly-invoice-v2' then
   select * into prior from public.commerce_invoices where id=p.latest_invoice_id;
   if p_action<>'cancel' or not commerce_internal.repeat_term_can_cancel(p.status,prior.status,prior.expires_at) then
     raise exception 'The three-delivery term ends automatically after its last delivery' using errcode='P3S03';
   end if;
 end if;
 update public.pure_repeat_plans set
   status=case p_action when 'cancel' then 'canceled' when 'pause' then 'paused' else 'active' end,
   next_due_at=case when p_action='skip' then greatest(next_due_at,now())+interval '1 month'
                    when p_action='resume' then now()+interval '1 month' else next_due_at end,
   resumed_unpaid=case when p_action='resume' then true else resumed_unpaid end,
   version=version+1,pause_reason=case when p_action='pause' then 'Paused by customer' else null end
 where id=p.id;
 return jsonb_build_object('updated',true);
end $$;

create or replace function public.pure_repeat_list(p_owner uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,
   'next_due_at',case when p.snapshot->>'terms'='pure-monthly-invoice-v2' and p.cycle>=3 then null else p.next_due_at end,
   'version',p.version,'snapshot',p.snapshot,'pause_reason',p.pause_reason,'invoice_id',p.latest_invoice_id,
   'invoice_status',i.status,'expires_at',i.expires_at)
   || case when p.snapshot->>'terms'='pure-monthly-invoice-v2' then jsonb_build_object(
    'cycle',p.cycle,'delivered_count',(select count(*) from commerce_internal.repeat_invoice_cycles
      where plan_id=p.id and delivered_at is not null),
    'can_edit',commerce_internal.repeat_term_can_edit(p.id,p.status,p.cycle),
    'can_cancel',commerce_internal.repeat_term_can_cancel(p.status,i.status,i.expires_at),
    'can_restart',p.status in ('completed','canceled')) else '{}'::jsonb end
   order by p.created_at desc),'[]'::jsonb) from public.pure_repeat_plans p
 left join public.commerce_invoices i on i.id=p.latest_invoice_id where p.customer_id=p_owner;
$$;

create or replace function commerce_internal.process_repeat_invoices()
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p record; prior public.commerce_invoices%rowtype;
begin
 for p in select id,latest_invoice_id,resumed_unpaid,snapshot from public.pure_repeat_plans
   where status='active' and next_due_at<=now()
     and (snapshot->>'terms' is distinct from 'pure-monthly-invoice-v2' or cycle<3)
   order by next_due_at limit 100 for update skip locked loop
   select * into prior from public.commerce_invoices where id=p.latest_invoice_id;
   if (p.snapshot->>'terms'='pure-monthly-invoice-v2' and not coalesce(prior.status in ('paid','processing','shipped','delivered'),false))
      or (prior.status not in ('paid','processing','shipped','delivered') and not p.resumed_unpaid
          and p.snapshot->>'payment_choice' is distinct from 'per_invoice') then
     update public.pure_repeat_plans set status='paused',version=version+1,pause_reason='Previous invoice unpaid or reversed' where id=p.id;
   else
     begin
       perform commerce_internal.issue_repeat_invoice(p.id);
     exception when sqlstate 'P0001' then
       update public.pure_repeat_plans set status='paused',version=version+1,pause_reason='Review payment or delivery method' where id=p.id;
     end;
   end if;
 end loop;
end $$;
