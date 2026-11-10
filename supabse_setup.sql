-- Run this ONCE in Supabase > SQL Editor.  (Safe to re-run.)

-- 1) Applications table ---------------------------------------------------
create table if not exists public.clearances (
    id            bigint generated always as identity primary key,
    serial        text unique,                 -- reference number, digits only, e.g. 26-1001
    name          text not null,
    document_type text not null,
    details       jsonb default '{}'::jsonb,
    status        text not null default 'pending',
    created_at    timestamptz default now()
);
alter table public.clearances add column if not exists details     jsonb default '{}'::jsonb;
alter table public.clearances add column if not exists status      text not null default 'pending';
alter table public.clearances add column if not exists created_at  timestamptz default now();
alter table public.clearances add column if not exists payment_ref text;         -- PayMongo link id
alter table public.clearances add column if not exists payment_url text;         -- PayMongo checkout link
alter table public.clearances add column if not exists issued_at   timestamptz;  -- date printed on the certificate

-- 2) Who is an ADMIN? Only users listed here --------------------------------
create table if not exists public.admins (
    user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;   -- nobody can read/write it from the website

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 3) Lock the applications table: ONLY admins can read or update -------------
alter table public.clearances enable row level security;
drop policy if exists "staff read"    on public.clearances;
drop policy if exists "staff update"  on public.clearances;
drop policy if exists "admin read"    on public.clearances;
drop policy if exists "admin update"  on public.clearances;
create policy "admin read"   on public.clearances for select to authenticated using (public.is_admin());
create policy "admin update" on public.clearances for update to authenticated using (public.is_admin());
-- (No policy for the public: applicants can only use the two functions below.)

-- 4) FEES: anyone may READ the prices, only admins may CHANGE them -----------
create table if not exists public.fees (
    document_type    text primary key,
    amount_centavos  integer not null check (amount_centavos >= 0)   -- 100 = P1.00
);
insert into public.fees (document_type, amount_centavos) values
    ('Business Permit', 50000),      -- P500.00
    ('Barangay Clearance', 5000)     -- P50.00
on conflict (document_type) do nothing;

alter table public.fees enable row level security;
drop policy if exists "fees read"   on public.fees;
drop policy if exists "fees insert" on public.fees;
drop policy if exists "fees update" on public.fees;
create policy "fees read"   on public.fees for select to anon, authenticated using (true);
create policy "fees insert" on public.fees for insert to authenticated with check (public.is_admin());
create policy "fees update" on public.fees for update to authenticated using (public.is_admin());

-- 5) APPLICANT submits through this function (it cannot read anything back) --
--    Reference number = last 2 digits of the year + dash + number, e.g. 26-1001
create or replace function public.submit_application(p_name text, p_doc_type text, p_details jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    new_id bigint;
    new_serial text;
begin
    if p_doc_type not in ('Business Permit', 'Barangay Clearance') then
        raise exception 'Invalid document type';
    end if;
    insert into clearances (name, document_type, details, serial)
    values (p_name, p_doc_type, p_details, 'tmp-' || gen_random_uuid())
    returning id into new_id;

    new_serial := to_char(now(), 'YY') || '-' || lpad((1000 + new_id)::text, 4, '0');
    update clearances set serial = new_serial where id = new_id;
    return new_serial;
end;
$$;
grant execute on function public.submit_application(text, text, jsonb) to anon, authenticated;

-- 6) PUBLIC status check: returns ONLY a masked name, type and status ---------
create or replace function public.verify_application(p_serial text)
returns json
language sql
security definer
stable
set search_path = public
as $$
    select json_build_object(
        'serial', serial,
        'masked_name', regexp_replace(name, '(\S)\S*', '\1***', 'g'),
        'document_type', document_type,
        'status', status
    )
    from clearances where serial = p_serial limit 1;
$$;
grant execute on function public.verify_application(text) to anon, authenticated;

-- 7) Private bucket for uploaded requirements: public may upload, ONLY admins view
insert into storage.buckets (id, name, public) values ('requirements', 'requirements', false)
on conflict (id) do nothing;
drop policy if exists "public upload requirements" on storage.objects;
drop policy if exists "staff view requirements"    on storage.objects;
drop policy if exists "admin view requirements"    on storage.objects;
create policy "public upload requirements" on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'requirements');
create policy "admin view requirements" on storage.objects for select to authenticated
    using (bucket_id = 'requirements' and public.is_admin());

-- 8) MAKE YOURSELF AN ADMIN -------------------------------------------------
-- First create the user in Supabase > Authentication > Users > "Add user"
-- (tick "Auto Confirm"), then run this with that email:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'officer@barangay.gov.ph';
--
-- Also turn OFF "Allow new users to sign up" in Authentication > Providers > Email
-- so strangers cannot create accounts.
