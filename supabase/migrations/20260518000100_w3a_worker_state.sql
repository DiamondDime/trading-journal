-- ============================================================================
-- Migration W3a: Worker bookkeeping state — per-connection sync metadata.
--
-- Adds two columns to exchange_connections:
--   - sync_state JSONB: free-form state owned by the worker. Stores
--     last_seen_symbols (set of ccxt symbols the user has been active on),
--     full_scan_at (last time we did a full market scan), and any other
--     forward-compatible bookkeeping. Default '{}' so existing rows are fine.
--   - last_funding_at TIMESTAMPTZ: high-water mark for funding-event ingestion.
--     Independent of last_fill_at because funding ticks lag fills by ~8h.
--
-- Rationale (see docs/specs/2026-05-18-absolute-journal-v2-master-plan.md §4 W3a):
-- The targeted-symbol scan needs to remember which markets a user is active
-- in across syncs to avoid scanning every Binance market (~1500 calls). The
-- worker writes the discovered symbol list back into sync_state.last_seen_symbols
-- and re-uses it on subsequent syncs. Once a month it falls back to a full
-- scan to catch new pairs the user started trading on the venue's UI.
--
-- This migration is additive and idempotent. No existing rows are altered.
-- ============================================================================

alter table public.exchange_connections
  add column if not exists sync_state jsonb not null default '{}'::jsonb,
  add column if not exists last_funding_at timestamptz;

comment on column public.exchange_connections.sync_state is
  'Worker-owned bookkeeping. Keys: last_seen_symbols (str[]), full_scan_at (iso8601). Free-form forward-compat.';
comment on column public.exchange_connections.last_funding_at is
  'High-water mark for funding-event ingestion (separate from last_fill_at).';
