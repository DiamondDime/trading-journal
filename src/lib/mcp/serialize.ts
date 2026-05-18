/**
 * Row → response shape adapters for the MCP HTTP API.
 *
 * The DB-side rows come back from postgres.js with `transform: postgres.camel`
 * applied, so the keys we read are camelCase but the wire format we emit is
 * snake_case (matches the MCP contract). This module is the central place
 * that mapping happens.
 *
 * SECURITY NOTE: every SELECT in this module is explicit. We never run
 * `SELECT *` on `exchange_connections` because that table has encrypted
 * credential columns (`api_key_ciphertext`, `api_secret_ciphertext`,
 * `wallet_address_ciphertext`, plus matching `_nonce` columns) that must
 * never reach an LLM. See SECURITY-NON-NEGOTIABLE in the task spec.
 */
import type Decimal from 'decimal.js';
import { Decimal as DecimalCtor } from 'decimal.js';
import type {
  SpreadSummary,
  SpreadLegDetail,
  SpreadFillDetail,
  ConnectedExchangeSummary,
} from './types';

/**
 * Shape returned by `public.spread_pnl` joined with `public.activity`. We
 * spell the columns explicitly so it's obvious which fields are in scope
 * for the summary composer.
 *
 * postgres.js camel transform converts snake_case to camelCase at runtime.
 */
export interface SpreadRowForSummary {
  spreadId: string;
  status: string;
  spreadType: string;
  primaryBase: string | null;
  name: string;
  openedAt: Date | string | null;
  closedAt: Date | string | null;
  netPnlQuote: string | number | null;
  feesQuote: string | number | null;
  fundingReceivedQuote: string | number | null;
  exchanges: string[] | null;
  regimeTags: string[] | null;
  customTags: string[] | null;
  hasNote: boolean;
  /** Comma-joined controlled-vocab tag names (from activity_tag table). */
  freeFormTags: string | null;
}

/** Normalize a Date or ISO string from postgres.js into an ISO-8601 UTC string. */
function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Normalize a postgres NUMERIC column to a decimal string. postgres.js
 * surfaces NUMERIC values as strings by default, but the transform layer
 * occasionally serializes through to JS numbers for small magnitudes (and
 * we want belt-and-suspenders defensive normalization here so the wire
 * format is consistent).
 */
function toDecimalString(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  // Use decimal.js for the conversion to avoid f64 rounding artefacts.
  return new DecimalCtor(v).toString();
}

/**
 * Derive net side from the basket of exchange + spread_type signals. v1 spreads
 * are mostly delta-neutral by construction; we only mark "long"/"short" when
 * the spread type implies a directional bias. Everything else is "neutral".
 */
function inferSide(spreadType: string): SpreadSummary['side'] {
  // Today every supported spread type is structurally delta-neutral. We keep
  // the field nullable + the helper here so future custom variants can be
  // tagged "long"/"short" without a wire-format change.
  if (spreadType === 'custom') return null;
  return 'neutral';
}

/**
 * Compose the one-liner the LLM uses to narrate a row. Format:
 *
 *   "{coin} {side} · {venues} · {hold} · {pnl}"
 *
 * Open spreads omit the pnl segment. Each segment is independently optional —
 * we drop any segment we can't fill in cleanly rather than producing
 * "BTC null · undefined · 0d · NaN".
 */
export function composeSummary(opts: {
  coin: string | null;
  side: SpreadSummary['side'];
  venues: string[];
  status: 'open' | 'closed';
  holdDurationSec: number | null;
  netPnlUsd: string | null;
  fallbackName: string;
}): string {
  const parts: string[] = [];

  // 1. coin + side
  const sideSuffix = opts.side && opts.side !== 'neutral' ? ` ${opts.side}` : '';
  if (opts.coin) {
    parts.push(`${opts.coin}${sideSuffix}`);
  } else if (sideSuffix) {
    parts.push(sideSuffix.trim());
  }

  // 2. venues
  if (opts.venues.length > 0) {
    parts.push(opts.venues.join('+'));
  }

  // 3. hold duration — humanize seconds into d/h/m
  if (opts.holdDurationSec !== null && Number.isFinite(opts.holdDurationSec)) {
    parts.push(humanizeDuration(opts.holdDurationSec));
  } else if (opts.status === 'open') {
    parts.push('open');
  }

  // 4. P&L — only when closed and we have a number
  if (opts.netPnlUsd !== null && opts.status === 'closed') {
    parts.push(formatUsd(opts.netPnlUsd));
  }

  if (parts.length === 0) return opts.fallbackName;
  return parts.join(' · ');
}

/** Format e.g. 86400 → "1d", 5400 → "1h 30m", 90 → "1m". */
function humanizeDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.floor(seconds))}s`;
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes - hours * 60;
  if (hours < 24) {
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours - days * 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

/** Format a decimal string to a signed USD value with comma thousands. */
function formatUsd(value: string): string {
  let d: Decimal;
  try {
    d = new DecimalCtor(value);
  } catch {
    return value;
  }
  const sign = d.isNegative() ? '-' : '+';
  const abs = d.abs();
  // Two decimal places, comma thousand separator, no insane precision tail.
  const fixed = abs.toFixed(2);
  const [whole, frac] = fixed.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${withCommas}${frac ? `.${frac}` : ''}`;
}

/**
 * Map a `spread_pnl` row (+ joined activity columns + tag bundle) into the
 * MCP-facing SpreadSummary. Exposed as a standalone helper so list_spreads
 * and recent_activity can both call it.
 */
export function rowToSpreadSummary(row: SpreadRowForSummary): SpreadSummary {
  // Combine the three tag sources into a deduplicated set:
  //   • activity.regime_tags (system-assigned)
  //   • activity.custom_tags (user freeform on activity row)
  //   • activity_tag.tag rows (free-form setup tags)
  const tagSet = new Set<string>();
  for (const t of row.regimeTags ?? []) {
    if (t && typeof t === 'string') tagSet.add(t);
  }
  for (const t of row.customTags ?? []) {
    if (t && typeof t === 'string') tagSet.add(t);
  }
  if (row.freeFormTags) {
    for (const t of row.freeFormTags.split('\x1f').filter(Boolean)) {
      tagSet.add(t);
    }
  }
  const tags = Array.from(tagSet).sort();

  const venues = (row.exchanges ?? []).filter((e): e is string => !!e);

  const status: 'open' | 'closed' = row.status === 'closed' ? 'closed' : 'open';

  const openedAtIso = toIso(row.openedAt) ?? new Date(0).toISOString();
  const closedAtIso = toIso(row.closedAt);

  const holdDurationSec =
    status === 'closed' && row.openedAt && row.closedAt
      ? Math.max(
          0,
          Math.floor(
            (new Date(row.closedAt as Date).getTime() -
              new Date(row.openedAt as Date).getTime()) /
              1000,
          ),
        )
      : null;

  const netPnlUsd = status === 'closed' ? toDecimalString(row.netPnlQuote) : null;
  // fees_quote in the view is signed (negative = fees paid). For the public
  // wire format we publish absolute fee magnitude — the LLM doesn't need to
  // reason about the sign convention to know "this trade cost $5 in fees".
  const feesRaw = toDecimalString(row.feesQuote);
  const fees =
    feesRaw === null
      ? '0'
      : new DecimalCtor(feesRaw).abs().toString();
  const fundingUsd = toDecimalString(row.fundingReceivedQuote);

  const coin = row.primaryBase;
  const side = inferSide(row.spreadType);

  const summary = composeSummary({
    coin,
    side,
    venues,
    status,
    holdDurationSec,
    netPnlUsd,
    fallbackName: row.name,
  });

  return {
    id: row.spreadId,
    opened_at: openedAtIso,
    closed_at: closedAtIso,
    status,
    coin,
    side,
    venues,
    hold_duration_sec: holdDurationSec,
    net_pnl_usd: netPnlUsd,
    fees_usd: fees,
    funding_usd: fundingUsd,
    tags,
    has_note: row.hasNote,
    summary,
  };
}

/**
 * spread_legs row shape. position-linked legs carry their identifying fields
 * via JOIN to positions; manual legs carry them on the spread_legs row
 * directly (via the manual_spread_legs migration). Either source is honored.
 */
export interface SpreadLegRowForDetail {
  id: string;
  legIndex: number;
  role: string | null;
  positionId: string | null;
  // Manual columns:
  manualSymbol: string | null;
  manualExchangeLabel: string | null;
  manualSide: string | null;
  manualQty: string | null;
  manualEntryPrice: string | null;
  manualExitPrice: string | null;
  manualFeesUsd: string | null;
  manualInstrumentType: string | null;
  // Position-linked columns (NULL when position_id IS NULL):
  positionInstrument: string | null;
  positionInstrumentType: string | null;
  positionSide: 'long' | 'short' | null;
  positionQty: string | null;
  positionAvgEntryPrice: string | null;
  positionAvgExitPrice: string | null;
  positionFeesQuote: string | null;
  positionOpenedAt: Date | string | null;
  positionClosedAt: Date | string | null;
  /** display_name from joined exchange_catalog when position-linked. */
  exchangeDisplayName: string | null;
}

export function rowToSpreadLegDetail(row: SpreadLegRowForDetail): SpreadLegDetail {
  const isManual = row.positionId === null;

  return {
    id: row.id,
    leg_index: row.legIndex,
    role: row.role,
    position_id: row.positionId,
    is_manual: isManual,
    exchange: isManual ? row.manualExchangeLabel : row.exchangeDisplayName,
    symbol: isManual ? row.manualSymbol : row.positionInstrument,
    instrument_type: isManual ? row.manualInstrumentType : row.positionInstrumentType,
    side: isManual
      ? row.manualSide === 'long' || row.manualSide === 'short'
        ? row.manualSide
        : null
      : row.positionSide,
    qty: isManual ? row.manualQty : row.positionQty,
    entry_price: isManual ? row.manualEntryPrice : row.positionAvgEntryPrice,
    exit_price: isManual ? row.manualExitPrice : row.positionAvgExitPrice,
    fees_usd: isManual ? row.manualFeesUsd : row.positionFeesQuote,
    opened_at: isManual ? null : toIso(row.positionOpenedAt),
    closed_at: isManual ? null : toIso(row.positionClosedAt),
  };
}

export interface SpreadFillRowForDetail {
  id: string;
  legIndex: number;
  side: 'buy' | 'sell';
  qty: string;
  price: string;
  notional: string;
  fee: string;
  feeCurrency: string;
  isMaker: boolean;
  executedAt: Date | string;
}

export function rowToSpreadFillDetail(row: SpreadFillRowForDetail): SpreadFillDetail {
  return {
    id: row.id,
    leg_index: row.legIndex,
    side: row.side,
    qty: row.qty,
    price: row.price,
    notional: row.notional,
    fee: row.fee,
    fee_currency: row.feeCurrency,
    is_maker: row.isMaker,
    executed_at: toIso(row.executedAt) ?? new Date(0).toISOString(),
  };
}

/**
 * Exchange-connection projection. We deliberately accept only the columns we
 * intend to expose. The encrypted credential columns
 * (api_key_ciphertext / api_secret_ciphertext / api_passphrase_ciphertext /
 * wallet_address_ciphertext, plus all matching _nonce variants) are NOT
 * accepted by this type — code that constructs a row for this helper must
 * SELECT only the listed columns.
 */
export interface ExchangeConnectionRowForSummary {
  exchangeCode: string;
  exchangeDisplayName: string | null;
  lastSyncAt: Date | string | null;
}

export function rowToConnectedExchange(
  row: ExchangeConnectionRowForSummary,
): ConnectedExchangeSummary {
  return {
    code: row.exchangeCode,
    display_name: row.exchangeDisplayName ?? row.exchangeCode,
    last_sync_at: toIso(row.lastSyncAt),
  };
}
