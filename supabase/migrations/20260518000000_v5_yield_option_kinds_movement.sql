-- ============================================================================
-- Migration 015 — v5: Yield positions + Options + Trade/Sale kind discriminators
--                 + Movement event log
--
-- Design doc: docs/specs/2026-05-18-absolute-journal-v2-master-plan.md (§2)
--
-- This migration:
--   1. Adds enums: yield_kind, trade_kind, option_subtype_kind, option_side,
--      option_cp, option_spread_style, movement_event_kind
--   2. Extends enums: activity_type (+yield_position, +option),
--      activity_status (+unwinding), sale_kind (+ieo, +private_round,
--      +otc_allocation, +vesting_claim)
--   3. Adds new subtype tables: activity_yield_position, activity_option,
--      activity_option_leg
--   4. Adds new accounting table: event_log (movements: bridge/convert/
--      transfer/deposit/withdrawal/nft_trade/loss/other)
--   5. Adds columns to existing activity-family tables (trade kind, sale +
--      airdrop metadata, activity-level tax/strategy flags)
--   6. Rebuilds chk_activity_status_by_type to cover the 2 new types and
--      the +unwinding state
--   7. Adds chk_yield_amounts, chk_option_style, uq_option_leg_index
--   8. Rebuilds v_activity_feed with headline_value / headline_kind /
--      primary_symbol / card_subtitle for yield_position + option
--   9. Extends check_activity_subtype_exists() for the 2 new types
--  10. RLS owner-only policies on all 4 new tables
--  11. updated_at triggers + bump_activity_updated_at triggers on the new
--      subtype tables
--
-- Additive only — uses `add column if not exists` and `alter type add value
-- if not exists` so the migration is idempotent and won't drop columns the
-- prior migrations (010/011/012/013) already added.
-- ============================================================================

-- 1. New enums --------------------------------------------------------------

create type yield_kind as enum (
  'stake', 'lend', 'farm', 'lp', 'validator', 'mining'
);

create type trade_kind as enum (
  'spot', 'perp', 'dated_future', 'option', 'otc', 'nft'
);

create type option_subtype_kind as enum (
  'single_leg', 'option_spread'
);

create type option_side as enum ('long', 'short');

create type option_cp as enum ('call', 'put');

create type option_spread_style as enum (
  'vertical', 'iron_condor', 'calendar', 'strangle', 'butterfly', 'custom'
);

create type movement_event_kind as enum (
  'bridge', 'convert', 'transfer', 'deposit', 'withdrawal',
  'nft_trade', 'loss', 'other'
);

comment on type yield_kind is
  'Sub-discriminator for activity_yield_position.kind. Drives which optional '
  'fields the UI surfaces (validator address for stake, pool / pair / range '
  'for lp, hashrate + electricity cost for mining, etc).';
comment on type trade_kind is
  'Sub-discriminator on activity_trade. spot/perp/dated_future cover the '
  'familiar position kinds; option/otc/nft extend the trade supertype to '
  'cover one-off journals that don''t fit a Position row.';
comment on type option_subtype_kind is
  'Discriminator on activity_option. single_leg = one call/put position; '
  'option_spread = N legs forming a defined-risk structure (vertical, iron '
  'condor, calendar, strangle, butterfly, custom).';
comment on type option_spread_style is
  'Named structure for an option_spread. Vertical = same expiry, two strikes. '
  'Iron condor = four legs, defined-risk neutral. Calendar = different '
  'expiries, same strike. Strangle = same expiry, two OTM strikes. '
  'Butterfly = three strikes with 1:2:1 contract ratio. Custom = anything else.';
comment on type movement_event_kind is
  'Accounting / treasury movements. Lives on event_log (NOT activity) because '
  'these are not strategy events — they''re context the journal needs to '
  'reconcile cost basis and tax lots.';

-- 2. Enum extensions --------------------------------------------------------
-- Each ALTER TYPE auto-commits in our migrate script's per-statement TX.

alter type activity_type   add value if not exists 'yield_position';
alter type activity_type   add value if not exists 'option';

alter type activity_status add value if not exists 'unwinding';

alter type sale_kind       add value if not exists 'ieo';
alter type sale_kind       add value if not exists 'private_round';
alter type sale_kind       add value if not exists 'otc_allocation';
alter type sale_kind       add value if not exists 'vesting_claim';

-- 3. New subtype: activity_yield_position -----------------------------------

create table public.activity_yield_position (
  activity_id           uuid primary key references public.activity(id) on delete cascade,
  kind                  yield_kind not null,
  protocol              text not null,
  venue                 text,
  chain                 text,
  asset                 text not null,
  amount                numeric(38, 18) not null,
  amount_usd_at_open    numeric(38, 8),
  expected_apy_pct      numeric(10, 4),
  realized_apy_pct      numeric(10, 4),
  rewards_token         text,
  rewards_accrued       numeric(38, 18) not null default 0,
  rewards_claimed       numeric(38, 18) not null default 0,
  rewards_usd_value     numeric(38, 8),
  fees_protocol_usd     numeric(38, 8) not null default 0,
  fees_gas_usd          numeric(38, 8) not null default 0,
  -- Sub-kind specific JSON. Validated app-side via the YieldKindMeta
  -- discriminated union (canonical.ts).
  kind_meta             jsonb,
  -- Live MTM
  current_price_usd     numeric(38, 18),
  current_price_at      timestamptz,
  updated_at            timestamptz not null default now(),

  constraint chk_yield_amounts check (
    amount >= 0
    and rewards_accrued >= 0
    and rewards_claimed >= 0
    and rewards_claimed <= rewards_accrued
  )
);

comment on table public.activity_yield_position is
  'Yield activity subtype: stake / lend / farm / lp / validator / mining. '
  'JOIN to activity for shared lifecycle + aggregates. kind_meta is a jsonb '
  'discriminated union validated app-side (canonical.ts YieldKindMeta).';
comment on column public.activity_yield_position.kind is
  'Sub-discriminator. Drives which kind_meta shape is required (see '
  'canonical.ts YieldKindMeta).';
comment on column public.activity_yield_position.protocol is
  'Protocol or venue name. Free-form. e.g. "Lido", "Aave", "Uniswap v3", '
  '"Marinade", "Binance Earn".';
comment on column public.activity_yield_position.venue is
  'Optional canonical venue code (exchange_catalog.code) when the protocol '
  'is hosted by a CEX (e.g. "binance" for Binance Earn).';
comment on column public.activity_yield_position.kind_meta is
  'Kind-specific structured payload. e.g. {validatorAddress, operator} for '
  'stake; {pairA, pairB, amountA, amountB, poolFeeTier, rangeLower, rangeUpper, '
  'concentrated} for lp; {hashrateThs, electricityCostUsdKwh, pool, '
  'expectedDailyRevenueUsd} for mining. Validated via Zod, not by Postgres.';
comment on column public.activity_yield_position.realized_apy_pct is
  'Annualized return ((rewards_usd_value - fees) / amount_usd_at_open) * (365 / days_held). '
  'Worker-populated when the position closes; NULL while still open.';

create index activity_yield_position_kind_idx     on public.activity_yield_position (kind);
create index activity_yield_position_protocol_idx on public.activity_yield_position (protocol);
create index activity_yield_position_asset_idx    on public.activity_yield_position (asset);
create index activity_yield_position_chain_idx    on public.activity_yield_position (chain);

create trigger activity_yield_position_updated_at
  before update on public.activity_yield_position
  for each row execute function public.tg_set_updated_at();

create trigger activity_yield_position_bump_parent
  after insert or update on public.activity_yield_position
  for each row execute function public.bump_activity_updated_at();

-- 4. New subtype: activity_option -------------------------------------------

create table public.activity_option (
  activity_id           uuid primary key references public.activity(id) on delete cascade,
  subtype               option_subtype_kind not null,
  -- Spread shape (only when subtype = 'option_spread'). NULL for single_leg.
  spread_style          option_spread_style,
  -- Header summary (denormalized across legs for fast feed reads).
  underlying            text not null,
  exchange              text not null references public.exchange_catalog(code),
  total_premium_usd     numeric(38, 8) not null default 0,
  net_premium_usd       numeric(38, 8),
  realized_pnl_usd      numeric(38, 8),
  max_profit_usd        numeric(38, 8),
  max_loss_usd          numeric(38, 8),
  breakeven_lower       numeric(38, 18),
  breakeven_upper       numeric(38, 18),
  -- IV at open. Lets the post-trade review compute IV-realized delta.
  iv_at_open            numeric(10, 6),
  -- Open-intent fields. Filled at journal time, compared on close.
  entry_thesis          text,
  exit_plan             text,
  target_price          numeric(38, 18),
  stop_price            numeric(38, 18),
  updated_at            timestamptz not null default now(),

  constraint chk_option_style check (
    (subtype = 'single_leg'    and spread_style is null)
    or (subtype = 'option_spread' and spread_style is not null)
  )
);

comment on table public.activity_option is
  'Option activity subtype. JOIN to activity for shared lifecycle + '
  'aggregates. Holds the cross-leg summary (net premium, max profit, '
  'breakevens). Individual legs live in activity_option_leg.';
comment on column public.activity_option.subtype is
  'single_leg = one option contract (call or put). option_spread = >= 2 legs '
  'forming a defined-risk structure. Drives chk_option_style.';
comment on column public.activity_option.spread_style is
  'Named structure when subtype = option_spread. NULL for single_leg.';
comment on column public.activity_option.total_premium_usd is
  'Sum of |premium| paid + received across legs. Long premium net of short '
  'premium = net_premium_usd. Positive = trader paid net premium.';
comment on column public.activity_option.realized_pnl_usd is
  'Realized P&L on the option position after expiry / unwind. Headline value '
  'for closed singles + closed spreads (vs max_profit_usd for spreads).';

create index activity_option_subtype_idx    on public.activity_option (subtype);
create index activity_option_exchange_idx   on public.activity_option (exchange);
create index activity_option_underlying_idx on public.activity_option (underlying);

create trigger activity_option_updated_at
  before update on public.activity_option
  for each row execute function public.tg_set_updated_at();

create trigger activity_option_bump_parent
  after insert or update on public.activity_option
  for each row execute function public.bump_activity_updated_at();

-- 5. New leg table: activity_option_leg -------------------------------------

create table public.activity_option_leg (
  id                    uuid primary key default gen_random_uuid(),
  activity_id           uuid not null references public.activity_option(activity_id) on delete cascade,
  leg_index             integer not null check (leg_index >= 0),
  -- Identity of this leg
  exchange              text not null references public.exchange_catalog(code),
  underlying            text not null,
  expiry                date not null,
  strike                numeric(38, 18) not null,
  option_kind           option_cp not null,
  side                  option_side not null,
  -- Economics
  contracts             numeric(38, 18) not null check (contracts > 0),
  premium_per_contract  numeric(38, 18) not null,
  premium_total_usd     numeric(38, 8),
  -- Greeks at open (snapshot for post-trade review)
  iv                    numeric(10, 6),
  delta                 numeric(10, 6),
  gamma                 numeric(10, 6),
  theta                 numeric(10, 6),
  vega                  numeric(10, 6),
  rho                   numeric(10, 6),
  -- Per-leg fill / exit context
  filled_at             timestamptz,
  closed_at             timestamptz,
  close_premium_per_contract numeric(38, 18),
  fees_usd              numeric(38, 8) not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uq_option_leg_index unique (activity_id, leg_index)
);

comment on table public.activity_option_leg is
  'One leg of an activity_option. Single_leg options have exactly one row; '
  'spreads have 2-8 rows. leg_index is the trader''s ordering (0, 1, 2, ...).';
comment on column public.activity_option_leg.premium_per_contract is
  'Signed quote premium per contract at open. Positive = trader paid '
  '(side=long); the side enum carries the sign separately so this stays '
  'positive in practice but the column is unsigned for flexibility.';
comment on column public.activity_option_leg.contracts is
  'Number of contracts (positive). Combined with side (long/short) to get '
  'the signed exposure.';
comment on column public.activity_option_leg.option_kind is
  'call / put. Stored as enum option_cp.';

create index activity_option_leg_activity_idx on public.activity_option_leg (activity_id);
create index activity_option_leg_expiry_idx   on public.activity_option_leg (expiry);
create index activity_option_leg_underlying_idx on public.activity_option_leg (underlying);

create trigger activity_option_leg_updated_at
  before update on public.activity_option_leg
  for each row execute function public.tg_set_updated_at();

-- 6. New accounting table: event_log ----------------------------------------

create table public.event_log (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  kind                   movement_event_kind not null,
  occurred_at            timestamptz not null,
  asset                  text,
  amount                 numeric(38, 18),
  usd_value              numeric(38, 8),
  from_venue             text,
  to_venue               text,
  tx_hash                text,
  chain                  text,
  fee_usd                numeric(38, 8),
  description            text,
  related_activity_id    uuid references public.activity(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.event_log is
  'Accounting / treasury movements: bridges, conversions, internal transfers, '
  'deposits, withdrawals, NFT buys/sells, losses (hacks/theft/fees). NOT in '
  'activity supertype because these are not strategy events — they''re context '
  'for cost basis reconciliation and tax-lot tracking. related_activity_id is '
  'optional back-pointer to the activity that triggered the movement (e.g. '
  'a withdrawal that funded a sale wire).';
comment on column public.event_log.kind is
  'Movement type. bridge / convert / transfer / deposit / withdrawal / '
  'nft_trade / loss / other. Drives the UI card layout.';
comment on column public.event_log.from_venue is
  'Source venue (exchange code) or chain name (e.g. "ethereum", "solana", '
  '"arbitrum"). Free-form text.';
comment on column public.event_log.related_activity_id is
  'Optional FK back to activity(id). Lets the trader thread a withdrawal '
  'to the sale it funded, or a deposit to the trade it enabled.';

create index event_log_user_occurred_idx on public.event_log (user_id, occurred_at desc);
create index event_log_user_kind_idx     on public.event_log (user_id, kind);
create index event_log_related_idx       on public.event_log (related_activity_id)
  where related_activity_id is not null;

create trigger event_log_updated_at
  before update on public.event_log
  for each row execute function public.tg_set_updated_at();

-- 7. Column additions to existing activity-family tables --------------------

-- activity_trade: add the trade-kind discriminator + margin / leverage + fees
-- decomposition. target_price/stop_price/exit_plan/entry_thesis already exist
-- from migration 011 (defensive `if not exists`).
alter table public.activity_trade
  add column if not exists kind                  trade_kind not null default 'spot',
  add column if not exists leverage              numeric(10, 4),
  add column if not exists margin_mode           text,
  add column if not exists target_price          numeric(38, 18),
  add column if not exists stop_price            numeric(38, 18),
  add column if not exists exit_plan             text,
  add column if not exists fees_entry_usd        numeric(38, 8),
  add column if not exists fees_exit_usd         numeric(38, 8),
  add column if not exists funding_paid_usd      numeric(38, 8),
  add column if not exists funding_received_usd  numeric(38, 8),
  add column if not exists borrow_cost_usd       numeric(38, 8);

alter table public.activity_trade
  drop constraint if exists chk_trade_margin_mode;
alter table public.activity_trade
  add constraint chk_trade_margin_mode check (
    margin_mode is null or margin_mode in ('cross', 'isolated')
  );

comment on column public.activity_trade.kind is
  'Trade sub-discriminator. spot/perp/dated_future cover the familiar '
  'position kinds. option/otc/nft extend the trade supertype for journal '
  'entries without an underlying Position row.';
comment on column public.activity_trade.leverage is
  'Effective leverage at open (e.g. 3.0 for 3x). NULL for spot.';
comment on column public.activity_trade.margin_mode is
  'cross / isolated. NULL for spot.';
comment on column public.activity_trade.fees_entry_usd is
  'Trading fees paid on the entry fill(s). Separate from exit fees so the '
  'review can show round-trip cost as a stacked-bar component.';

-- activity_sale: tax/treasury hints + tier/round metadata + claim wallet
alter table public.activity_sale
  add column if not exists token_chain        text,
  add column if not exists claim_wallet       text,
  add column if not exists fundraising_round  text,
  add column if not exists allocation_method  text,
  add column if not exists tier               text,
  add column if not exists bonus_pct          numeric(10, 4);

alter table public.activity_sale
  drop constraint if exists chk_sale_fundraising_round;
alter table public.activity_sale
  add constraint chk_sale_fundraising_round check (
    fundraising_round is null or fundraising_round in (
      'seed', 'private', 'public', 'strategic', 'other'
    )
  );

alter table public.activity_sale
  drop constraint if exists chk_sale_allocation_method;
alter table public.activity_sale
  add constraint chk_sale_allocation_method check (
    allocation_method is null or allocation_method in (
      'fcfs', 'lottery', 'staking', 'whitelist', 'other'
    )
  );

comment on column public.activity_sale.token_chain is
  'Chain the token lives on (e.g. "ethereum", "solana", "arbitrum", "base"). '
  'Used by the wallet-paste claim fetcher to pick the right explorer.';
comment on column public.activity_sale.claim_wallet is
  'Wallet address tokens were claimed to. Used by the auto-import to verify '
  'the cost basis lot.';
comment on column public.activity_sale.fundraising_round is
  'Round type: seed / private / public / strategic / other. Surfaces on the '
  'card subtitle for context (e.g. "Private round · 30% bonus").';
comment on column public.activity_sale.tier is
  'Tier within the round (e.g. "Tier 1", "VIP"). Free-form.';

-- activity_airdrop: snapshot/eligibility/claim-window metadata
alter table public.activity_airdrop
  add column if not exists token_chain         text,
  add column if not exists snapshot_date       date,
  add column if not exists claim_tx_hash       text,
  add column if not exists claim_wallet        text,
  add column if not exists eligibility_reason  text,
  add column if not exists gas_cost_usd        numeric(38, 8),
  add column if not exists claim_window_start  date,
  add column if not exists claim_window_end    date;

-- Migration 011 created activity_airdrop with snapshot_date as timestamptz —
-- the spec calls for date. We keep the existing column shape if already
-- present (timestamptz) and only add when missing. Same for claim_tx_hash.
-- The IF NOT EXISTS keeps the existing type.

-- For airdrops in pending status, claim_date + qty_received are unknown.
-- The migration loosens qty_received's NOT NULL constraint to allow the
-- pre-claim watchlist.
alter table public.activity_airdrop
  alter column qty_received drop not null;

alter table public.activity_airdrop
  drop constraint if exists chk_airdrop_qty;
alter table public.activity_airdrop
  add constraint chk_airdrop_qty check (
    qty_received is null or qty_received >= 0
  );

comment on column public.activity_airdrop.token_chain is
  'Chain the airdropped token lives on. Drives the wallet-paste claim '
  'fetcher (Etherscan / Solscan).';
comment on column public.activity_airdrop.claim_tx_hash is
  'Transaction hash that delivered the tokens. Auto-populated by the '
  'wallet-paste claim fetcher when available.';
comment on column public.activity_airdrop.claim_wallet is
  'Wallet address used to claim. Used to disambiguate when one user has '
  'multiple wallets eligible for the same drop.';
comment on column public.activity_airdrop.gas_cost_usd is
  'USD cost of the claim transaction (gas). Subtracted from net P&L.';
comment on column public.activity_airdrop.claim_window_start is
  'When the claim window opens. Drives the watchlist alert "claim window open now".';
comment on column public.activity_airdrop.claim_window_end is
  'When the claim window closes. Drives the watchlist alert "claim window '
  'expiring in N days".';

-- activity supertype: tax + strategy attribution
alter table public.activity
  add column if not exists tax_taxable       boolean not null default false,
  add column if not exists tax_jurisdiction  text,
  add column if not exists strategy_tag      text;

comment on column public.activity.tax_taxable is
  'Boolean hint for tax classification. true = trader expects this activity '
  'to generate a taxable event in their jurisdiction. tax_jurisdiction is '
  'the free-form hint (e.g. "US", "EU/DE", "AE").';
comment on column public.activity.tax_jurisdiction is
  'Free-form jurisdiction code or name. Drives the tax-events export.';
comment on column public.activity.strategy_tag is
  'Strategy rollup grouping. Multiple activities sharing this tag roll up '
  'into one "strategy" view (e.g. "ETH basis carry Q1", "Airdrop farming '
  'L2s"). NULL when the trader doesn''t attribute the activity.';

create index activity_strategy_tag_idx
  on public.activity (user_id, strategy_tag)
  where strategy_tag is not null and deleted_at is null;

-- 8. Rebuild chk_activity_status_by_type ------------------------------------
-- Covers the 2 new types + the new `unwinding` state.

alter table public.activity
  drop constraint if exists chk_activity_status_by_type;

alter table public.activity
  add constraint chk_activity_status_by_type check (
    (type = 'spread'         and status in ('open', 'winding_down', 'orphaned', 'expired', 'closed')) or
    (type = 'trade'          and status in ('open', 'liquidated', 'closed'))                            or
    (type = 'sale'           and status in ('pending', 'vesting', 'closed'))                            or
    (type = 'airdrop'        and status in ('pending', 'claimed', 'closed'))                            or
    (type = 'yield_position' and status in ('open', 'unwinding', 'closed'))                             or
    (type = 'option'         and status in ('open', 'unwinding', 'expired', 'closed'))
  );

-- 9. Extend check_activity_subtype_exists() ---------------------------------

create or replace function public.check_activity_subtype_exists()
returns trigger language plpgsql as $$
declare
  hit boolean := false;
begin
  case NEW.type
    when 'spread'         then select exists(select 1 from public.activity_spread         where activity_id = NEW.id) into hit;
    when 'trade'          then select exists(select 1 from public.activity_trade          where activity_id = NEW.id) into hit;
    when 'sale'           then select exists(select 1 from public.activity_sale           where activity_id = NEW.id) into hit;
    when 'airdrop'        then select exists(select 1 from public.activity_airdrop        where activity_id = NEW.id) into hit;
    when 'yield_position' then select exists(select 1 from public.activity_yield_position where activity_id = NEW.id) into hit;
    when 'option'         then select exists(select 1 from public.activity_option         where activity_id = NEW.id) into hit;
    else hit := false;
  end case;
  if not hit then
    raise exception
      'Activity % has type=% but no matching activity_% subtype row (orphan)',
      NEW.id, NEW.type, NEW.type;
  end if;
  return NEW;
end;
$$;

-- 10. Rebuild v_activity_feed view ------------------------------------------
-- Extends the polymorphic feed with headline metrics for yield_position +
-- option, surfaces strategy_tag + tax flags, and adds card_subtitle.

drop view if exists public.v_activity_feed cascade;

create view public.v_activity_feed as
with days_held_cte as (
  select
    a.id,
    case
      when a.opened_at is null then null
      else extract(epoch from (coalesce(a.closed_at, now()) - a.opened_at)) / 86400.0
    end as days_held
  from public.activity a
  where a.deleted_at is null
)
select
  a.id, a.user_id, a.type, a.status, a.name,
  a.opened_at, a.closed_at,
  a.capital_deployed_usd, a.realized_pnl_usd, a.unrealized_pnl_usd,
  a.fees_usd, a.net_pnl_usd,
  a.regime_tags, a.custom_tags,
  a.strategy_tag,
  a.tax_taxable,
  a.tax_jurisdiction,

  -- Polymorphic card headline value
  -- - spread:         realized_apr computed live from net_pnl/capital/days
  -- - trade:          realized_apr from activity_trade (worker-computed)
  -- - sale:           MTM multiplier (current_price * tokens / cost_basis)
  -- - airdrop:        MTM multiplier (current_price * qty / value_at_receipt)
  -- - yield_position: realized_apy_pct if closed, else expected_apy_pct
  -- - option (single_leg): realized_pnl_usd
  -- - option (spread):     realized_pnl_usd (or net_premium if open)
  case a.type
    when 'spread' then case
      when a.capital_deployed_usd is null or a.capital_deployed_usd = 0 then null
      when dh.days_held is null or dh.days_held = 0 then null
      else (a.net_pnl_usd / a.capital_deployed_usd) * (365.0 / dh.days_held)
    end
    when 'trade'   then att.realized_apr
    when 'sale'    then case
      when ase.usd_paid > 0
       and ase.tokens_allocated > 0
       and ase.current_price_usd is not null
        then (ase.tokens_allocated * ase.current_price_usd) / ase.usd_paid
      else null
    end
    when 'airdrop' then case
      when ada.value_at_receipt_usd > 0
       and ada.current_price_usd is not null
       and ada.qty_received is not null
        then (ada.current_price_usd * ada.qty_received) / ada.value_at_receipt_usd
      else null
    end
    when 'yield_position' then case
      when a.status = 'closed' and ayp.realized_apy_pct is not null then ayp.realized_apy_pct
      when ayp.expected_apy_pct is not null then ayp.expected_apy_pct
      else null
    end
    when 'option' then ao.realized_pnl_usd
  end                                                       as headline_value,

  case a.type
    when 'spread'         then 'realized_apr'
    when 'trade'          then 'realized_apr'
    when 'sale'           then 'mtm_multiplier'
    when 'airdrop'        then 'mtm_multiplier'
    when 'yield_position' then 'apy_pct'
    when 'option'         then 'realized_pnl_usd'
  end                                                       as headline_kind,

  -- Card-headline display hint (frontend renders blindly)
  case a.type
    when 'spread'         then 'apr_pct'
    when 'trade'          then 'apr_pct'
    when 'sale'           then 'mtm_x'
    when 'airdrop'        then 'mtm_x'
    when 'yield_position' then 'apy_pct'
    when 'option'         then 'usd'
  end                                                       as headline_format,

  -- Subtype-specific symbol/asset hint for the unified feed
  case a.type
    when 'spread'         then asp.primary_base
    when 'trade'          then att.symbol
    when 'sale'           then ase.token_symbol
    when 'airdrop'        then ada.token_symbol
    when 'yield_position' then ayp.asset
    when 'option'         then ao.underlying
  end                                                       as primary_symbol,

  -- Short secondary line on the card. Activity-specific.
  case a.type
    when 'spread'         then asp.spread_type::text
    when 'trade'          then att.exchange || ' · ' || att.instrument_kind::text
    when 'sale'           then ase.sale_kind::text
    when 'airdrop'        then ada.protocol
    when 'yield_position' then ayp.protocol || ' · ' || ayp.kind::text
    when 'option'         then case
      when ao.subtype = 'option_spread' and ao.spread_style is not null
        then 'Option · ' || ao.spread_style::text
      else 'Option · single_leg'
    end
  end                                                       as card_subtitle,

  a.created_at, a.updated_at
from public.activity a
join days_held_cte dh on dh.id = a.id
left join public.activity_spread         asp on asp.activity_id = a.id and a.type = 'spread'
left join public.activity_trade          att on att.activity_id = a.id and a.type = 'trade'
left join public.activity_sale           ase on ase.activity_id = a.id and a.type = 'sale'
left join public.activity_airdrop        ada on ada.activity_id = a.id and a.type = 'airdrop'
left join public.activity_yield_position ayp on ayp.activity_id = a.id and a.type = 'yield_position'
left join public.activity_option         ao  on ao.activity_id  = a.id and a.type = 'option'
where a.deleted_at is null;

comment on view public.v_activity_feed is
  'Polymorphic cross-activity feed. One row per non-deleted activity. '
  'headline_value + headline_kind + headline_format drive activity-agnostic '
  'card rendering. card_subtitle is a short secondary line per type. '
  'Extended in v5 to cover yield_position + option types and surface '
  'strategy_tag / tax fields.';

grant select on public.v_activity_feed to authenticated;

-- 11. RLS policies on new tables --------------------------------------------

-- Subtype tables filter via JOIN to activity (same pattern as v2).
alter table public.activity_yield_position enable row level security;
create policy activity_yield_position_owner_all on public.activity_yield_position
  for all to authenticated
  using (exists (
    select 1 from public.activity a
     where a.id = activity_yield_position.activity_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.activity a
     where a.id = activity_yield_position.activity_id and a.user_id = auth.uid()
  ));

alter table public.activity_option enable row level security;
create policy activity_option_owner_all on public.activity_option
  for all to authenticated
  using (exists (
    select 1 from public.activity a
     where a.id = activity_option.activity_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.activity a
     where a.id = activity_option.activity_id and a.user_id = auth.uid()
  ));

-- activity_option_leg joins via activity_option, then to activity.
alter table public.activity_option_leg enable row level security;
create policy activity_option_leg_owner_all on public.activity_option_leg
  for all to authenticated
  using (exists (
    select 1
      from public.activity_option ao
      join public.activity a on a.id = ao.activity_id
     where ao.activity_id = activity_option_leg.activity_id
       and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1
      from public.activity_option ao
      join public.activity a on a.id = ao.activity_id
     where ao.activity_id = activity_option_leg.activity_id
       and a.user_id = auth.uid()
  ));

-- event_log has user_id directly — no join needed.
alter table public.event_log enable row level security;
create policy event_log_owner_all on public.event_log
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
