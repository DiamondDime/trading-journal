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
  CANDIDATE: 'candidate',
  OPEN:      'open',
  CLOSED:    'closed',
  REJECTED:  'rejected',
} as const;
export type SpreadStatus = typeof SpreadStatus[keyof typeof SpreadStatus];

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
  status:              SpreadStatus;
  origin:              SpreadOrigin;
  name:                string;
  primary_base:        string;
  regime_tags:         string[];
  custom_tags:         string[];
  capital_deployed:    Decimal;
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

// ---------- Casting helpers ----------
/** Use to unsafely tag a UUID string as a branded ID. Only at trust boundaries. */
export const asId = <Brand>(s: string) => s as string & { readonly __brand: Brand };
