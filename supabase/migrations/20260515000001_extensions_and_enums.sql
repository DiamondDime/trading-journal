-- ============================================================================
-- Migration 001: Extensions, enums, and shared utilities
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "citext";
create extension if not exists "pg_trgm";
-- Supabase Vault (managed) — uses pgsodium under the hood.
-- Enabled at the project level in Supabase dashboard; no CREATE EXTENSION here.

-- ============================================================================
-- Enums (centralized for cross-table consistency)
-- ============================================================================

create type connection_status as enum (
  'pending',
  'active',
  'syncing',
  'auth_failed',
  'rate_limited',
  'error',
  'disabled'
);

create type instrument_type as enum (
  'spot',
  'perp',
  'dated_future',
  'option'
);

create type position_side as enum ('long', 'short');
create type fill_side as enum ('buy', 'sell');
create type position_status as enum ('open', 'closed');
create type margin_mode as enum ('cross', 'isolated', 'spot');

create type spread_status as enum (
  'candidate',
  'open',
  'closed',
  'rejected'
);

create type spread_origin as enum (
  'auto_matched',
  'manual',
  'auto_confirmed'
);

create type candidate_state as enum (
  'pending',
  'accepted',
  'rejected',
  'expired'
);

create type sync_job_state as enum (
  'queued',
  'running',
  'succeeded',
  'failed'
);

create type allowlist_role as enum ('user', 'admin');

create type fee_kind as enum (
  'maker',
  'taker',
  'funding',
  'withdrawal',
  'gas'
);

-- Reference catalogs: data, not schema. Add new venues/strategies by INSERT.
create table public.spread_type_catalog (
  code           text primary key,
  display_name   text not null,
  description    text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on table public.spread_type_catalog is
  'Reference table for spread strategy types. Add new strategies by INSERTing here.';

insert into public.spread_type_catalog (code, display_name, description) values
  ('cross_exchange_perp_arb', 'Cross-Exchange Perp Arbitrage', 'Same perp, two venues, opposite sides'),
  ('cash_carry',              'Cash-and-Carry',                'Long spot + short perp/future'),
  ('calendar',                'Calendar Spread',               'Two dated futures, different expiries'),
  ('funding_capture',         'Funding Capture',               'Delta-neutral position to harvest funding'),
  ('dex_cex_arb',             'DEX-CEX Arbitrage',             'On-chain leg vs centralized leg'),
  ('custom',                  'Custom',                        'User-defined strategy');

create table public.exchange_catalog (
  code             text primary key,
  display_name     text not null,
  venue_type       text not null check (venue_type in ('cex', 'dex')),
  supports_spot    boolean not null default false,
  supports_perp    boolean not null default false,
  supports_options boolean not null default false,
  auth_mode        text not null check (auth_mode in ('api_key', 'wallet_address')),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

comment on table public.exchange_catalog is
  'Reference table for supported exchanges. Add a new exchange by INSERTing here.';

insert into public.exchange_catalog (code, display_name, venue_type, supports_spot, supports_perp, supports_options, auth_mode) values
  ('binance',     'Binance',     'cex', true,  true,  true,  'api_key'),
  ('bybit',       'Bybit',       'cex', true,  true,  true,  'api_key'),
  ('okx',         'OKX',         'cex', true,  true,  true,  'api_key'),
  ('deribit',     'Deribit',     'cex', false, true,  true,  'api_key'),
  ('hyperliquid', 'Hyperliquid', 'dex', false, true,  false, 'wallet_address'),
  ('aster',       'Aster',       'dex', false, true,  false, 'wallet_address'),
  ('okx_dex',     'OKX DEX',     'dex', true,  true,  false, 'wallet_address'),
  ('phemex',      'Phemex',      'cex', true,  true,  false, 'api_key'),
  ('bitget',      'Bitget',      'cex', true,  true,  false, 'api_key'),
  ('mexc',        'MEXC',        'cex', true,  true,  false, 'api_key'),
  ('kucoin',      'KuCoin',      'cex', true,  true,  false, 'api_key'),
  ('kraken',      'Kraken',      'cex', true,  true,  false, 'api_key'),
  ('gate',        'Gate',        'cex', true,  true,  false, 'api_key'),
  ('bingx',       'BingX',       'cex', true,  true,  false, 'api_key');

-- ============================================================================
-- updated_at trigger function (reused across all tables)
-- ============================================================================

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.tg_set_updated_at is
  'Generic trigger function — bumps updated_at on every UPDATE.';
