-- ============================================================================
-- Migration 004: Core trade data — Position, Fill, FundingEvent
-- High-volume time-series tables. Indexes critical.
-- ============================================================================

create table public.positions (
  id                       uuid primary key default uuid_generate_v4(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  exchange_connection_id   uuid not null references public.exchange_connections(id) on delete restrict,

  instrument               text not null,
  instrument_type          instrument_type not null,
  side                     position_side not null,
  margin_mode              margin_mode not null default 'cross',
  leverage                 numeric(10,4),

  total_qty                numeric(38,18) not null,
  qty_open                 numeric(38,18) not null default 0,
  avg_entry_price          numeric(38,18) not null,
  avg_exit_price           numeric(38,18),

  opened_at                timestamptz not null,
  closed_at                timestamptz,
  status                   position_status not null default 'open',

  realized_pnl_quote       numeric(38,18) not null default 0,
  total_fees_quote         numeric(38,18) not null default 0,
  total_funding_quote      numeric(38,18) not null default 0,
  quote_currency           text not null default 'USDT',

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,

  constraint chk_closed_consistency check (
    (status = 'open'   and closed_at is null and avg_exit_price is null) or
    (status = 'closed' and closed_at is not null)
  ),
  constraint chk_positive_qty check (total_qty >= 0)
);

comment on table public.positions is
  'Logical position on one instrument, composed of one or more Fills. Materialized from fills via worker.';
comment on column public.positions.qty_open is
  'Currently open quantity (>= 0). For closed positions = 0.';
comment on column public.positions.realized_pnl_quote is
  'Realized PnL in quote currency. Updated on close. Excludes funding and fees.';
comment on column public.positions.total_funding_quote is
  'Net funding received (+) or paid (-) over the lifetime of the position.';

create index positions_user_status_idx
  on public.positions (user_id, status, opened_at desc)
  where deleted_at is null;

create index positions_user_instrument_idx
  on public.positions (user_id, instrument, opened_at desc)
  where deleted_at is null;

create index positions_connection_idx
  on public.positions (exchange_connection_id, status)
  where deleted_at is null;

create index positions_opened_at_brin
  on public.positions using brin (opened_at);

create trigger positions_updated_at
  before update on public.positions
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- Fills — atomic exchange executions
-- ============================================================================

create table public.fills (
  id                       uuid primary key default uuid_generate_v4(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  exchange_connection_id   uuid not null references public.exchange_connections(id) on delete restrict,
  position_id              uuid references public.positions(id) on delete set null,

  raw_exchange_id          text not null,

  instrument               text not null,
  instrument_type          instrument_type not null,
  side                     fill_side not null,
  position_side            position_side,
  reduce_only              boolean,
  qty                      numeric(38,18) not null check (qty > 0),
  price                    numeric(38,18) not null check (price > 0),
  notional                 numeric(38,18) not null,
  fee                      numeric(38,18) not null default 0,
  fee_currency             text not null,
  fee_kind                 fee_kind not null default 'taker',
  is_maker                 boolean not null default false,

  liquidity_role           text check (liquidity_role in ('maker', 'taker', null)),
  order_id                 text,
  trade_metadata           jsonb not null default '{}'::jsonb,
  raw_payload              jsonb not null default '{}'::jsonb,

  executed_at              timestamptz not null,
  ingested_at              timestamptz not null default now(),

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint uq_fill_idempotency unique (exchange_connection_id, raw_exchange_id)
);

comment on table public.fills is
  'Atomic exchange fill. Idempotent on (exchange_connection_id, raw_exchange_id). Aggregated into Positions.';
comment on column public.fills.raw_exchange_id is
  'Exchange-native trade ID. Combined with exchange_connection_id forms idempotency key.';
comment on column public.fills.position_id is
  'Set by the position-builder job. NULL means fill is unmatched (orphan); surfaced in UI.';
comment on column public.fills.raw_payload is
  'Verbatim exchange payload — audit/debug only. NEVER returned to client.';

create index fills_user_executed_idx
  on public.fills (user_id, executed_at desc);

create index fills_position_idx
  on public.fills (position_id)
  where position_id is not null;

create index fills_unmatched_idx
  on public.fills (user_id, executed_at desc)
  where position_id is null;

create index fills_connection_executed_idx
  on public.fills (exchange_connection_id, executed_at desc);

create index fills_user_instrument_executed_idx
  on public.fills (user_id, instrument, executed_at desc);

create index fills_executed_at_brin
  on public.fills using brin (executed_at);

create trigger fills_updated_at
  before update on public.fills
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- FundingEvents — perp funding payments
-- ============================================================================

create table public.funding_events (
  id                       uuid primary key default uuid_generate_v4(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  exchange_connection_id   uuid not null references public.exchange_connections(id) on delete restrict,
  position_id              uuid references public.positions(id) on delete set null,

  raw_exchange_id          text not null,

  instrument               text not null,
  amount                   numeric(38,18) not null,
  funding_rate             numeric(20,10) not null,
  position_qty             numeric(38,18) not null default 0,
  currency                 text not null,

  event_time               timestamptz not null,
  ingested_at              timestamptz not null default now(),

  raw_payload              jsonb not null default '{}'::jsonb,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint uq_funding_idempotency unique (exchange_connection_id, raw_exchange_id)
);

comment on table public.funding_events is
  'Perp funding payment (signed). 8h on Binance/Bybit/OKX, 1h on Hyperliquid.';
comment on column public.funding_events.amount is
  'Signed funding in `currency`. Positive = received from counterparty. Negative = paid.';
comment on column public.funding_events.position_qty is
  'Position size at the funding tick (informational; for attribution).';

create index funding_user_time_idx
  on public.funding_events (user_id, event_time desc);

create index funding_position_idx
  on public.funding_events (position_id)
  where position_id is not null;

create index funding_connection_time_idx
  on public.funding_events (exchange_connection_id, event_time desc);

create index funding_event_time_brin
  on public.funding_events using brin (event_time);

create trigger funding_events_updated_at
  before update on public.funding_events
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- Sync jobs — surfaced in UI as "exchange syncing now"
-- ============================================================================

create table public.sync_jobs (
  id                       uuid primary key default uuid_generate_v4(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  exchange_connection_id   uuid not null references public.exchange_connections(id) on delete cascade,
  state                    sync_job_state not null default 'queued',
  cursor_from              timestamptz,
  cursor_to                timestamptz,
  fills_pulled             integer not null default 0,
  funding_pulled           integer not null default 0,
  error_code               text,
  error_message            text,
  started_at               timestamptz,
  finished_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index sync_jobs_connection_idx on public.sync_jobs (exchange_connection_id, created_at desc);
create index sync_jobs_state_idx      on public.sync_jobs (state, created_at) where state in ('queued', 'running');
create index sync_jobs_user_idx       on public.sync_jobs (user_id, created_at desc);

create trigger sync_jobs_updated_at
  before update on public.sync_jobs
  for each row execute function public.tg_set_updated_at();
