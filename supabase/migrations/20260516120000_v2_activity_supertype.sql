-- ============================================================================
-- Migration 011 — v2: Activity supertype + per-type subtype tables
--                 (multi-activity journal: spread + trade + sale + airdrop)
--
-- Design doc: docs/specs/2026-05-16-multi-activity-journal-design.md
--
-- This migration:
--   1. Creates new enums: activity_type, activity_status, sale_kind
--   2. Creates the supertype `activity` table with shared columns
--   3. Migrates confirmed spreads → activity rows (preserves UUIDs)
--   4. Drops candidate/rejected rows from spreads (they live on spread_candidates)
--   5. Renames `spreads` → `activity_spread`, drops the columns moved to activity
--   6. Renames `spread_legs.spread_id` → `activity_id` (same UUIDs)
--   7. Renames `notes.spread_id` → `notes.activity_id` (any activity can have one note)
--   8. Renames `spread_tags` → `activity_tags`, `spread_id` → `activity_id`
--   9. Renames `spread_candidates.resulting_spread_id` → `resulting_activity_id`
--  10. Creates `activity_trade`, `activity_sale`, `activity_airdrop`
--  11. Rebuilds `spread_pnl` view to JOIN through activity (output schema preserved)
--  12. Creates `v_activity_feed` view for cross-activity reads
--  13. RLS policies on all new tables
--
-- Reversibility: this migration is NOT reversible without data loss.
-- ============================================================================

-- 1. New enums --------------------------------------------------------------

create type activity_type as enum ('spread', 'trade', 'sale', 'airdrop');

create type activity_status as enum (
  'pending',       -- sale: allocation paid, pre-TGE; airdrop: eligible not claimed
  'open',          -- trade: position active; spread: legs open
  'winding_down',  -- spread: some legs closed
  'orphaned',      -- spread: one leg open with no hedge (alert state)
  'vesting',       -- sale: some claimed, more to vest
  'claimed',       -- airdrop: tokens received (current_price tracked over time)
  'liquidated',    -- trade: position was liquidated
  'expired',       -- spread: dated future settled
  'closed'         -- terminal: fully done
);

create type sale_kind as enum ('ido', 'launchpad', 'premarket', 'otc');

comment on type activity_type is
  'Top-level activity discriminator. Joins to one of activity_spread/trade/sale/airdrop.';
comment on type activity_status is
  'Shared lifecycle states. Each activity type uses a subset (see chk_activity_status_by_type).';
comment on type sale_kind is
  'Sale event kind: IDO / launchpad / premarket / OTC.';

-- 2. Activity supertype table -----------------------------------------------

create table public.activity (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  type                 activity_type not null,
  status               activity_status not null,
  name                 text not null,
  opened_at            timestamptz,
  closed_at            timestamptz,
  capital_deployed_usd numeric(38, 8),
  realized_pnl_usd     numeric(38, 8),
  unrealized_pnl_usd   numeric(38, 8),
  fees_usd             numeric(38, 8) not null default 0,
  net_pnl_usd          numeric(38, 8),
  regime_tags          text[] not null default '{}',
  custom_tags          text[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,

  constraint chk_activity_dates check (
    closed_at is null or opened_at is null or closed_at >= opened_at
  ),
  constraint chk_activity_status_by_type check (
    (type = 'spread'  and status in ('open', 'winding_down', 'orphaned', 'expired', 'closed')) or
    (type = 'trade'   and status in ('open', 'liquidated', 'closed'))                            or
    (type = 'sale'    and status in ('pending', 'vesting', 'closed'))                            or
    (type = 'airdrop' and status in ('pending', 'claimed', 'closed'))
  )
);

comment on table public.activity is
  'Supertype for all journaled activities. Joins to exactly one of activity_spread/trade/sale/airdrop based on type.';
comment on column public.activity.type is
  'Discriminator. Drives which subtype table holds the type-specific fields.';
comment on column public.activity.realized_pnl_usd is
  'Denormalized aggregate for cross-activity sorting/filtering. Computed by app layer or worker.';
comment on column public.activity.net_pnl_usd is
  'Denormalized aggregate. For spreads: realized + basis + funding - fees. For trades: realized - fees. For sales: 0 until exit. For airdrops: value_at_receipt_usd at receipt time.';

-- Indexes
create index activity_user_type_idx
  on public.activity (user_id, type, opened_at desc nulls last)
  where deleted_at is null;
create index activity_user_status_idx
  on public.activity (user_id, status, opened_at desc nulls last)
  where deleted_at is null;
create index activity_user_closed_idx
  on public.activity (user_id, closed_at desc nulls last)
  where deleted_at is null;
create index activity_user_net_pnl_idx
  on public.activity (user_id, net_pnl_usd desc nulls last)
  where deleted_at is null;
create index activity_user_opened_brin
  on public.activity using brin (opened_at);
create index activity_regime_tags_gin
  on public.activity using gin (regime_tags);
create index activity_custom_tags_gin
  on public.activity using gin (custom_tags);
create index activity_name_trgm
  on public.activity using gin (name gin_trgm_ops);

-- updated_at trigger
create trigger activity_updated_at
  before update on public.activity
  for each row execute function public.tg_set_updated_at();

-- 3. Migrate confirmed spreads → activity rows -------------------------------

insert into public.activity (
  id, user_id, type, status, name,
  opened_at, closed_at,
  capital_deployed_usd,
  realized_pnl_usd, fees_usd, net_pnl_usd,
  regime_tags, custom_tags,
  created_at, updated_at, deleted_at
)
select
  s.id,
  s.user_id,
  'spread'::activity_type,
  case s.status
    when 'open'         then 'open'::activity_status
    when 'winding_down' then 'winding_down'::activity_status
    when 'orphaned'     then 'orphaned'::activity_status
    when 'expired'      then 'expired'::activity_status
    when 'closed'       then 'closed'::activity_status
  end,
  s.name,
  s.opened_at, s.closed_at,
  s.capital_deployed_usd,
  s.gross_pnl_quote,                                         -- gross is the realized component for spreads
  s.fees_pnl_quote,                                          -- already signed (negative for fees paid)
  s.net_pnl_quote,
  coalesce(s.regime_tags, '{}'),
  coalesce(s.custom_tags, '{}'),
  s.created_at, s.updated_at, s.deleted_at
from public.spreads s
where s.status in ('open', 'winding_down', 'orphaned', 'expired', 'closed')
  and s.deleted_at is null;

-- 4. Drop candidate/rejected spread rows (they live on spread_candidates) ---

delete from public.spreads
 where status in ('candidate', 'rejected');

-- 5. Drop ALL dependents that block spreads.* column changes ----------------

-- (a) The spread_pnl view holds a column-level lock on spreads.status / name / etc.
drop view if exists public.spread_pnl cascade;

-- (b) The spreads_owner_all RLS policy references user_id (which we're dropping)
drop policy if exists spreads_owner_all on public.spreads;

-- (c) Drop the stale check constraints that referenced status
alter table public.spreads
  drop constraint if exists chk_spread_status_dates;
alter table public.spreads
  drop constraint if exists chk_confidence_only_for_system;

-- (d) Drop the existing updated_at trigger BEFORE dropping its target columns
drop trigger if exists spreads_updated_at on public.spreads;

-- (e) Drop all FKs pointing AT spreads.id (so we can drop+recreate the pkey + rename column)
alter table public.notes               drop constraint if exists notes_spread_id_fkey;
alter table public.spread_legs         drop constraint if exists spread_legs_spread_id_fkey;
alter table public.spread_candidates   drop constraint if exists spread_candidates_resulting_spread_id_fkey;
alter table public.spread_tags         drop constraint if exists spread_tags_spread_id_fkey;

-- (f) Drop indexes on spreads that referenced columns we're removing
drop index if exists public.spreads_user_status_idx;
drop index if exists public.spreads_user_type_idx;
drop index if exists public.spreads_user_apr_idx;
drop index if exists public.spreads_user_opened_brin;
drop index if exists public.spreads_regime_tags_gin;
drop index if exists public.spreads_custom_tags_gin;
drop index if exists public.spreads_exchanges_gin;
drop index if exists public.spreads_name_trgm;

-- 6. Rename spreads → activity_spread, drop migrated columns ----------------

alter table public.spreads rename to activity_spread;

-- Drop the columns we moved to activity
alter table public.activity_spread
  drop column status,
  drop column name,
  drop column user_id,                -- denormalized in activity
  drop column opened_at,
  drop column closed_at,
  drop column capital_deployed_usd,
  drop column gross_pnl_quote,        -- → activity.realized_pnl_usd
  drop column fees_pnl_quote,         -- → activity.fees_usd
  drop column net_pnl_quote,          -- → activity.net_pnl_usd
  drop column regime_tags,
  drop column custom_tags,
  drop column created_at,
  drop column updated_at,
  drop column deleted_at,
  drop column notes_summary;          -- redundant with notes table

-- Rename id → activity_id (it IS the activity's PK)
alter table public.activity_spread drop constraint spreads_pkey;
alter table public.activity_spread rename column id to activity_id;
alter table public.activity_spread add primary key (activity_id);
alter table public.activity_spread
  add constraint activity_spread_activity_fk
  foreign key (activity_id) references public.activity(id) on delete cascade;

comment on table public.activity_spread is
  'Spread-specific columns for an activity. JOIN to activity for shared fields.';

-- Add subtype-specific indexes
create index activity_spread_type_idx
  on public.activity_spread (spread_type);
create index activity_spread_exchanges_gin
  on public.activity_spread using gin (exchanges);

-- 7. Update spread_legs (rename column + new FK) -----------------------------

alter table public.spread_legs drop constraint if exists uq_spread_leg;
alter table public.spread_legs drop constraint if exists uq_position_in_one_spread;

alter table public.spread_legs rename column spread_id to activity_id;

alter table public.spread_legs
  add constraint spread_legs_activity_fk
  foreign key (activity_id) references public.activity_spread(activity_id) on delete cascade;

alter table public.spread_legs
  add constraint uq_activity_leg unique (activity_id, position_id);

-- Keep the "one position per spread" invariant
alter table public.spread_legs
  add constraint uq_position_in_one_activity unique (position_id);

-- Rename index
alter index if exists public.spread_legs_spread_idx rename to spread_legs_activity_idx;

comment on table public.spread_legs is
  'Maps a Position into a Spread (activity_spread) with a role label. A position participates in at most one spread.';

-- 8. Update notes (rename column + new FK) ----------------------------------

alter table public.notes drop constraint if exists uq_one_note_per_spread;

alter table public.notes rename column spread_id to activity_id;

alter table public.notes
  add constraint notes_activity_fk
  foreign key (activity_id) references public.activity(id) on delete cascade;

alter table public.notes
  add constraint uq_one_note_per_activity unique (activity_id);

alter index if exists public.notes_spread_idx rename to notes_activity_idx;

comment on table public.notes is
  'One markdown note per activity (1:1, any activity type). entry_rationale + exit_conclusion are structured highlight fields.';

-- 9. Rename spread_tags → activity_tags --------------------------------------

alter table public.spread_tags drop constraint if exists spread_tags_pkey;

alter table public.spread_tags rename to activity_tags;
alter table public.activity_tags rename column spread_id to activity_id;

alter table public.activity_tags
  add constraint activity_tags_activity_fk
  foreign key (activity_id) references public.activity(id) on delete cascade;

alter table public.activity_tags
  add primary key (activity_id, tag_id);

alter index if exists public.spread_tags_tag_idx rename to activity_tags_tag_idx;
alter index if exists public.spread_tags_user_idx rename to activity_tags_user_idx;

comment on table public.activity_tags is
  'M:N: any activity (spread/trade/sale/airdrop) to controlled-vocabulary tags.';

-- 10. Update spread_candidates.resulting_spread_id → resulting_activity_id ----

alter table public.spread_candidates
  rename column resulting_spread_id to resulting_activity_id;

alter table public.spread_candidates
  add constraint spread_candidates_resulting_activity_fk
  foreign key (resulting_activity_id) references public.activity(id) on delete set null;

comment on column public.spread_candidates.resulting_activity_id is
  'If user accepted this candidate, the resulting activity (type=spread) row id.';

-- 10. New subtype: activity_trade -------------------------------------------

create table public.activity_trade (
  activity_id     uuid primary key references public.activity(id) on delete cascade,
  position_id     uuid not null references public.positions(id) on delete restrict,
  symbol          text not null,
  exchange        text not null references public.exchange_catalog(code),
  instrument_kind instrument_type not null,
  side            position_side not null,
  entry_thesis    text,
  exit_plan       text,
  target_price    numeric(38, 18),
  stop_price      numeric(38, 18),
  qty             numeric(38, 18) not null,
  avg_entry_price numeric(38, 18) not null,
  avg_exit_price  numeric(38, 18),
  realized_apr    numeric(20, 8),

  constraint uq_trade_position unique (position_id)
);

comment on table public.activity_trade is
  'Trade activity subtype: a journaled Position. The picker shows your Positions; you select one to promote to a Trade with notes/postmortem.';
comment on column public.activity_trade.position_id is
  'The promoted Position. Restrict-deletes — you can''t delete a Position that''s been journaled.';
comment on column public.activity_trade.realized_apr is
  'Annualized return for the holding period. (net_pnl / capital) * (365 / days_held).';

create index activity_trade_position_idx on public.activity_trade (position_id);
create index activity_trade_exchange_idx on public.activity_trade (exchange);

-- 11. New subtype: activity_sale --------------------------------------------

create table public.activity_sale (
  activity_id          uuid primary key references public.activity(id) on delete cascade,
  token_symbol         text not null,
  token_name           text,
  token_chain          text,
  sale_kind            sale_kind not null,
  sale_venue           text,
  sale_date            timestamptz not null,
  usd_paid             numeric(38, 8) not null,
  tokens_allocated     numeric(38, 18) not null,
  effective_price_usd  numeric(38, 18) generated always as (
    case when tokens_allocated > 0 then usd_paid / tokens_allocated else null end
  ) stored,
  vesting_schedule     jsonb,
  claim_events         jsonb not null default '[]'::jsonb,
  total_claimed        numeric(38, 18) not null default 0,
  remaining_locked     numeric(38, 18),

  constraint chk_sale_amounts check (usd_paid >= 0 and tokens_allocated >= 0)
);

comment on table public.activity_sale is
  'Sale activity subtype: IDO/launchpad/premarket/OTC. Always manually entered.';
comment on column public.activity_sale.vesting_schedule is
  'JSON: {tge_pct, cliff_days, linear_days} or {kind:"custom", entries:[{date, pct}]}. App-layer Zod validation.';
comment on column public.activity_sale.claim_events is
  'JSONB array of {date, qty, tx_hash?} claim events. App-layer Zod validation.';

create index activity_sale_token_idx     on public.activity_sale (token_symbol);
create index activity_sale_kind_idx      on public.activity_sale (sale_kind);
create index activity_sale_date_idx      on public.activity_sale (sale_date desc);

-- 12. New subtype: activity_airdrop -----------------------------------------

create table public.activity_airdrop (
  activity_id          uuid primary key references public.activity(id) on delete cascade,
  token_symbol         text not null,
  token_name           text,
  token_chain          text,
  protocol             text not null,
  snapshot_date        timestamptz,
  eligibility_reason   text,
  qty_received         numeric(38, 18) not null,
  claim_date           timestamptz,
  claim_tx_hash        text,
  value_at_receipt_usd numeric(38, 8),
  current_price_usd    numeric(38, 18),
  current_price_at     timestamptz,

  constraint chk_airdrop_qty check (qty_received >= 0)
);

comment on table public.activity_airdrop is
  'Airdrop activity subtype: tokens received from a protocol. Always manually entered.';

create index activity_airdrop_token_idx    on public.activity_airdrop (token_symbol);
create index activity_airdrop_protocol_idx on public.activity_airdrop (protocol);

-- 13. Rebuild spread_pnl view ------------------------------------------------
-- IMPORTANT: this view's output column names match migration 010's output so
-- existing API routes and (eventual) UI consumers don't break.

drop view if exists public.spread_pnl cascade;

create view public.spread_pnl as
with leg_pnl as (
  select
    sl.activity_id                            as spread_id,    -- output name preserved
    a.user_id,
    sum(pp.realized_pnl_quote)                as realized_pnl,
    sum(coalesce(pp.unrealized_pnl_quote, 0)) as unrealized_pnl,
    sum(pp.total_funding_quote)               as funding_pnl,
    sum(pp.total_fees_quote)                  as fees,
    count(*)                                  as leg_count
  from public.spread_legs sl
  join public.activity     a  on a.id           = sl.activity_id
  join public.position_pnl pp on pp.position_id = sl.position_id
  where a.deleted_at is null and a.type = 'spread'
  group by sl.activity_id, a.user_id
),
metrics as (
  select
    a.id                                          as spread_id,
    a.user_id,
    asp.spread_type,
    asp.variant,
    a.status,
    a.name,
    asp.primary_base,
    a.opened_at,
    a.closed_at,
    a.capital_deployed_usd,
    asp.target_apr_at_open,
    asp.expected_holding_days,
    a.regime_tags,
    a.custom_tags,
    asp.exchanges,
    a.created_at,
    a.updated_at,
    coalesce(lp.leg_count, 0)                     as leg_count,

    -- PnL decomposition (the stacked-bar chart's inputs)
    coalesce(lp.realized_pnl,   0)                as realized_pnl_quote,
    coalesce(lp.unrealized_pnl, 0)                as basis_pnl_quote,
    coalesce(lp.funding_pnl,    0)                as funding_received_quote,
    coalesce(lp.fees,           0)                as fees_quote,

    (coalesce(lp.realized_pnl,   0)
     + coalesce(lp.unrealized_pnl, 0)
     + coalesce(lp.funding_pnl,  0)
     - coalesce(lp.fees,         0))              as net_pnl_quote,

    (coalesce(lp.realized_pnl,   0)
     + coalesce(lp.unrealized_pnl, 0))            as gross_pnl_quote,

    case
      when a.opened_at is null then null
      else extract(epoch from (coalesce(a.closed_at, now()) - a.opened_at)) / 86400.0
    end                                           as days_held
  from public.activity a
  join public.activity_spread asp on asp.activity_id = a.id
  left join leg_pnl lp on lp.spread_id = a.id
  where a.type = 'spread' and a.deleted_at is null
)
select
  m.*,

  -- Realized APR on capital (linear, no compounding)
  case
    when m.capital_deployed_usd is null or m.capital_deployed_usd = 0 then null
    when m.days_held is null or m.days_held = 0 then null
    else (m.net_pnl_quote / m.capital_deployed_usd) * (365.0 / m.days_held)
  end                                             as realized_apr,

  case
    when m.capital_deployed_usd is null or m.capital_deployed_usd = 0 then null
    else (m.net_pnl_quote / m.capital_deployed_usd) * 10000
  end                                             as bps_captured_net,

  case
    when m.capital_deployed_usd is null or m.capital_deployed_usd = 0 then null
    when m.days_held is null or m.days_held = 0 then null
    else ((m.net_pnl_quote / m.capital_deployed_usd) * 10000) / m.days_held
  end                                             as bps_per_day,

  case
    when m.target_apr_at_open is null or m.target_apr_at_open = 0 then null
    when m.capital_deployed_usd is null or m.capital_deployed_usd = 0 then null
    when m.days_held is null or m.days_held = 0 then null
    else ((m.net_pnl_quote / m.capital_deployed_usd) * (365.0 / m.days_held))
         / m.target_apr_at_open
  end                                             as realized_vs_expected_apr,

  case m.spread_type
    when 'cross_exchange_perp_arb' then 'bps_captured'
    when 'cash_carry'              then 'realized_apr'
    when 'calendar'                then 'bps_per_day'
    when 'funding_capture'         then 'realized_apr'
    when 'dex_cex_arb'             then 'bps_captured'
    else                                'net_pnl_quote'
  end                                             as card_headline_metric,

  case m.spread_type
    when 'cross_exchange_perp_arb'
      then (m.net_pnl_quote / nullif(m.capital_deployed_usd, 0)) * 10000
    when 'cash_carry'
      then case when m.days_held is null or m.days_held = 0 then null
                else (m.net_pnl_quote / nullif(m.capital_deployed_usd, 0))
                     * (365.0 / m.days_held) end
    when 'calendar'
      then case when m.days_held is null or m.days_held = 0 then null
                else ((m.net_pnl_quote / nullif(m.capital_deployed_usd, 0)) * 10000)
                     / m.days_held end
    when 'funding_capture'
      then case when m.days_held is null or m.days_held = 0 then null
                else (m.net_pnl_quote / nullif(m.capital_deployed_usd, 0))
                     * (365.0 / m.days_held) end
    when 'dex_cex_arb'
      then (m.net_pnl_quote / nullif(m.capital_deployed_usd, 0)) * 10000
    else m.net_pnl_quote
  end                                             as card_headline_value,

  case m.spread_type
    when 'cross_exchange_perp_arb' then 'bps'
    when 'cash_carry'              then 'apr_pct'
    when 'calendar'                then 'bps_per_day'
    when 'funding_capture'         then 'apr_pct'
    when 'dex_cex_arb'             then 'bps'
    else                                'usd'
  end                                             as card_headline_format
from metrics m;

comment on view public.spread_pnl is
  'Per-spread aggregate + PnL decomposition + per-type card headline. Reads via activity + activity_spread join. Output column names preserve migration-010 contract.';

-- 14. New cross-activity view -----------------------------------------------

create view public.v_activity_feed as
select
  a.id, a.user_id, a.type, a.status, a.name,
  a.opened_at, a.closed_at,
  a.capital_deployed_usd, a.realized_pnl_usd, a.unrealized_pnl_usd,
  a.fees_usd, a.net_pnl_usd,
  a.regime_tags, a.custom_tags,

  -- Polymorphic card headline value
  case a.type
    when 'spread'  then asp.apr
    when 'trade'   then att.realized_apr
    when 'sale'    then case
      when ase.usd_paid > 0 and ase.tokens_allocated > 0
        then (ase.tokens_allocated * coalesce(ase.effective_price_usd, 0)) / ase.usd_paid
      else null
    end
    when 'airdrop' then case
      when ada.value_at_receipt_usd > 0 and ada.current_price_usd is not null
        then (ada.current_price_usd * ada.qty_received) / ada.value_at_receipt_usd
      else null
    end
  end                                                       as headline_value,

  case a.type
    when 'spread'  then 'realized_apr'
    when 'trade'   then 'realized_apr'
    when 'sale'    then 'mtm_multiplier'
    when 'airdrop' then 'mtm_multiplier'
  end                                                       as headline_kind,

  -- Subtype-specific symbol/asset hint for the unified feed
  case a.type
    when 'spread'  then asp.primary_base
    when 'trade'   then att.symbol
    when 'sale'    then ase.token_symbol
    when 'airdrop' then ada.token_symbol
  end                                                       as primary_symbol,

  a.created_at, a.updated_at
from public.activity a
left join public.activity_spread  asp on asp.activity_id = a.id and a.type = 'spread'
left join public.activity_trade   att on att.activity_id = a.id and a.type = 'trade'
left join public.activity_sale    ase on ase.activity_id = a.id and a.type = 'sale'
left join public.activity_airdrop ada on ada.activity_id = a.id and a.type = 'airdrop'
where a.deleted_at is null;

comment on view public.v_activity_feed is
  'Polymorphic cross-activity feed. One row per activity. headline_value + headline_kind drive the activity-agnostic card rendering.';

-- 15. RLS policies ---------------------------------------------------------

alter table public.activity enable row level security;
create policy activity_owner_all on public.activity
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Subtype policies check via JOIN to activity. We can't rely on CASCADE alone
-- since RLS checks at SELECT time, not delete time.

alter table public.activity_spread enable row level security;
create policy activity_spread_owner_all on public.activity_spread
  for all to authenticated
  using (exists (
    select 1 from public.activity a
     where a.id = activity_spread.activity_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.activity a
     where a.id = activity_spread.activity_id and a.user_id = auth.uid()
  ));

alter table public.activity_trade enable row level security;
create policy activity_trade_owner_all on public.activity_trade
  for all to authenticated
  using (exists (
    select 1 from public.activity a
     where a.id = activity_trade.activity_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.activity a
     where a.id = activity_trade.activity_id and a.user_id = auth.uid()
  ));

alter table public.activity_sale enable row level security;
create policy activity_sale_owner_all on public.activity_sale
  for all to authenticated
  using (exists (
    select 1 from public.activity a
     where a.id = activity_sale.activity_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.activity a
     where a.id = activity_sale.activity_id and a.user_id = auth.uid()
  ));

alter table public.activity_airdrop enable row level security;
create policy activity_airdrop_owner_all on public.activity_airdrop
  for all to authenticated
  using (exists (
    select 1 from public.activity a
     where a.id = activity_airdrop.activity_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.activity a
     where a.id = activity_airdrop.activity_id and a.user_id = auth.uid()
  ));

-- The renamed activity_tags table — RLS policy was on spread_tags
-- It survived the rename but the policy is named spread_tags_owner_all; recreate
drop policy if exists spread_tags_owner_all on public.activity_tags;
create policy activity_tags_owner_all on public.activity_tags
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- spread_legs RLS policy survives (uses user_id which still exists)
-- notes RLS policy survives (uses user_id which still exists)

-- 16. Grants ---------------------------------------------------------------

grant select on public.spread_pnl      to authenticated;
grant select on public.v_activity_feed to authenticated;
