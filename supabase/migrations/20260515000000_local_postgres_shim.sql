-- ============================================================================
-- Migration 000: Local-Postgres compatibility shim
--
-- The remaining migrations reference Supabase-specific objects:
--   - auth.users (FK target for user_id columns)
--   - auth.uid() (used in RLS policies)
--   - authenticated role (GRANT targets)
--   - citext, pgcrypto extensions (used early)
--
-- This shim creates compatible stand-ins so the rest of the schema works
-- unchanged on plain Postgres. If we ever migrate to Supabase, drop this file.
-- ============================================================================

-- Extensions FIRST (auth.users column type needs citext)
create extension if not exists "citext";
create extension if not exists "pgcrypto";

-- Stand-in for Supabase's `authenticated` role used in GRANT statements
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end
$$;

-- Auth schema + minimal users table
create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               citext unique not null,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table auth.users is
  'Local Postgres shim mimicking Supabase auth.users. App layer manages inserts directly.';

-- auth.uid() returns user ID from a session GUC:
--   SET app.current_user_id = '<uuid>';
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

comment on function auth.uid is
  'Returns current user ID from session GUC app.current_user_id.';

-- Grant the auth role read on the shim so RLS policies can resolve
grant usage on schema auth to authenticated, service_role;
grant select on auth.users to authenticated, service_role;
