-- ECLIPSE Guild Manager v17
-- Run this once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  job text default '',
  power integer not null default 0,
  defense integer not null default 0,
  accuracy integer not null default 0,
  memo text default '',
  created_at timestamptz not null default now()
);

alter table public.members add column if not exists memo text default '';
alter table public.members add column if not exists job text default '';
alter table public.members add column if not exists power integer not null default 0;
create unique index if not exists members_name_unique on public.members(name);

create table if not exists public.boss_records (
  id uuid primary key default gen_random_uuid(),
  week integer not null default 1 check (week between 1 and 5),
  date date not null default current_date,
  boss text not null,
  score integer not null default 0,
  participants text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.admin_memos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.distribution_records (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  recipient text not null,
  amount bigint not null default 0,
  reason text default '',
  memo text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  member_name text not null,
  discord_user_id text default '',
  discord_display_name text default '',
  attendance_date date not null default current_date,
  status text not null default 'present',
  source text not null default 'discord',
  created_at timestamptz not null default now(),
  unique (member_name, attendance_date)
);

create index if not exists members_name_idx on public.members(name);
create index if not exists boss_records_date_idx on public.boss_records(date desc);
create index if not exists boss_records_week_idx on public.boss_records(week);
create index if not exists admin_memos_created_at_idx on public.admin_memos(created_at desc);
create index if not exists distribution_records_date_idx on public.distribution_records(date desc);
create index if not exists attendance_date_idx on public.attendance(attendance_date desc);
create index if not exists attendance_member_idx on public.attendance(member_name);

alter table public.members enable row level security;
alter table public.boss_records enable row level security;
alter table public.admin_memos enable row level security;
alter table public.distribution_records enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "members_public_select" on public.members;
drop policy if exists "members_public_insert" on public.members;
drop policy if exists "members_public_update" on public.members;
drop policy if exists "members_public_delete" on public.members;
drop policy if exists "boss_public_select" on public.boss_records;
drop policy if exists "boss_public_insert" on public.boss_records;
drop policy if exists "boss_public_update" on public.boss_records;
drop policy if exists "boss_public_delete" on public.boss_records;
drop policy if exists "admin_memos_public_select" on public.admin_memos;
drop policy if exists "admin_memos_public_insert" on public.admin_memos;
drop policy if exists "admin_memos_public_update" on public.admin_memos;
drop policy if exists "admin_memos_public_delete" on public.admin_memos;
drop policy if exists "distribution_public_select" on public.distribution_records;
drop policy if exists "distribution_public_insert" on public.distribution_records;
drop policy if exists "distribution_public_update" on public.distribution_records;
drop policy if exists "distribution_public_delete" on public.distribution_records;
drop policy if exists "attendance_public_select" on public.attendance;

create policy "members_public_select" on public.members for select to anon, authenticated using (true);
create policy "members_public_insert" on public.members for insert to anon, authenticated with check (true);
create policy "members_public_update" on public.members for update to anon, authenticated using (true) with check (true);
create policy "members_public_delete" on public.members for delete to anon, authenticated using (true);
create policy "boss_public_select" on public.boss_records for select to anon, authenticated using (true);
create policy "boss_public_insert" on public.boss_records for insert to anon, authenticated with check (true);
create policy "boss_public_update" on public.boss_records for update to anon, authenticated using (true) with check (true);
create policy "boss_public_delete" on public.boss_records for delete to anon, authenticated using (true);
create policy "admin_memos_public_select" on public.admin_memos for select to anon, authenticated using (true);
create policy "admin_memos_public_insert" on public.admin_memos for insert to anon, authenticated with check (true);
create policy "admin_memos_public_update" on public.admin_memos for update to anon, authenticated using (true) with check (true);
create policy "admin_memos_public_delete" on public.admin_memos for delete to anon, authenticated using (true);
create policy "distribution_public_select" on public.distribution_records for select to anon, authenticated using (true);
create policy "distribution_public_insert" on public.distribution_records for insert to anon, authenticated with check (true);
create policy "distribution_public_update" on public.distribution_records for update to anon, authenticated using (true) with check (true);
create policy "distribution_public_delete" on public.distribution_records for delete to anon, authenticated using (true);
create policy "attendance_public_select" on public.attendance for select to anon, authenticated using (true);

-- Realtime without duplicate-publication errors.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='members') then
    alter publication supabase_realtime add table public.members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='boss_records') then
    alter publication supabase_realtime add table public.boss_records;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='distribution_records') then
    alter publication supabase_realtime add table public.distribution_records;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='admin_memos') then
    alter publication supabase_realtime add table public.admin_memos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='attendance') then
    alter publication supabase_realtime add table public.attendance;
  end if;
end $$;

create or replace function public.remove_deleted_member_from_boss_records()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.boss_records set participants = array_remove(participants, old.name) where old.name = any(participants);
  delete from public.attendance where member_name = old.name;
  return old;
end;
$$;

drop trigger if exists trg_remove_deleted_member_from_boss_records on public.members;
create trigger trg_remove_deleted_member_from_boss_records after delete on public.members for each row execute function public.remove_deleted_member_from_boss_records();
