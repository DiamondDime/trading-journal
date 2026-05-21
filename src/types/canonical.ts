// ============================================================================
// src/types/canonical.ts
// Canonical app-layer types. Source of truth that mirrors Postgres schema.
// All Decimal values are strings — never `number`. See decisions in architecture.md.
// ============================================================================

// ---------- Branded IDs ----------
export type UserId             = string & { readonly __brand: 'UserId' };
export type ConnectionId       = string & { readonly __brand: 'ConnectionId' };
export type FillId             = string & { readonly __brand: 'FillId' };
export type PositionId         = string & { readonly __brand: 'PositionId' };
export type SpreadId           = string & { readonly __brand: 'SpreadId' };
export type SpreadLegId        = string & { readonly __brand: 'SpreadLegId' };
export type SpreadCandidateId  = string & { readonly __brand: 'SpreadCandidateId' };
export type FundingEventId     = string & { readonly __brand: 'FundingEventId' };
export type NoteId             = string & { readonly __brand: 'NoteId' };
export type AttachmentId       = string & { readonly __brand: 'AttachmentId' };
export type TagId              = string & { readonly __brand: 'TagId' };
export type SavedViewId        = string & { readonly __brand: 'SavedViewId' };
export type SyncJobId          = string & { readonly __brand: 'SyncJobId' };

export type ExternalTradeId    = string & { readonly __brand: 'ExternalTradeId' };
export type ExternalOrderId    = string & { readonly __brand: 'ExternalOrderId' };

// ---------- Activity (v2) branded IDs ----------
// The supertype `activity` row's id. Each subtype table (activity_spread,
// activity_trade, activity_sale, activity_airdrop, activity_yield_position,
// activity_option) uses the SAME UUID as its primary key — there's a strict
// 1:1 between activity and its subtype row. So the subtype IDs are type
// aliases for ActivityId rather than distinct brands.
export type ActivityId               = string & { readonly __brand: 'ActivityId' };
export type ActivitySpreadId         = ActivityId;
export type ActivityTradeId          = ActivityId;
export type ActivitySaleId           = ActivityId;
export type ActivityAirdropId        = ActivityId;
export type ActivityYieldPositionId  = ActivityId;
export type ActivityOptionId         = ActivityId;

// Option legs have their own distinct UUIDs — there's an N:1 from
// activity_option_leg to activity_option, so the leg id is NOT a type alias.
export type ActivityOptionLegId = string & { readonly __brand: 'ActivityOptionLegId' };

// event_log rows are independent of activity (1:N at most, optional back-pointer
// via related_activity_id).
export type EventLogId = string & { readonly __brand: 'EventLogId' };

// ---------- Money / quantity primitives ----------
/** Arbitrary-precision decimal as string. f64 silently rounds at 15-16 sig digits. */
export type Decimal = string;
export type Iso8601 = string;
export type Currency = string;

// ---------- Exchange & venue ----------
export const Exchange = {
  BINANCE:      'binance',
  BYBIT:        'bybit',
  HYPERLIQUID:  'hyperliquid',
  OKX:          'okx',
  DERIBIT:      'deribit',
  OKX_DEX:      'okx_dex',
  ASTER:        'aster',
  PHEMEX:       'phemex',
  BITGET:       'bitget',
  MEXC:         'mexc',
  KUCOIN:       'kucoin',
  KRAKEN:       'kraken',
  GATE:         'gate',
  BINGX:        'bingx',
  HTX:          'htx',
} as const;
export type Exchange = typeof Exchange[keyof typeof Exchange];

export const ExchangeKind = { CEX: 'cex', DEX: 'dex' } as const;
export type ExchangeKind = typeof ExchangeKind[keyof typeof ExchangeKind];

export const AuthMode = {
  API_KEY:        'api_key',
  WALLET_ADDRESS: 'wallet_address',
} as const;
export type AuthMode = typeof AuthMode[keyof typeof AuthMode];

export const ConnectionStatus = {
  PENDING:      'pending',
  ACTIVE:       'active',
  SYNCING:      'syncing',
  AUTH_FAILED:  'auth_failed',
  RATE_LIMITED: 'rate_limited',
  ERROR:        'error',
  DISABLED:     'disabled',
} as const;
export type ConnectionStatus = typeof ConnectionStatus[keyof typeof ConnectionStatus];

// ---------- Instruments & sides ----------
export const InstrumentKind = {
  SPOT:         'spot',
  PERP:         'perp',
  DATED_FUTURE: 'dated_future',
  OPTION:       'option',
} as const;
export type InstrumentKind = typeof InstrumentKind[keyof typeof InstrumentKind];

export const Side = { BUY: 'buy', SELL: 'sell' } as const;
export type Side = typeof Side[keyof typeof Side];

export const PositionSide = { LONG: 'long', SHORT: 'short' } as const;
export type PositionSide = typeof PositionSide[keyof typeof PositionSide];

export const PositionStatus = { OPEN: 'open', CLOSED: 'closed' } as const;
export type PositionStatus = typeof PositionStatus[keyof typeof PositionStatus];

export const MarginMode = { CROSS: 'cross', ISOLATED: 'isolated', SPOT: 'spot' } as const;
export type MarginMode = typeof MarginMode[keyof typeof MarginMode];

// ---------- Spread types & state ----------
export const SpreadType = {
  CROSS_EXCHANGE_PERP_ARB: 'cross_exchange_perp_arb',
  CASH_CARRY:              'cash_carry',
  CALENDAR:                'calendar',
  FUNDING_CAPTURE:         'funding_capture',
  DEX_CEX_ARB:             'dex_cex_arb',
  CUSTOM:                  'custom',
} as const;
export type SpreadType = typeof SpreadType[keyof typeof SpreadType];

export const SpreadStatus = {
  CANDIDATE:     'candidate',     // matcher proposal, not yet accepted
  REJECTED:      'rejected',      // candidate dismissed
  OPEN:          'open',          // all legs filled, position active
  WINDING_DOWN:  'winding_down',  // some legs closed, intentional exit in progress
  ORPHANED:      'orphaned',      // one leg open with no remaining hedge (UNINTENDED — alert)
  EXPIRED:       'expired',       // dated-future settlement reached before manual close
  CLOSED:        'closed',        // all legs fully closed
} as const;
export type SpreadStatus = typeof SpreadStatus[keyof typeof SpreadStatus];

// Sub-variant per spread type. NULL for types without a meaningful subdivision.
export const SpreadVariant = {
  // cash_carry
  CASH_CARRY_FUNDING:        'funding',      // short leg is a perp
  CASH_CARRY_BASIS:          'basis',        // short leg is a dated future
  // funding_capture
  FUNDING_CAPTURE_SAME_VENUE:  'same_venue', // long spot + short perp on one exchange
  FUNDING_CAPTURE_CROSS_VENUE: 'cross_venue',// long perp neg-funding + short perp pos-funding
} as const;
export type SpreadVariant = typeof SpreadVariant[keyof typeof SpreadVariant];

// Card headline metric — one number the trader's eye lands on per spread type.
export const CardHeadlineMetric = {
  BPS_CAPTURED:  'bps_captured',  // cross-exchange perp, DEX-CEX
  REALIZED_APR:  'realized_apr',  // cash-carry, funding capture
  BPS_PER_DAY:   'bps_per_day',   // calendars
  NET_PNL_QUOTE: 'net_pnl_quote', // custom / fallback
} as const;
export type CardHeadlineMetric = typeof CardHeadlineMetric[keyof typeof CardHeadlineMetric];

export const CardHeadlineFormat = {
  BPS:         'bps',
  APR_PCT:     'apr_pct',
  BPS_PER_DAY: 'bps_per_day',
  USD:         'usd',
} as const;
export type CardHeadlineFormat = typeof CardHeadlineFormat[keyof typeof CardHeadlineFormat];

export const SpreadOrigin = {
  AUTO_MATCHED:   'auto_matched',
  MANUAL:         'manual',
  AUTO_CONFIRMED: 'auto_confirmed',
} as const;
export type SpreadOrigin = typeof SpreadOrigin[keyof typeof SpreadOrigin];

export const CandidateState = {
  PENDING:  'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED:  'expired',
} as const;
export type CandidateState = typeof CandidateState[keyof typeof CandidateState];

export const FeeKind = {
  MAKER:      'maker',
  TAKER:      'taker',
  FUNDING:    'funding',
  WITHDRAWAL: 'withdrawal',
  GAS:        'gas',
} as const;
export type FeeKind = typeof FeeKind[keyof typeof FeeKind];

export const FundingDirection = { RECEIVED: 'received', PAID: 'paid' } as const;
export type FundingDirection = typeof FundingDirection[keyof typeof FundingDirection];

// ---------- Activity (v2) enums ----------
// Top-level discriminator. Each activity row joins to exactly one subtype table
// (activity_spread / activity_trade / activity_sale / activity_airdrop /
//  activity_yield_position / activity_option) based on this value.
export const ActivityType = {
  SPREAD:         'spread',
  TRADE:          'trade',
  SALE:           'sale',
  AIRDROP:        'airdrop',
  YIELD_POSITION: 'yield_position',
  OPTION:         'option',
} as const;
export type ActivityType = typeof ActivityType[keyof typeof ActivityType];

// Shared lifecycle state space across all activity types. Each subtype uses a
// subset — see the chk_activity_status_by_type CHECK constraint in the SQL.
//   spread:         open | winding_down | orphaned | expired | closed
//   trade:          open | liquidated | closed
//   sale:           pending | vesting | closed
//   airdrop:        pending | claimed | closed
//   yield_position: open | unwinding | closed
//   option:         open | unwinding | expired | closed
export const ActivityStatus = {
  PENDING:      'pending',       // sale: allocation paid pre-TGE; airdrop: eligible not claimed
  OPEN:         'open',          // trade/spread/yield/option: position active
  WINDING_DOWN: 'winding_down',  // spread: some legs closed
  UNWINDING:    'unwinding',     // yield_position / option: closing in progress
  ORPHANED:     'orphaned',      // spread: one leg open with no hedge (alert state)
  VESTING:      'vesting',       // sale: some claimed, more to vest
  CLAIMED:      'claimed',       // airdrop: tokens received
  LIQUIDATED:   'liquidated',    // trade: position was liquidated
  EXPIRED:      'expired',       // spread/option: dated settlement reached
  CLOSED:       'closed',        // terminal: fully done
} as const;
export type ActivityStatus = typeof ActivityStatus[keyof typeof ActivityStatus];

// Sub-discriminator for activity_sale.sale_kind. v5 adds the 4 new round /
// IEO / OTC-allocation / vesting-claim flavours.
export const SaleKind = {
  IDO:             'ido',
  LAUNCHPAD:       'launchpad',
  PREMARKET:       'premarket',
  OTC:             'otc',
  IEO:             'ieo',
  PRIVATE_ROUND:   'private_round',
  OTC_ALLOCATION:  'otc_allocation',
  VESTING_CLAIM:   'vesting_claim',
} as const;
export type SaleKind = typeof SaleKind[keyof typeof SaleKind];

// Sub-discriminator on activity_trade.kind. v5 adds the broader trade kinds
// (otc/nft) and explicit dated_future + option sub-types for legacy positions
// the trader wants to journal without creating a full activity_option entry.
export const TradeKind = {
  SPOT:         'spot',
  PERP:         'perp',
  DATED_FUTURE: 'dated_future',
  OPTION:       'option',
  OTC:          'otc',
  NFT:          'nft',
} as const;
export type TradeKind = typeof TradeKind[keyof typeof TradeKind];

// Sub-discriminator on activity_yield_position.kind. Determines which fields
// the wizard surfaces and which YieldKindMeta shape the kind_meta JSON
// payload must conform to.
export const YieldKind = {
  STAKE:     'stake',
  LEND:      'lend',
  FARM:      'farm',
  LP:        'lp',
  VALIDATOR: 'validator',
  MINING:    'mining',
} as const;
export type YieldKind = typeof YieldKind[keyof typeof YieldKind];

// Sub-discriminator on activity_option.subtype.
export const OptionSubtypeKind = {
  SINGLE_LEG:    'single_leg',
  OPTION_SPREAD: 'option_spread',
} as const;
export type OptionSubtypeKind = typeof OptionSubtypeKind[keyof typeof OptionSubtypeKind];

// Per-leg side on activity_option_leg.side.
export const OptionSide = {
  LONG:  'long',
  SHORT: 'short',
} as const;
export type OptionSide = typeof OptionSide[keyof typeof OptionSide];

// Per-leg call/put on activity_option_leg.option_kind.
export const OptionCpKind = {
  CALL: 'call',
  PUT:  'put',
} as const;
export type OptionCpKind = typeof OptionCpKind[keyof typeof OptionCpKind];

// Activity-level spread style on activity_option.spread_style (only when
// activity_option.subtype === 'option_spread').
export const OptionSpreadStyle = {
  VERTICAL:    'vertical',
  IRON_CONDOR: 'iron_condor',
  CALENDAR:    'calendar',
  STRANGLE:    'strangle',
  BUTTERFLY:   'butterfly',
  CUSTOM:      'custom',
} as const;
export type OptionSpreadStyle = typeof OptionSpreadStyle[keyof typeof OptionSpreadStyle];

// event_log.kind. NOT part of the activity supertype — these are accounting /
// treasury movements that need to be journaled but aren't strategy events.
export const MovementEventKind = {
  BRIDGE:     'bridge',
  CONVERT:    'convert',
  TRANSFER:   'transfer',
  DEPOSIT:    'deposit',
  WITHDRAWAL: 'withdrawal',
  NFT_TRADE:  'nft_trade',
  LOSS:       'loss',
  OTHER:      'other',
} as const;
export type MovementEventKind = typeof MovementEventKind[keyof typeof MovementEventKind];

// Drives the unified-feed card headline. v_activity_feed emits one of these per
// row to tell the renderer how to format the headline_value column.
//   realized_apr     → spread, trade
//   mtm_multiplier   → sale, airdrop (current_value / cost_basis)
//   apy_pct          → yield_position (realized if closed, expected if open)
//   realized_pnl_usd → option (realized P&L; max_profit comparison up to UI)
export const HeadlineKind = {
  REALIZED_APR:     'realized_apr',
  MTM_MULTIPLIER:   'mtm_multiplier',
  APY_PCT:          'apy_pct',
  REALIZED_PNL_USD: 'realized_pnl_usd',
} as const;
export type HeadlineKind = typeof HeadlineKind[keyof typeof HeadlineKind];

// Display-format hint for v_activity_feed.headline_format. The UI uses this
// to pick a number formatter (percentage vs USD vs bps vs multiplier).
export const HeadlineFormat = {
  APR_PCT: 'apr_pct',
  APY_PCT: 'apy_pct',
  MTM_X:   'mtm_x',
  USD:     'usd',
  BPS:     'bps',
} as const;
export type HeadlineFormat = typeof HeadlineFormat[keyof typeof HeadlineFormat];

// ---------- Instrument descriptor ----------
export interface Instrument {
  exchange:     Exchange;
  kind:         InstrumentKind;
  base:         string;
  quote:        string;
  expiry?:      Iso8601 | null;
  strike?:      Decimal | null;
  option_kind?: 'call' | 'put' | null;
  raw_symbol:   string;
}

// ---------- Exchange connection ----------
export interface ExchangeConnection {
  id:               ConnectionId;
  user_id:          UserId;
  exchange:         Exchange;
  exchange_kind:    ExchangeKind;
  auth_mode:        AuthMode;
  label:            string;
  status:           ConnectionStatus;
  status_message:   string | null;
  api_key_hint:     string | null;
  wallet_address:   string | null;          // only present when worker decrypts
  wallet_chain:     string | null;
  last_sync_at:     Iso8601 | null;
  last_fill_at:     Iso8601 | null;
  fills_synced:     number;
  permissions:      string[];
  created_at:       Iso8601;
  updated_at:       Iso8601;
}

// ---------- Fill ----------
export interface Fill {
  id:                  FillId;
  user_id:             UserId;
  connection_id:       ConnectionId;
  external_trade_id:   ExternalTradeId;
  external_order_id:   ExternalOrderId | null;
  instrument:          Instrument;
  side:                Side;
  qty:                 Decimal;
  price:               Decimal;
  notional:            Decimal;
  fee:                 Decimal;
  fee_currency:        Currency;
  fee_kind:            FeeKind;
  is_maker:            boolean;
  liquidity:           'maker' | 'taker' | null;
  position_side:       PositionSide | null;
  reduce_only:         boolean | null;
  filled_at:           Iso8601;
  ingested_at:         Iso8601;
  position_id:         PositionId | null;
}

// ---------- Position ----------
export interface Position {
  id:                  PositionId;
  user_id:             UserId;
  connection_id:       ConnectionId;
  instrument:          Instrument;
  side:                PositionSide;
  status:              PositionStatus;
  qty_open:            Decimal;
  qty_total:           Decimal;
  avg_entry_price:     Decimal;
  avg_exit_price:      Decimal | null;
  realized_pnl:        Decimal;
  unrealized_pnl:      Decimal | null;
  mark_price:          Decimal | null;
  funding_pnl:         Decimal;
  fees_paid:           Decimal;
  opened_at:           Iso8601;
  closed_at:           Iso8601 | null;
  spread_id:           SpreadId | null;
  spread_leg_id:       SpreadLegId | null;
  updated_at:          Iso8601;
}

// ---------- Funding event ----------
export interface FundingEvent {
  id:                  FundingEventId;
  user_id:             UserId;
  connection_id:       ConnectionId;
  instrument:          Instrument;
  direction:           FundingDirection;
  funding_rate:        Decimal;
  position_qty:        Decimal;
  amount:              Decimal;
  amount_currency:     Currency;
  occurred_at:         Iso8601;
  external_id:         string | null;
  position_id:         PositionId | null;
  spread_id:           SpreadId | null;
  spread_leg_id:       SpreadLegId | null;
  ingested_at:         Iso8601;
}

// ---------- Spread & legs ----------
export interface SpreadLeg {
  id:                  SpreadLegId;
  spread_id:           SpreadId;
  user_id:             UserId;
  connection_id:       ConnectionId;
  instrument:          Instrument;
  side:                PositionSide;
  position_ids:        PositionId[];
  qty_total:           Decimal;
  avg_entry_price:     Decimal;
  avg_exit_price:      Decimal | null;
  realized_pnl:        Decimal;
  unrealized_pnl:      Decimal | null;
  funding_pnl:         Decimal;
  fees_paid:           Decimal;
  leg_index:           number;
  is_short:            boolean;
  opened_at:           Iso8601;
  closed_at:           Iso8601 | null;
  role:                string;
}

export interface Spread {
  id:                  SpreadId;
  user_id:             UserId;
  spread_type:         SpreadType;
  variant:             SpreadVariant | null;
  status:              SpreadStatus;
  origin:              SpreadOrigin;
  name:                string;
  primary_base:        string;
  regime_tags:         string[];
  custom_tags:         string[];
  capital_deployed:    Decimal;
  // Open-intent fields (trader's expectations at open; used in post-trade review)
  target_apr_at_open:              Decimal | null;
  expected_holding_days:           number  | null;
  expected_basis_convergence_date: Iso8601 | null;
  exit_plan:                       string  | null;
  borrow_cost_assumed_bps:         Decimal | null;
  close_threshold_apr:             Decimal | null;
  close_threshold_periods:         number  | null;
  max_gas_budget_usd:              Decimal | null;
  slippage_tolerance_bps:          Decimal | null;
  // Aggregates
  gross_pnl:           Decimal;
  funding_pnl:         Decimal;
  fees_pnl:            Decimal;   // negative
  net_pnl:             Decimal;
  apr:                 Decimal | null;
  opened_at:           Iso8601;
  closed_at:           Iso8601 | null;
  hold_duration_ms:    number;
  exchanges:           Exchange[];
  leg_count:           number;
  match_confidence:    number | null;
  created_at:          Iso8601;
  updated_at:          Iso8601;
}

// Shape returned by the spread_pnl view. Frontend renders this directly.
export interface SpreadPnl {
  spread_id:                SpreadId;
  user_id:                  UserId;
  spread_type:              SpreadType;
  variant:                  SpreadVariant | null;
  status:                   SpreadStatus;
  name:                     string;
  primary_base:             string;
  opened_at:                Iso8601 | null;
  closed_at:                Iso8601 | null;
  capital_deployed_usd:     Decimal | null;
  target_apr_at_open:       Decimal | null;
  expected_holding_days:    number | null;
  regime_tags:              string[];
  custom_tags:              string[];
  exchanges:                Exchange[];
  leg_count:                number;
  // Decomposition (stacked-bar inputs)
  realized_pnl_quote:       Decimal;
  basis_pnl_quote:          Decimal;       // net leg MTM ≈ basis P&L
  funding_received_quote:   Decimal;
  fees_quote:               Decimal;
  net_pnl_quote:            Decimal;
  gross_pnl_quote:          Decimal;
  // Derived
  days_held:                Decimal | null;
  realized_apr:             Decimal | null;
  bps_captured_net:         Decimal | null;
  bps_per_day:              Decimal | null;
  realized_vs_expected_apr: Decimal | null;
  // Card headline (frontend renders blindly: {metric} {value} {format})
  card_headline_metric:     CardHeadlineMetric;
  card_headline_value:      Decimal | null;
  card_headline_format:     CardHeadlineFormat;
  created_at:               Iso8601;
  updated_at:               Iso8601;
}

// Per-leg execution review (slippage, time-to-fill).
export interface SpreadLegExecution {
  spread_leg_id:         SpreadLegId;
  intended_price:        Decimal | null;
  intended_price_set_at: Iso8601 | null;
  // computed at query time from positions/fills
  avg_fill_price:        Decimal | null;
  slippage_bps:          Decimal | null;
  time_to_fill_seconds:  number  | null;
}

// ---------- Spread candidate (matcher output) ----------
export interface SpreadCandidate {
  id:                  SpreadCandidateId;
  user_id:             UserId;
  suggested_type:      SpreadType;
  state:               CandidateState;
  match_confidence:    number;     // 0..1
  match_reasons:       string[];
  proposed_legs:       Array<{
    connection_id:       ConnectionId;
    instrument:          Instrument;
    side:                PositionSide;
    fill_ids:            FillId[];
    qty_total:           Decimal;
    avg_entry_price:     Decimal;
    opened_at:           Iso8601;
  }>;
  primary_base:        string;
  earliest_fill_at:    Iso8601;
  expires_at:          Iso8601;
  created_at:          Iso8601;
  decided_at:          Iso8601 | null;
  decided_by:          UserId | null;
  resulting_spread_id: SpreadId | null;
}

// ---------- Notes & attachments ----------
export interface Note {
  id:               NoteId;
  user_id:          UserId;
  spread_id:        SpreadId;
  entry_rationale:  string | null;
  exit_conclusion:  string | null;
  body:             string;
  attachments:      Attachment[];
  created_at:       Iso8601;
  updated_at:       Iso8601;
}

export interface Attachment {
  id:           AttachmentId;
  note_id:      NoteId;
  user_id:      UserId;
  filename:     string;
  mime_type:    string;
  size_bytes:   number;
  storage_path: string;
  created_at:   Iso8601;
}

// ---------- Tag & saved view ----------
export interface Tag {
  id:         TagId;
  user_id:    UserId;
  name:       string;
  color:      string | null;
  created_at: Iso8601;
}

export interface SavedView {
  id:         SavedViewId;
  user_id:    UserId;
  name:       string;
  scope:      'spreads' | 'positions' | 'fills';
  is_default: boolean;
  filters: {
    status?:        SpreadStatus[];
    spread_type?:   SpreadType[];
    exchange?:      Exchange[];
    coin?:          string[];
    opened_after?:  Iso8601;
    opened_before?: Iso8601;
    apr_min?:       number;
    apr_max?:       number;
    regime?:        string[];
    tags?:          TagId[];
    search?:        string;
  };
  sort: {
    field: 'opened_at' | 'closed_at' | 'apr' | 'net_pnl' | 'capital_deployed' | 'hold_duration_ms';
    dir:   'asc' | 'desc';
  };
  columns:    string[];
  created_at: Iso8601;
  updated_at: Iso8601;
}

// ---------- Sync job ----------
export const SyncJobState = {
  QUEUED:    'queued',
  RUNNING:   'running',
  SUCCEEDED: 'succeeded',
  FAILED:    'failed',
} as const;
export type SyncJobState = typeof SyncJobState[keyof typeof SyncJobState];

export interface SyncJob {
  id:             SyncJobId;
  connection_id:  ConnectionId;
  user_id:        UserId;
  state:          SyncJobState;
  cursor_from:    Iso8601 | null;
  cursor_to:      Iso8601 | null;
  fills_pulled:   number;
  funding_pulled: number;
  error_code:     AdapterErrorCode | null;
  error_message:  string | null;
  started_at:     Iso8601 | null;
  finished_at:    Iso8601 | null;
}

// ---------- Errors ----------
export const AdapterErrorCode = {
  AUTH_FAILED:   'auth_failed',
  RATE_LIMITED:  'rate_limited',
  NETWORK:       'network',
  EXCHANGE_DOWN: 'exchange_down',
  INVALID_DATA:  'invalid_data',
  PERMISSION:    'permission',
  UNSUPPORTED:   'unsupported',
  UNKNOWN:       'unknown',
} as const;
export type AdapterErrorCode = typeof AdapterErrorCode[keyof typeof AdapterErrorCode];

// ---------- Profile + allowlist ----------
export interface Profile {
  id:            UserId;
  email:         string;
  display_name:  string | null;
  timezone:      string;
  base_currency: string;
  created_at:    Iso8601;
  updated_at:    Iso8601;
}

export const AllowlistRole = { USER: 'user', ADMIN: 'admin' } as const;
export type AllowlistRole = typeof AllowlistRole[keyof typeof AllowlistRole];

export interface AllowlistEntry {
  id:          string;
  email:       string;
  role:        AllowlistRole;
  invited_at:  Iso8601;
  redeemed_at: Iso8601 | null;
  notes:       string | null;
}

// ---------- Activity (v2) JSON shapes ----------

/**
 * activity_sale.vesting_schedule (jsonb). Discriminated by `kind`.
 * - all_at_tge:         100% unlocked at TGE.
 * - tge_plus_linear:    tge_pct unlocked at TGE, remainder linear over linear_days.
 * - cliff_plus_linear:  optional tge_pct at TGE, then cliff_days no unlock, then linear over linear_days.
 * - custom:             explicit unlock schedule as date/pct entries.
 */
export type VestingSchedule =
  | { kind: 'all_at_tge' }
  | { kind: 'tge_plus_linear'; tge_pct: number; linear_days: number }
  | { kind: 'cliff_plus_linear'; cliff_days: number; linear_days: number; tge_pct?: number }
  | { kind: 'custom'; entries: Array<{ date: Iso8601; pct: number }> };

/**
 * One entry in activity_sale.claim_events (jsonb array). Records a vesting
 * claim transaction. tx_hash is optional for off-chain venues.
 */
export interface ClaimEvent {
  date:     Iso8601;
  qty:      Decimal;
  tx_hash?: string;
}

/**
 * activity_yield_position.kind_meta (jsonb). Discriminated by `kind` to
 * mirror the column-side yield_kind enum. Validated app-side via Zod
 * (CreateYieldPositionBody) since Postgres enforces only the JSON shape.
 *
 * Decimals stay strings to honour the project's "never f64 for money" rule.
 */
export type YieldKindMeta =
  | {
      kind: 'stake';
      validatorAddress?: string;
      operator?: string;
    }
  | {
      kind: 'lend';
      rateKind: 'variable' | 'fixed';
      ltv?: number;
    }
  | {
      kind: 'farm';
      pairA: string;
      pairB: string;
      amountA: Decimal;
      amountB: Decimal;
      poolFeeTier?: string;
      rewardToken: string;
    }
  | {
      kind: 'lp';
      pairA: string;
      pairB: string;
      amountA: Decimal;
      amountB: Decimal;
      poolFeeTier: string;
      rangeLower?: Decimal;
      rangeUpper?: Decimal;
      concentrated: boolean;
    }
  | {
      kind: 'validator';
      validatorAddress: string;
      commissionPct: number;
    }
  | {
      kind: 'mining';
      hashrateThs: number;
      electricityCostUsdKwh: number;
      pool: string;
      expectedDailyRevenueUsd: number;
    };

// ---------- Activity (v2) interfaces ----------

/**
 * Supertype for all journaled activities. Joins to exactly one of
 * activity_spread / activity_trade / activity_sale / activity_airdrop /
 * activity_yield_position / activity_option based on `type`. Holds shared
 * lifecycle + denormalized aggregate columns + strategy attribution.
 */
export interface Activity {
  id:                   ActivityId;
  user_id:              UserId;
  type:                 ActivityType;
  status:               ActivityStatus;
  name:                 string;
  opened_at:            Iso8601 | null;
  closed_at:            Iso8601 | null;
  capital_deployed_usd: Decimal | null;
  realized_pnl_usd:     Decimal | null;
  unrealized_pnl_usd:   Decimal | null;
  fees_usd:             Decimal;
  net_pnl_usd:          Decimal | null;
  regime_tags:          string[];
  custom_tags:          string[];
  /** v5: strategy rollup grouping (e.g. "ETH basis carry Q1"). */
  strategy_tag:         string | null;
  created_at:           Iso8601;
  updated_at:           Iso8601;
  deleted_at:           Iso8601 | null;
}

/**
 * Spread subtype columns. JOIN to Activity for shared fields (status, name,
 * opened_at, closed_at, capital, PnL aggregates, tags, timestamps). All
 * spread-specific fields live here.
 */
export interface ActivitySpread {
  activity_id:                     ActivitySpreadId;
  spread_type:                     SpreadType;
  variant:                         SpreadVariant | null;
  origin:                          SpreadOrigin;
  primary_base:                    string;
  match_confidence:                number | null;
  funding_pnl_quote:               Decimal;
  apr:                             Decimal | null;
  exchanges:                       Exchange[];
  leg_count:                       number;
  hold_duration_ms:                number | null;
  source:                          'user' | 'system';
  system_proposal_metadata:        Record<string, unknown> | null;
  // Open-intent fields (trader's expectations at open; used in post-trade review)
  target_apr_at_open:              Decimal | null;
  expected_holding_days:           number  | null;
  expected_basis_convergence_date: Iso8601 | null;
  exit_plan:                       string  | null;
  borrow_cost_assumed_bps:         Decimal | null;
  close_threshold_apr:             Decimal | null;
  close_threshold_periods:         number  | null;
  max_gas_budget_usd:              Decimal | null;
  slippage_tolerance_bps:          Decimal | null;
}

/**
 * Trade subtype columns. A journaled Position promoted to a Trade activity
 * with thesis/exit-plan notes. position_id is 1:1 with the underlying Position.
 * v5 adds the trade kind discriminator + leverage/margin context + fees
 * decomposition.
 */
export interface ActivityTrade {
  activity_id:          ActivityTradeId;
  position_id:          PositionId;
  symbol:               string;
  exchange:             Exchange;
  instrument_kind:      InstrumentKind;
  side:                 PositionSide;
  entry_thesis:         string | null;
  exit_plan:            string | null;
  target_price:         Decimal | null;
  stop_price:           Decimal | null;
  qty:                  Decimal;
  avg_entry_price:      Decimal;
  avg_exit_price:       Decimal | null;
  realized_apr:         Decimal | null;
  /** v5: trade kind discriminator (spot/perp/dated_future/option/otc/nft). */
  kind:                 TradeKind;
  /** v5: effective leverage at open (NULL for spot). */
  leverage:             Decimal | null;
  /** v5: margin mode at open (cross/isolated, NULL for spot). */
  margin_mode:          'cross' | 'isolated' | null;
  /** v5: USD fees paid on entry fills (separate from exit for review chart). */
  fees_entry_usd:       Decimal | null;
  fees_exit_usd:        Decimal | null;
  funding_paid_usd:     Decimal | null;
  funding_received_usd: Decimal | null;
  borrow_cost_usd:      Decimal | null;
}

/**
 * Sale subtype columns. IDO / launchpad / premarket / OTC / IEO / private
 * round / OTC allocation / vesting claim. Always manually entered.
 * effective_price_usd is a generated column (usd_paid / tokens_allocated).
 * vesting_schedule + claim_events are jsonb.
 */
export interface ActivitySale {
  activity_id:         ActivitySaleId;
  token_symbol:        string;
  token_name:          string | null;
  token_chain:         string | null;
  sale_kind:           SaleKind;
  sale_venue:          string | null;
  sale_date:           Iso8601;
  usd_paid:            Decimal;
  tokens_allocated:    Decimal;
  effective_price_usd: Decimal | null;
  vesting_schedule:    VestingSchedule | null;
  claim_events:        ClaimEvent[];
  total_claimed:       Decimal;
  remaining_locked:    Decimal | null;
  /** Last-known token price in USD. Drives the MTM headline on v_activity_feed. */
  current_price_usd:   Decimal | null;
  current_price_at:    Iso8601 | null;
  /** v5: wallet the claim landed in. Used by the wallet-paste auto-import. */
  claim_wallet:        string | null;
  /** v5: fundraising round (seed/private/public/strategic/other). */
  fundraising_round:   'seed' | 'private' | 'public' | 'strategic' | 'other' | null;
  /** v5: allocation method (fcfs/lottery/staking/whitelist/other). */
  allocation_method:   'fcfs' | 'lottery' | 'staking' | 'whitelist' | 'other' | null;
  /** v5: tier within the round (e.g. "Tier 1", "VIP"). */
  tier:                string | null;
  /** v5: bonus % vs the public price (negative = discount, positive = premium). */
  bonus_pct:           Decimal | null;
}

/**
 * Airdrop subtype columns. Tokens received from a protocol drop.
 * Always manually entered. current_price_usd + current_price_at are refreshed
 * over time so the MTM multiplier on v_activity_feed stays current.
 *
 * v5 loosens qty_received to nullable so the pre-claim watchlist
 * (status=pending) is reachable, and adds claim-window + wallet context for
 * the auto-import flow.
 */
export interface ActivityAirdrop {
  activity_id:          ActivityAirdropId;
  token_symbol:         string;
  token_name:           string | null;
  token_chain:          string | null;
  protocol:             string;
  snapshot_date:        Iso8601 | null;
  eligibility_reason:   string | null;
  qty_received:         Decimal | null;
  claim_date:           Iso8601 | null;
  claim_tx_hash:        string | null;
  /** v5: wallet the claim landed in. Used by the wallet-paste auto-import. */
  claim_wallet:         string | null;
  /** v5: USD cost of the claim transaction (gas). Subtracts from net P&L. */
  gas_cost_usd:         Decimal | null;
  /** v5: claim window start — drives the watchlist alert. */
  claim_window_start:   Iso8601 | null;
  /** v5: claim window end — drives the "expiring in N days" alert. */
  claim_window_end:     Iso8601 | null;
  value_at_receipt_usd: Decimal | null;
  current_price_usd:    Decimal | null;
  current_price_at:     Iso8601 | null;
}

/**
 * Yield position subtype columns (v5). One activity per yield-bearing
 * position: stake / lend / farm / lp / validator / mining. JOIN to activity
 * for shared lifecycle + aggregates. kind_meta is the discriminated-union
 * jsonb payload (validated app-side via YieldKindMeta).
 */
export interface ActivityYieldPosition {
  activity_id:        ActivityYieldPositionId;
  kind:               YieldKind;
  protocol:           string;
  venue:              string | null;
  chain:              string | null;
  asset:              string;
  amount:             Decimal;
  amount_usd_at_open: Decimal | null;
  expected_apy_pct:   Decimal | null;
  realized_apy_pct:   Decimal | null;
  rewards_token:      string | null;
  rewards_accrued:    Decimal;
  rewards_claimed:    Decimal;
  rewards_usd_value:  Decimal | null;
  fees_protocol_usd:  Decimal;
  fees_gas_usd:       Decimal;
  kind_meta:          YieldKindMeta | null;
  current_price_usd:  Decimal | null;
  current_price_at:   Iso8601 | null;
  updated_at:         Iso8601;
}

/**
 * Option activity header (v5). Holds the cross-leg summary (net premium,
 * max profit, breakevens). Individual legs live in activity_option_leg.
 */
export interface ActivityOption {
  activity_id:       ActivityOptionId;
  subtype:           OptionSubtypeKind;
  spread_style:      OptionSpreadStyle | null;
  underlying:        string;
  exchange:          Exchange;
  total_premium_usd: Decimal;
  net_premium_usd:   Decimal | null;
  realized_pnl_usd:  Decimal | null;
  max_profit_usd:    Decimal | null;
  max_loss_usd:      Decimal | null;
  breakeven_lower:   Decimal | null;
  breakeven_upper:   Decimal | null;
  iv_at_open:        Decimal | null;
  entry_thesis:      string | null;
  exit_plan:         string | null;
  target_price:      Decimal | null;
  stop_price:        Decimal | null;
  updated_at:        Iso8601;
}

/**
 * One leg of an option position. Single-leg activity_option has exactly 1
 * row; spreads have 2-8 rows. leg_index orders them for the trader.
 */
export interface ActivityOptionLeg {
  id:                          ActivityOptionLegId;
  activity_id:                 ActivityOptionId;
  leg_index:                   number;
  exchange:                    Exchange;
  underlying:                  string;
  expiry:                      Iso8601;  // date
  strike:                      Decimal;
  option_kind:                 OptionCpKind;
  side:                        OptionSide;
  contracts:                   Decimal;
  premium_per_contract:        Decimal;
  premium_total_usd:           Decimal | null;
  iv:                          Decimal | null;
  delta:                       Decimal | null;
  gamma:                       Decimal | null;
  theta:                       Decimal | null;
  vega:                        Decimal | null;
  rho:                         Decimal | null;
  filled_at:                   Iso8601 | null;
  closed_at:                   Iso8601 | null;
  close_premium_per_contract:  Decimal | null;
  fees_usd:                    Decimal;
  created_at:                  Iso8601;
  updated_at:                  Iso8601;
}

/**
 * event_log row (v5). NOT an activity — accounting / treasury movements
 * (bridge, convert, transfer, deposit, withdrawal, NFT trade, loss, other)
 * journaled for cost-basis reconciliation and tax lots. Optional back-pointer
 * to the activity that triggered the movement (e.g. withdrawal funding a sale).
 */
export interface EventLog {
  id:                  EventLogId;
  user_id:             UserId;
  kind:                MovementEventKind;
  occurred_at:         Iso8601;
  asset:               string | null;
  amount:              Decimal | null;
  usd_value:           Decimal | null;
  from_venue:          string | null;
  to_venue:            string | null;
  tx_hash:             string | null;
  chain:               string | null;
  fee_usd:             Decimal | null;
  description:         string | null;
  related_activity_id: ActivityId | null;
  created_at:          Iso8601;
  updated_at:          Iso8601;
}

/**
 * Output shape of the v_activity_feed view. One row per non-deleted activity
 * with polymorphic headline_value + headline_kind + headline_format columns
 * driving the unified feed's activity-agnostic card rendering, plus a
 * primary_symbol hint and a short card_subtitle.
 *
 * v5 adds the strategy_tag surface column and the card_subtitle /
 * headline_format fields.
 */
export interface ActivityFeedRow {
  id:                   ActivityId;
  user_id:              UserId;
  type:                 ActivityType;
  status:               ActivityStatus;
  name:                 string;
  opened_at:            Iso8601 | null;
  closed_at:            Iso8601 | null;
  capital_deployed_usd: Decimal | null;
  realized_pnl_usd:     Decimal | null;
  unrealized_pnl_usd:   Decimal | null;
  fees_usd:             Decimal;
  net_pnl_usd:          Decimal | null;
  regime_tags:          string[];
  custom_tags:          string[];
  strategy_tag:         string | null;
  headline_value:       Decimal | null;
  headline_kind:        HeadlineKind;
  headline_format:      HeadlineFormat;
  primary_symbol:       string | null;
  card_subtitle:        string | null;
  created_at:           Iso8601;
  updated_at:           Iso8601;
}

// ---------- Casting helpers ----------
/** Use to unsafely tag a UUID string as a branded ID. Only at trust boundaries. */
export const asId = <Brand>(s: string) => s as string & { readonly __brand: Brand };
