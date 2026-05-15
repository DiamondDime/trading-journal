-- ============================================================================
-- Migration 002: Allowlist (invite-only auth) and user profiles
-- ============================================================================

create table public.allowlist (
  id              uuid primary key default uuid_generate_v4(),
  email           citext not null unique,
  role            allowlist_role not null default 'user',
  invited_by      uuid references auth.users(id) on delete set null,
  invited_at      timestamptz not null default now(),
  redeemed_at     timestamptz,
  redeemed_by     uuid references auth.users(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.allowlist is
  'Admin-controlled allowlist of permitted emails. Signup is rejected unless email exists here.';
comment on column public.allowlist.role is
  'user = standard access; admin = can manage allowlist itself.';
comment on column public.allowlist.redeemed_at is
  'Set when the allowlisted email signs up. NULL = invite pending.';

create index allowlist_email_idx       on public.allowlist (email);
create index allowlist_role_idx        on public.allowlist (role) where role = 'admin';
create index allowlist_redeemed_idx    on public.allowlist (redeemed_at) where redeemed_at is null;

create trigger allowlist_updated_at
  before update on public.allowlist
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- Profiles — one row per auth.users, app-level user state
-- ============================================================================

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           citext not null unique,
  display_name    text,
  timezone        text not null default 'UTC',
  base_currency   text not null default 'USD',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.profiles is
  '1:1 with auth.users. App-level profile data (display name, prefs, base currency for PnL).';

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Auto-create profile + enforce allowlist on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  select exists(select 1 from public.allowlist where email = new.email)
    into v_allowed;

  if not v_allowed then
    raise exception 'Email % is not on the allowlist', new.email
      using errcode = 'insufficient_privilege';
  end if;

  update public.allowlist
    set redeemed_at = now(), redeemed_by = new.id
    where email = new.email and redeemed_at is null;

  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Trigger on auth.users INSERT — enforces allowlist and creates profile row.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is_admin(uid) — used in RLS policies
create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowlist a
    join public.profiles p on p.email = a.email
    where p.id = p_user_id and a.role = 'admin'
  );
$$;

comment on function public.is_admin is
  'Returns true if user is in allowlist with role=admin. Used in RLS policies.';
