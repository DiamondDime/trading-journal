/**
 * Response shapes for the MCP HTTP API (Phase 1: browsing tools).
 *
 * These are the JSON contracts the stdio MCP binary consumes verbatim.
 *
 * Conventions (CRITICAL — the model needs precision):
 *   • Decimals are strings (never `number`). Money, qty, percentages.
 *   • Timestamps are ISO-8601 UTC (e.g. "2026-05-18T13:42:00.000Z").
 *   • IDs are opaque branded strings (UUID under the hood).
 *   • Snake_case keys throughout — JSON wire format that downstream agents key off.
 *   • Pagination caps at 200 server-side regardless of client request.
 *   • Empty results return { ...payload, empty: true, hint: "..." }.
 */
import type { SpreadId } from '@/types/canonical';

/**
 * Compact spread description used by list_spreads + recent_activity. Designed
 * to be useful on its own (the LLM rarely needs to fetch the full detail) and
 * carries a server-composed one-liner `summary` for narration.
 */
export interface SpreadSummary {
  /** Branded SpreadId — opaque UUID. Pass back to get_spread to drill in. */
  id: string;
  /** ISO-8601 UTC. */
  opened_at: string;
  /** ISO-8601 UTC. Null when status === "open". */
  closed_at: string | null;
  status: 'open' | 'closed';
  /** Primary base symbol e.g. "BTC". Null when unknown. */
  coin: string | null;
  /**
   * Net directional bias. Spreads are typically "neutral" (delta-hedged); this
   * is set only when the leg shape implies a directional view.
   */
  side: 'long' | 'short' | 'neutral' | null;
  /** Distinct exchange display labels across legs (e.g. ["Binance","Bybit"]). */
  venues: string[];
  /** Hold duration in seconds. Null when status === "open". */
  hold_duration_sec: number | null;
  /** Decimal string. Null when status === "open" (no realized P&L yet). */
  net_pnl_usd: string | null;
  /** Decimal string — sum across legs. May be "0" when no fee data captured. */
  fees_usd: string;
  /** Decimal string. Null when funding is not applicable (e.g. all-spot spread). */
  funding_usd: string | null;
  /** Free-form + controlled tag names combined. */
  tags: string[];
  /** Whether the spread has a journal note. */
  has_note: boolean;
  /**
   * One-liner narration composed server-side so the LLM doesn't have to compose
   * it every turn. Example: "BTC long · Binance+Bybit · 3d · +$1,250".
   */
  summary: string;
}

/**
 * Per-leg detail surfaced by get_spread. We expose both position-linked legs
 * (where the trader imported fills via an exchange adapter) and manual legs
 * (where the trader typed the symbol/qty/price directly). The shape is
 * uniform across both — server fills in NULLs where a field doesn't apply.
 */
export interface SpreadLegDetail {
  id: string;
  leg_index: number;
  role: string | null;
  position_id: string | null;
  /** Source of truth flag. */
  is_manual: boolean;
  /** Free-form exchange label (e.g. "Binance") or NULL when only position-linked. */
  exchange: string | null;
  /** Instrument symbol (e.g. "BTC-PERP" or "BTC"). */
  symbol: string | null;
  /** "spot" / "perp" / "dated_future" / "option". */
  instrument_type: string | null;
  side: 'long' | 'short' | null;
  qty: string | null;
  entry_price: string | null;
  exit_price: string | null;
  fees_usd: string | null;
  opened_at: string | null;
  closed_at: string | null;
}

/**
 * Per-fill detail surfaced inside get_spread. One row per atomic exchange
 * execution that landed in a leg's position. Order placement (maker/taker)
 * is exposed because the LLM often wants to discuss execution quality.
 */
export interface SpreadFillDetail {
  id: string;
  leg_index: number;
  side: 'buy' | 'sell';
  qty: string;
  price: string;
  notional: string;
  fee: string;
  fee_currency: string;
  is_maker: boolean;
  executed_at: string;
}

/**
 * Note attached to a spread. v1 has a strict 1:1 between Spread and Note.
 */
export interface SpreadNoteDetail {
  id: string;
  body: string;
  entry_rationale: string | null;
  exit_conclusion: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Full detail returned by get_spread. Inlines the summary fields from
 * SpreadSummary so callers don't have to call both endpoints, and adds the
 * leg/fill/note breakdown an LLM needs to actually narrate a trade review.
 */
export interface SpreadDetail extends SpreadSummary {
  spread_type: string;
  variant: string | null;
  /** Capital deployed at open in USD (decimal string). NULL when unknown. */
  capital_deployed_usd: string | null;
  /** Realized APR as a decimal fraction (0.42 = 42%). NULL when not computable. */
  realized_apr: string | null;
  /** Realized basis-points captured (net). NULL when not computable. */
  bps_captured_net: string | null;
  /** Open-intent trader assumptions captured at journal time. */
  target_apr_at_open: string | null;
  expected_holding_days: number | null;
  exit_plan: string | null;
  legs: SpreadLegDetail[];
  fills: SpreadFillDetail[];
  note: SpreadNoteDetail | null;
}

/**
 * Top-level portfolio snapshot returned by account_overview. Designed to give
 * an LLM a one-shot understanding of "who am I looking at" without further
 * round-trips.
 *
 * SECURITY: never include encrypted_credentials / iv / salt / auth_tag fields
 * from exchange_connections. See serialize.ts for the explicit column list.
 */
export interface AccountSnapshot {
  /** Earliest activity timestamp the user has on record. Null if no activities. */
  active_since: string | null;
  /** Total non-deleted activities across every type. */
  total_activities: number;
  total_spreads: number;
  total_trades: number;
  total_sales: number;
  total_airdrops: number;
  total_yield_positions: number;
  total_options: number;
  /** Sum of net_pnl_usd across all closed activities. Decimal string. */
  lifetime_pnl_usd: string;
  /** Year-to-date P&L (calendar year, UTC). Decimal string. */
  ytd_pnl_usd: string;
  /** Last 30 calendar days P&L. Decimal string. */
  last_30d_pnl_usd: string;
  connected_exchanges: ConnectedExchangeSummary[];
  /** Top 10 tags by usage count. */
  top_tags: { name: string; count: number }[];
  /** Number of spreads with status='open'. */
  open_spreads: number;
  /** Number of options with status='open'. */
  open_options: number;
}

/**
 * Public-safe projection of an exchange_connection row. The encrypted
 * credential columns are explicitly excluded by SELECT in serialize.ts.
 */
export interface ConnectedExchangeSummary {
  /** Canonical exchange catalog code (e.g. "binance"). */
  code: string;
  /** Human-friendly name (e.g. "Binance"). Falls back to code when missing. */
  display_name: string;
  /** ISO-8601 timestamp of the last successful sync. NULL when never synced. */
  last_sync_at: string | null;
}

/** Returned when MCP queries find no rows so the LLM doesn't guess. */
export interface EmptyResultHint {
  empty: true;
  hint: string;
}

/** Top-level error envelope. Mirrored on every non-200 response. */
export interface McpErrorBody {
  error: { code: string; message: string };
}

/** Branded helpers re-export for caller convenience. */
export type { SpreadId };
