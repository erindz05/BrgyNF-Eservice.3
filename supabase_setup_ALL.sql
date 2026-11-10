-- =====================================================================
--  ALL-IN-ONE SETUP (v4).  Run this ONE file in Supabase > SQL Editor.
--  It works on an empty project AND on one that already has the old tables.
--  Safe to re-run. You do NOT need the older setup files first.
-- =====================================================================

-- PART A: base tables (applications, admins, fees, uploads bucket) ------
create table if not exists public.clearances (
    id            bigint generated always as identity primary key,
    serial        text unique,
    name          text not null,
    document_type text not null,
    details       jsonb default '{}'::jsonb,
    status        text not null default 'pending',
    created_at    timestamptz default now()
);
alter table public.clearances add column if not exists details     jsonb default '{}'::jsonb;
alter table public.clearances add column if not exists status      text not null default 'pending';
alter table public.clearances add column if not exists created_at  timestamptz default now();
alter table public.clearances add column if not exists payment_ref text;
alter table public.clearances add column if not exists payment_url text;
alter table public.clearances add column if not exists issued_at   timestamptz;

create table if not exists public.admins (
    user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()); $$;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.clearances enable row level security;
drop policy if exists "staff read"   on public.clearances;
drop policy if exists "staff update" on public.clearances;
drop policy if exists "admin read"   on public.clearances;
create policy "admin read" on public.clearances for select to authenticated using (public.is_admin());

create table if not exists public.fees (
    document_type    text primary key,
    amount_centavos  integer not null check (amount_centavos >= 0)
);
insert into public.fees (document_type, amount_centavos) values
    ('Business Permit', 50000), ('Barangay Clearance', 5000)
on conflict (document_type) do nothing;
alter table public.fees enable row level security;
drop policy if exists "fees read" on public.fees;
create policy "fees read" on public.fees for select to anon, authenticated using (true);

insert into storage.buckets (id, name, public) values ('requirements', 'requirements', false)
on conflict (id) do nothing;
drop policy if exists "public upload requirements" on storage.objects;
drop policy if exists "staff view requirements"    on storage.objects;
drop policy if exists "admin view requirements"    on storage.objects;
create policy "public upload requirements" on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'requirements');
create policy "admin view requirements" on storage.objects for select to authenticated
    using (bucket_id = 'requirements' and public.is_admin());

-- PART B: serial numbers (26-0001) --------------------------------------
-- 1) Serial numbers must be unique (the database refuses duplicates) ------
create unique index if not exists clearances_serial_key on public.clearances (serial);

-- 2) A counter per year. The number restarts at 0001 every new year --------
create table if not exists public.serial_counters (
    year     smallint primary key,       -- 26, 27, 28 ...
    last_no  integer  not null default 0
);
alter table public.serial_counters enable row level security;   -- nobody can touch it from the website

-- 3) New submit_application: YY-NNNN (digits only), safe even if two people
--    submit at the same second (the counter row is locked until saved).
create or replace function public.submit_application(p_name text, p_doc_type text, p_details jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    yr         smallint;
    next_no    integer;
    new_serial text;
begin
    if p_doc_type not in ('Business Permit', 'Barangay Clearance') then
        raise exception 'Invalid document type';
    end if;

    yr := (extract(year from (now() at time zone 'Asia/Manila'))::int % 100)::smallint;

    insert into serial_counters (year, last_no) values (yr, 1)
    on conflict (year) do update set last_no = serial_counters.last_no + 1
    returning last_no into next_no;

    new_serial := lpad(yr::text, 2, '0') || '-' ||
                  case when next_no < 10000 then lpad(next_no::text, 4, '0') else next_no::text end;

    insert into clearances (serial, name, document_type, details)
    values (new_serial, p_name, p_doc_type, p_details);

    return new_serial;
end;
$$;
grant execute on function public.submit_application(text, text, jsonb) to anon, authenticated;

drop function if exists public.verify_application(text);

-- PART C: stages, roles, audit log, trash, dashboard --------------------
-- 1) New columns on clearances ----------------------------------------
do $$
begin
    -- Records that already exist and were paid are treated as finished (released)
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'clearances' and column_name = 'stage') then
        alter table public.clearances add column stage text not null default 'submitted';
        update public.clearances set stage = 'released' where status = 'paid';
    end if;
end $$;

alter table public.clearances add column if not exists reject_reason    text;
alter table public.clearances add column if not exists amount_centavos  integer;      -- price at the time it was paid
alter table public.clearances add column if not exists deleted_at       timestamptz;  -- set = in Trash
alter table public.clearances add column if not exists deleted_by       text;

alter table public.clearances drop constraint if exists clearances_stage_check;
alter table public.clearances add constraint clearances_stage_check
    check (stage in ('submitted', 'under_review', 'approved', 'ready', 'released', 'rejected'));

create index if not exists clearances_created_idx on public.clearances (created_at desc);
create index if not exists clearances_stage_idx   on public.clearances (stage);

-- 2) Staff roles: admin (everything) / secretary (review, approve, print) / treasurer (payments, reports)
alter table public.admins add column if not exists role text not null default 'admin';
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (role in ('admin', 'secretary', 'treasurer'));

create or replace function public.staff_role()
returns text language sql security definer stable set search_path = public
as $$ select role from public.admins where user_id = auth.uid(); $$;
grant execute on function public.staff_role() to anon, authenticated;

create or replace function public.has_role(roles text[])
returns boolean language sql security definer stable set search_path = public
as $$ select coalesce((select role = any (roles) from public.admins where user_id = auth.uid()), false); $$;
grant execute on function public.has_role(text[]) to anon, authenticated;

-- 3) Audit log ---------------------------------------------------------
create table if not exists public.audit_log (
    id          bigint generated always as identity primary key,
    at          timestamptz not null default now(),
    actor       uuid,
    actor_email text,
    actor_role  text,
    action      text not null,
    serial      text,
    detail      jsonb default '{}'::jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
drop policy if exists "admin read audit" on public.audit_log;
create policy "admin read audit" on public.audit_log for select to authenticated using (public.has_role(array['admin']));
-- (no insert/update/delete policy: nobody can edit the log from the website)

create or replace function public.write_audit(p_action text, p_serial text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public
as $$
    insert into public.audit_log (actor, actor_email, actor_role, action, serial, detail)
    values (auth.uid(), auth.jwt() ->> 'email', public.staff_role(), p_action, p_serial, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function public.write_audit(text, text, jsonb) from public, anon, authenticated;

-- 4) Lock direct changes: staff can READ; every change goes through the functions below
drop policy if exists "admin update" on public.clearances;
drop policy if exists "admin delete" on public.clearances;

drop policy if exists "admin delete requirements" on storage.objects;
create policy "admin delete requirements" on storage.objects for delete to authenticated
    using (bucket_id = 'requirements' and public.has_role(array['admin']));

drop policy if exists "fees insert" on public.fees;
drop policy if exists "fees update" on public.fees;
create policy "fees insert" on public.fees for insert to authenticated with check (public.has_role(array['admin']));
create policy "fees update" on public.fees for update to authenticated using (public.has_role(array['admin']));

-- 5) When a record becomes PAID, remember the amount and date (works for the PayMongo webhook too)
create or replace function public.trg_on_paid()
returns trigger language plpgsql as $$
begin
    if new.status = 'paid' and old.status is distinct from 'paid' then
        new.amount_centavos := coalesce(new.amount_centavos,
            (select f.amount_centavos from public.fees f where f.document_type = new.document_type));
        new.issued_at := coalesce(new.issued_at, now());
    end if;
    return new;
end $$;
drop trigger if exists clearances_on_paid on public.clearances;
create trigger clearances_on_paid before update on public.clearances
    for each row execute function public.trg_on_paid();

-- 6) STAFF ACTIONS ------------------------------------------------------
create or replace function public.mark_paid(p_serial text)
returns void language plpgsql security definer set search_path = public
as $$
begin
    if not public.has_role(array['admin', 'treasurer']) then raise exception 'Not allowed'; end if;
    update clearances set status = 'paid' where serial = p_serial and deleted_at is null and status <> 'paid';
    if found then perform public.write_audit('mark_paid', p_serial); end if;
end $$;
grant execute on function public.mark_paid(text) to authenticated;

create or replace function public.set_stage(p_serial text, p_stage text, p_reason text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare rec clearances%rowtype;
begin
    if not public.has_role(array['admin', 'secretary']) then raise exception 'Not allowed'; end if;
    if p_stage not in ('submitted', 'under_review', 'approved', 'ready', 'released', 'rejected') then
        raise exception 'Invalid stage';
    end if;
    select * into rec from clearances where serial = p_serial and deleted_at is null;
    if not found then raise exception 'Application not found'; end if;
    if p_stage in ('ready', 'released') and rec.status <> 'paid' then
        raise exception 'Payment has not been received yet';
    end if;
    if p_stage = 'rejected' and coalesce(btrim(p_reason), '') = '' then
        raise exception 'Please give a reason for rejecting';
    end if;
    update clearances
       set stage = p_stage,
           reject_reason = case when p_stage = 'rejected' then btrim(p_reason) else null end
     where serial = p_serial;
    perform public.write_audit('stage_' || p_stage, p_serial,
        jsonb_build_object('from', rec.stage, 'to', p_stage, 'reason', p_reason));
end $$;
grant execute on function public.set_stage(text, text, text) to authenticated;

create or replace function public.archive_application(p_serial text)
returns void language plpgsql security definer set search_path = public
as $$
begin
    if not public.has_role(array['admin']) then raise exception 'Not allowed'; end if;
    update clearances set deleted_at = now(), deleted_by = auth.jwt() ->> 'email'
     where serial = p_serial and deleted_at is null;
    if not found then raise exception 'Application not found'; end if;
    perform public.write_audit('delete', p_serial);
end $$;
grant execute on function public.archive_application(text) to authenticated;

create or replace function public.restore_application(p_serial text)
returns void language plpgsql security definer set search_path = public
as $$
begin
    if not public.has_role(array['admin']) then raise exception 'Not allowed'; end if;
    update clearances set deleted_at = null, deleted_by = null where serial = p_serial and deleted_at is not null;
    if not found then raise exception 'Application not found in Trash'; end if;
    perform public.write_audit('restore', p_serial);
end $$;
grant execute on function public.restore_application(text) to authenticated;

create or replace function public.purge_application(p_serial text)
returns void language plpgsql security definer set search_path = public
as $$
begin
    if not public.has_role(array['admin']) then raise exception 'Not allowed'; end if;
    delete from clearances where serial = p_serial and deleted_at is not null;   -- only items already in Trash
    if not found then raise exception 'Only items in Trash can be deleted forever'; end if;
    perform public.write_audit('purge', p_serial);
end $$;
grant execute on function public.purge_application(text) to authenticated;

create or replace function public.update_fees(p_business integer, p_clearance integer)
returns void language plpgsql security definer set search_path = public
as $$
begin
    if not public.has_role(array['admin']) then raise exception 'Not allowed'; end if;
    if p_business < 0 or p_clearance < 0 then raise exception 'Invalid amount'; end if;
    insert into fees (document_type, amount_centavos) values ('Business Permit', p_business), ('Barangay Clearance', p_clearance)
    on conflict (document_type) do update set amount_centavos = excluded.amount_centavos;
    perform public.write_audit('fees_changed', null, jsonb_build_object('business', p_business, 'clearance', p_clearance));
end $$;
grant execute on function public.update_fees(integer, integer) to authenticated;

create or replace function public.log_event(p_action text, p_serial text default null, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Not allowed'; end if;
    if p_action not in ('print', 'export_pdf', 'export_csv', 'login') then raise exception 'Unknown action'; end if;
    perform public.write_audit(p_action, p_serial, p_detail);
end $$;
grant execute on function public.log_event(text, text, jsonb) to authenticated;

-- 7) DASHBOARD numbers (any staff) --------------------------------------
create or replace function public.admin_dashboard()
returns json language plpgsql security definer stable set search_path = public
as $$
declare
    today date := (now() at time zone 'Asia/Manila')::date;
    result json;
begin
    if not public.is_admin() then raise exception 'Not allowed'; end if;
    with base as (
        select c.*,
               (c.created_at at time zone 'Asia/Manila')::date                      as created_day,
               (coalesce(c.issued_at, c.created_at) at time zone 'Asia/Manila')::date as paid_day,
               coalesce(c.amount_centavos,
                        (select f.amount_centavos from fees f where f.document_type = c.document_type), 0) as amt
          from clearances c
         where c.deleted_at is null
    )
    select json_build_object(
        'total',            (select count(*) from base),
        'today',            (select count(*) from base where created_day = today),
        'this_month',       (select count(*) from base where date_trunc('month', created_day) = date_trunc('month', today)),
        'this_year',        (select count(*) from base where date_trunc('year',  created_day) = date_trunc('year',  today)),
        'unpaid',           (select count(*) from base where status <> 'paid' and stage <> 'rejected'),
        'paid',             (select count(*) from base where status = 'paid'),
        'collected_today',  (select coalesce(sum(amt), 0) from base where status = 'paid' and paid_day = today),
        'collected_month',  (select coalesce(sum(amt), 0) from base where status = 'paid' and date_trunc('month', paid_day) = date_trunc('month', today)),
        'collected_year',   (select coalesce(sum(amt), 0) from base where status = 'paid' and date_trunc('year',  paid_day) = date_trunc('year',  today)),
        'collected_total',  (select coalesce(sum(amt), 0) from base where status = 'paid'),
        'by_stage',         (select coalesce(json_object_agg(stage, n), '{}'::json) from (select stage, count(*) n from base group by stage) s),
        'by_type',          (select coalesce(json_object_agg(document_type, n), '{}'::json) from (select document_type, count(*) n from base group by document_type) t),
        'months',           (select coalesce(json_agg(json_build_object(
                                'month', to_char(m, 'YYYY-MM'),
                                'applications', (select count(*) from base where date_trunc('month', created_day) = m),
                                'collected',    (select coalesce(sum(amt), 0) from base where status = 'paid' and date_trunc('month', paid_day) = m)
                             ) order by m), '[]'::json)
                             from generate_series(date_trunc('month', today) - interval '5 months', date_trunc('month', today), interval '1 month') m)
    ) into result;
    return result;
end $$;
grant execute on function public.admin_dashboard() to authenticated;

-- 8) Giving someone a role (run in SQL Editor after creating the user in Authentication > Users):
--   insert into public.admins (user_id, role) select id, 'secretary' from auth.users where email = 'secretary@barangay.gov.ph'
--   on conflict (user_id) do update set role = excluded.role;
--   (roles: 'admin', 'secretary', 'treasurer'. Existing admins are already 'admin'.)

-- PART D: make the serial counters follow records that already exist -----
insert into serial_counters (year, last_no)
select split_part(serial, '-', 1)::smallint, max(split_part(serial, '-', 2)::integer)
from clearances
where serial ~ '^\d{2}-\d+$'
group by 1
on conflict (year) do update set last_no = greatest(serial_counters.last_no, excluded.last_no);
