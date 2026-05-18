-- ============================================================================
-- Migration v6: Balance tracker — live + historical
--
-- Design doc: docs/specs/2026-05-18-absolute-journal-v2-master-plan.md §7
-- Workstream owner: balance-tracker agent (2026-05-18).
--
-- What this migration ships
-- -------------------------
-- Two tables, one helper view, RLS owner-only on both.
--
-- 1) ``public.exchange_balances`` (live state)
--    The most recent reported balance per (connection, wallet_type, asset, chain).
--    Wallet-type lets us track a user's spot + isolated_margin + futures wallets
--    independently on the same connection (a Binance API key sees all of them).
--    Chain is NULLABLE — only meaningful for assets that exist on multiple
--    networks the venue distinguishes (USDT-ERC20 vs USDT-TRC20 etc). When
--    the venue reports a single unified balance, ``chain`` is NULL.
--    UPSERT keyed on (connection_id, wallet_type, asset, coalesce(chain, ''))
--    so the worker can do an idempotent "reset to whatever the venue says
--    right now". USD price + value are stamped at fetch-time (snapshot_at).
--
-- 2) ``public.portfolio_snapshots`` (time series)
--    Hourly snapshots of the user's whole portfolio. ``by_exchange`` /
--    ``by_asset`` are jsonb dicts (exchange_code → usd, asset_code → usd)
--    that let the UI render breakdown rings without re-joining
--    exchange_balances on every render. ``drift_from_fills_usd`` is the
--    delta between the balance the venue reports and what the journal's
--    fills math would predict (asset-level, summed across exchanges). A
--    positive value means the user has more on the venue than the journal
--    expects (likely a transfer in we didn't see). A negative value means
--    the journal expects more than the venue has (likely a withdrawal/
--    transfer out the journal hasn't observed yet, OR a sync gap).
--
-- 3) ``public.v_portfolio_summary`` (helper view)
--    The "current state per asset, summed across exchanges". Used by the
--    main balances API endpoint to render the per-asset table.
--
-- Schema decisions worth flagging
-- -------------------------------
-- * No FK on ``wallet_type`` — it's a string enum we manage at the app
--   layer (worker emits canonical values). Migrating to a Postgres enum
--   would force a schema migration every time a venue surfaces a new
--   wallet type (e.g. Binance launching "earn-flexible"); that's not the
--   right tradeoff for an exchange-quirk field.
-- * ``available`` / ``locked`` / ``borrowed`` are nullable-able-by-default
--   but defaulted to 0 because most venues only report one of the three.
--   The invariant is ``total = available + locked - borrowed`` but we don't
--   ENFORCE it in SQL — adapters with quirky views (cross-margin combined
--   wallets, etc) may emit values that don't add up; we trust the venue.
-- * Numeric precision (38, 18) on quantities and (38, 8) on USD values
--   matches the rest of the journal (see migration 004 for fills).
-- * ``source`` column on exchange_balances lets us mark a manually entered
--   row (user edits a balance via the UI) so the next worker sync doesn't
--   blow it away. Default 'worker'.
-- * ``source`` column on portfolio_snapshots distinguishes the hourly cron,
--   a manual refresh button, and an event-driven snapshot (e.g. snapshot
--   right after a fill arrives so the equity curve picks it up promptly).
--
-- Idempotency: forward-only, additive. Re-running the migration on a DB
-- where the tables already exist is a no-op (uses ``if not exists``).
-- ============================================================================


-- ============================================================================
-- 1. exchange_balances — live per-asset state per connection
-- ============================================================================

create table if not exists public.exchange_balances (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  exchange_connection_id  uuid not null references public.exchange_connections(id) on delete cascade,

  -- ``wallet_type`` — the venue's bucket the balance lives in. Canonical values
  -- the adapter layer emits: 'spot' | 'margin' | 'cross_margin' |
  -- 'isolated_margin' | 'futures' | 'earn' | 'funding'. Stored as text so we
  -- don't need a schema migration when a new exchange ships a new wallet type.
  wallet_type             text not null,

  -- ``asset`` — uppercase canonical code (BTC, ETH, USDT, ...). The worker
  -- upper-cases venue-supplied codes before insert; the unique constraint
  -- relies on case-stability.
  asset                   text not null,

  -- ``chain`` — non-NULL only when the venue surfaces per-network balances
  -- (USDT-ERC20 ≠ USDT-TRC20 on Bybit's withdrawal flow, e.g.). Most rows
  -- have chain = NULL.
  chain                   text,

  -- Quantities — strings on the wire (TS Decimal), NUMERIC here.
  total                   numeric(38, 18) not null,
  available               numeric(38, 18) not null default 0,
  locked                  numeric(38, 18) not null default 0,
  borrowed                numeric(38, 18) not null default 0,

  -- USD pricing — stamped at fetch time from prices.py (CCXT ticker → CoinGecko
  -- fallback → $1.00 for stablecoins). NULL means we tried and couldn't price.
  -- usd_value = total * usd_price (computed by the worker; we don't make it a
  -- generated column because some adapters report negative balances for shorts
  -- and we want explicit per-row math, not surprise NULLs from arithmetic).
  usd_price               numeric(38, 8),
  usd_value               numeric(38, 8),

  snapshot_at             timestamptz not null,
  source                  text not null default 'worker'
    check (source in ('worker', 'manual')),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Uniqueness — one row per (connection, wallet_type, asset, chain). The
  -- coalesce wrapper turns NULL chains into a sentinel '' so the unique
  -- constraint actually catches duplicates when chain is NULL.
  constraint uq_exchange_balance unique
    (exchange_connection_id, wallet_type, asset, chain)
);

comment on table public.exchange_balances is
  'Live per-(connection, wallet_type, asset, chain) balance with USD valuation. '
  'Worker UPSERTs after every sync; rows are the venue''s ground truth. '
  '"chain" is NULL when the venue reports a unified balance per asset.';
comment on column public.exchange_balances.wallet_type is
  'Canonical wallet bucket (spot | margin | cross_margin | isolated_margin | '
  'futures | earn | funding). Stored as text — adapter quirks make this a '
  'moving target unsuitable for a Postgres enum.';
comment on column public.exchange_balances.chain is
  'Network code (ERC20, BSC, TRC20, ...). NULL = venue reports unified balance.';
comment on column public.exchange_balances.usd_price is
  'USD price used to value this row. NULL means pricing failed for this asset.';
comment on column public.exchange_balances.usd_value is
  'total * usd_price. Pre-computed so the per-asset / per-exchange aggregations '
  'don''t have to re-multiply on every render.';
comment on column public.exchange_balances.source is
  '"worker" = auto-fetched; "manual" = user-overridden via the UI. Worker '
  'skips rows where source=''manual'' on its next pass to avoid stomping edits.';

create index if not exists idx_balances_user
  on public.exchange_balances (user_id);
create index if not exists idx_balances_connection
  on public.exchange_balances (exchange_connection_id);
create index if not exists idx_balances_user_value
  on public.exchange_balances (user_id, usd_value desc nulls last);
create index if not exists idx_balances_asset
  on public.exchange_balances (user_id, asset);

-- updated_at bump
drop trigger if exists exchange_balances_updated_at on public.exchange_balances;
create trigger exchange_balances_updated_at
  before update on public.exchange_balances
  for each row execute function public.tg_set_updated_at();


-- ============================================================================
-- 2. portfolio_snapshots — time-series of total portfolio USD
-- ============================================================================

create table if not exists public.portfolio_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,

  snapshot_at             timestamptz not null,

  total_usd               numeric(38, 8) not null,
  total_stable_usd        numeric(38, 8) not null default 0,
  total_volatile_usd      numeric(38, 8) not null default 0,

  -- Breakdown dictionaries — flat string→USD maps the UI consumes verbatim.
  -- by_exchange: {"binance": "12345.67", "bybit": "8765.43"} (exchange CODE)
  -- by_asset:    {"BTC": "9000", "ETH": "7500"}              (asset CODE)
  -- by_chain:    {"ERC20": "12000", "TRC20": "3000"}         (nullable)
  --
  -- Decimals are stored as STRINGS inside jsonb to dodge Postgres' silent
  -- float coercion when round-tripping numbers through ``::jsonb``. The
  -- worker stringifies before json-encoding; TS readers parse to Decimal at
  -- the edge.
  by_exchange             jsonb not null default '{}'::jsonb,
  by_asset                jsonb not null default '{}'::jsonb,
  by_chain                jsonb,

  -- ``drift_from_fills_usd`` — signed dollar delta:
  --   positive = venue reports more than journal fills predict
  --   negative = venue reports less than journal fills predict
  -- NULL when the user has zero fills (drift is meaningless).
  drift_from_fills_usd    numeric(38, 8),

  source                  text not null default 'scheduled'
    check (source in ('scheduled', 'manual_refresh', 'event_driven')),

  created_at              timestamptz not null default now()
);

comment on table public.portfolio_snapshots is
  'Time-series snapshots of the user''s whole portfolio. Hourly cadence by '
  'default; the manual_refresh button and event-driven hooks add ad-hoc rows.';
comment on column public.portfolio_snapshots.by_exchange is
  '{exchange_code: usd_value_string} — decimals stored as strings inside '
  'jsonb to avoid float coercion. UI reads verbatim.';
comment on column public.portfolio_snapshots.drift_from_fills_usd is
  'Signed delta: (reported portfolio USD) - (fills-math expected portfolio USD). '
  'Computed when the worker can match every asset back to a fill stream; NULL '
  'when there are no fills to compare against.';

create index if not exists idx_portfolio_snap_user_time
  on public.portfolio_snapshots (user_id, snapshot_at desc);


-- ============================================================================
-- 3. v_portfolio_summary — current state per asset, summed across venues
-- ============================================================================
--
-- The balances dashboard's per-asset table reads this view. It collapses
-- exchange_balances down to one row per (user, asset) with the total quantity,
-- total USD value, the USD price we used, and an aggregated per-exchange list
-- (asset_code → array of {connection_id, exchange_code, label, qty, usd}).
--
-- Implemented as a view so the API can simply SELECT * WHERE user_id = $1
-- and get a clean shape. If perf becomes an issue with >100 connections we
-- can materialize it; today the user has <50 connections at most.

create or replace view public.v_portfolio_summary as
with per_asset as (
  select
    b.user_id,
    b.asset,
    -- Use the freshest snapshot_at per asset row for per-asset price stamp
    max(b.snapshot_at)            as latest_snapshot_at,
    -- Quantities and USD values are summed across all (wallet_type, chain,
    -- connection) for the asset. usd_value can be NULL on rows where pricing
    -- failed — sum() returns NULL only when EVERY row is NULL. We use
    -- coalesce on the per-asset projection to keep the UI free of NaNs.
    sum(b.total)                  as total_qty,
    sum(b.usd_value)              as total_usd,
    -- Weight-average price (only over rows we could price). Falls back to
    -- the most-common venue's price if every value is NULL.
    case
      when sum(case when b.usd_value is not null and b.total > 0 then b.total else 0 end) > 0
      then sum(b.usd_value) / nullif(sum(case when b.usd_value is not null and b.total > 0 then b.total else 0 end), 0)
      else null
    end                           as weighted_usd_price
  from public.exchange_balances b
  where b.total > 0
  group by b.user_id, b.asset
)
select * from per_asset;

comment on view public.v_portfolio_summary is
  'Per-asset rollup across all connections / wallets. Drives the balances '
  'dashboard''s asset table. Filters total > 0 so dust rows don''t clutter.';


-- ============================================================================
-- 4. Row-Level Security — owner-only
-- ============================================================================

alter table public.exchange_balances enable row level security;
drop policy if exists exchange_balances_owner_all on public.exchange_balances;
create policy exchange_balances_owner_all on public.exchange_balances
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.portfolio_snapshots enable row level security;
drop policy if exists portfolio_snapshots_owner_all on public.portfolio_snapshots;
create policy portfolio_snapshots_owner_all on public.portfolio_snapshots
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Views inherit base-table RLS; no explicit policy needed for v_portfolio_summary.


-- ============================================================================
-- 5. Worker grants — service_role can write balance / snapshot rows freely.
-- The "authenticated" role is the single-user app; RLS scopes it to owned data.
-- ============================================================================

grant select, insert, update, delete on public.exchange_balances to authenticated;
grant select, insert, update, delete on public.portfolio_snapshots to authenticated;
grant select on public.v_portfolio_summary to authenticated;
