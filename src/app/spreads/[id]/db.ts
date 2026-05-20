/**
 * Data layer for the spread detail page (`/spreads/[id]`).
 *
 * Lives next to the route so the spread-detail-specific reads don't bleed into
 * the shared `src/lib/db/activity.ts` module. Two concerns:
 *
 *   1. Real leg decomposition. `spread_legs` holds the actual N legs of a
 *      spread — both position-linked (auto-matched) and inline manual rows.
 *      `getSpreadLegs` reads them, LEFT JOINing `positions` to enrich
 *      position-linked legs. The page renders these instead of the synthetic
 *      `deriveLegs()` fabrication (kept only as a fallback for legacy spreads
 *      with zero `spread_legs` rows).
 *
 *   2. Funding P&L roll-up. Per-leg funding lives in `funding_events`, keyed
 *      to `positions.id`. `getSpreadFundingPnl` aggregates the signed funding
 *      amounts across every position-linked leg into one figure. Pure manual
 *      spreads have no position_ids and therefore no funding — the caller
 *      shows a dash rather than a fabricated zero.
 *
 * Money / quantity values stay as STRINGS end-to-end per CLAUDE.md's
 * "Decimals as strings" rule. Funding arithmetic uses decimal.js so signed
 * sums don't drift through IEEE-754 float.
 */
import Decimal from 'decimal.js';
import { sql } from '@/lib/db/client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// Real spread legs
// ============================================================================

/**
 * One real leg of a spread, normalized across the two storage shapes.
 *
 * `spread_legs` carries a leg in one of two ways:
 *   - position-linked (auto-matched): `position_id` set, leg facts live on the
 *     joined `positions` row (instrument, side, qty, avg prices, fees).
 *   - manual: `position_id` NULL, leg facts inline on `spread_legs`
 *     (symbol, exchange_label, side, qty, entry/exit price, fees_usd).
 *
 * This shape merges both so the UI renders one consistent table. Every
 * numeric field is a string decimal (or null when absent).
 */
export interface SpreadLegRow {
  id: string;
  legIndex: number;
  role: string | null;
  positionId: string | null;
  /** true when this leg is inline manual data (no linked position). */
  isManual: boolean;
  /** Exchange display name — catalog name for position-linked legs, the
   *  user's free-text label for manual legs. */
  venue: string | null;
  /** Instrument symbol, e.g. "BTC-PERP" / "BTC". */
  symbol: string | null;
  /** "spot" / "perp" / "dated_future" / "option". */
  instrumentType: string | null;
  side: 'long' | 'short' | null;
  qty: string | null;
  entryPrice: string | null;
  exitPrice: string | null;
  /** Total round-trip fees in USD (string decimal). */
  feesUsd: string | null;
}

/** Raw DB row before the manual/position-linked merge. */
interface SpreadLegDbRow {
  id: string;
  legIndex: number;
  role: string | null;
  positionId: string | null;
  // manual inline columns
  manualSymbol: string | null;
  manualExchangeLabel: string | null;
  manualSide: string | null;
  manualQty: string | null;
  manualEntryPrice: string | null;
  manualExitPrice: string | null;
  manualFeesUsd: string | null;
  manualInstrumentType: string | null;
  // position-linked columns (NULL when position_id IS NULL)
  positionInstrument: string | null;
  positionInstrumentType: string | null;
  positionSide: 'long' | 'short' | null;
  positionQty: string | null;
  positionAvgEntryPrice: string | null;
  positionAvgExitPrice: string | null;
  positionFeesQuote: string | null;
  /** display_name from exchange_catalog for the position's connection. */
  exchangeDisplayName: string | null;
}

function normalizeSide(v: string | null): 'long' | 'short' | null {
  return v === 'long' || v === 'short' ? v : null;
}

/** Merge a raw row into the unified leg shape, choosing manual or
 *  position-linked source based on whether a position is attached. */
function toLegRow(r: SpreadLegDbRow): SpreadLegRow {
  const isManual = r.positionId === null;
  return {
    id: r.id,
    legIndex: r.legIndex,
    role: r.role,
    positionId: r.positionId,
    isManual,
    venue: isManual ? r.manualExchangeLabel : r.exchangeDisplayName,
    symbol: isManual ? r.manualSymbol : r.positionInstrument,
    instrumentType: isManual
      ? r.manualInstrumentType
      : r.positionInstrumentType,
    side: isManual ? normalizeSide(r.manualSide) : r.positionSide,
    qty: isManual ? r.manualQty : r.positionQty,
    entryPrice: isManual ? r.manualEntryPrice : r.positionAvgEntryPrice,
    exitPrice: isManual ? r.manualExitPrice : r.positionAvgExitPrice,
    feesUsd: isManual ? r.manualFeesUsd : r.positionFeesQuote,
  };
}

/**
 * Fetch the real `spread_legs` rows for a spread, ordered by `leg_index`.
 *
 * The JOIN to `positions` is LEFT — manual legs have NULL `position_id` and
 * carry their facts inline. The chain on through `exchange_connections` →
 * `exchange_catalog` resolves the position's exchange display name. We read
 * only `exchange_code` / `display_name` off the connection — never the
 * encrypted credential columns.
 *
 * Both manual and auto wizard paths persist `spread_legs` (see
 * `src/app/add/spread/db.ts#createSpreadV2`). An empty result means the
 * spread predates the leg-writing wizard — the caller falls back to the
 * synthetic `deriveLegs()` display so there's no regression.
 *
 * Ownership: `spread_legs.user_id` is denormalized from the parent activity,
 * so we gate on it directly. Returns `[]` for non-UUID input.
 */
export async function getSpreadLegs(
  userId: string,
  activityId: string,
): Promise<SpreadLegRow[]> {
  if (!UUID_RE.test(activityId)) return [];

  const rows = await sql<SpreadLegDbRow[]>`
    SELECT
      sl.id                       AS id,
      sl.leg_index                AS leg_index,
      sl.role                     AS role,
      sl.position_id              AS position_id,
      sl.symbol                   AS manual_symbol,
      sl.exchange_label           AS manual_exchange_label,
      sl.side                     AS manual_side,
      sl.qty                      AS manual_qty,
      sl.entry_price              AS manual_entry_price,
      sl.exit_price               AS manual_exit_price,
      sl.fees_usd                 AS manual_fees_usd,
      sl.instrument_type          AS manual_instrument_type,
      p.instrument                AS position_instrument,
      p.instrument_type::text     AS position_instrument_type,
      p.side::text                AS position_side,
      p.total_qty                 AS position_qty,
      p.avg_entry_price           AS position_avg_entry_price,
      p.avg_exit_price            AS position_avg_exit_price,
      p.total_fees_quote          AS position_fees_quote,
      ec.display_name             AS exchange_display_name
    FROM public.spread_legs sl
    LEFT JOIN public.positions p
      ON p.id = sl.position_id AND p.user_id = ${userId}::uuid
    LEFT JOIN public.exchange_connections conn
      ON conn.id = p.exchange_connection_id
    LEFT JOIN public.exchange_catalog ec
      ON ec.code = conn.exchange_code
    WHERE sl.activity_id = ${activityId}::uuid
      AND sl.user_id = ${userId}::uuid
    ORDER BY sl.leg_index ASC, sl.id ASC
  `;

  return rows.map(toLegRow);
}

// ============================================================================
// Funding P&L roll-up
// ============================================================================

/**
 * Aggregated funding figure for a spread.
 *
 * Sign convention (from `funding_events.amount`, migration 004): the amount
 * is signed in the position's currency — positive means funding RECEIVED
 * from the counterparty, negative means funding PAID. So:
 *   - `netUsd`      = sum of all signed amounts (the headline figure)
 *   - `receivedUsd` = sum of the positive amounts only (>= 0)
 *   - `paidUsd`     = sum of the negative amounts only (<= 0)
 * All three are string decimals.
 */
export interface FundingRollup {
  /** Net signed funding. Positive = net received, negative = net paid. */
  netUsd: string;
  /** Sum of funding received (positive events only). Always >= 0. */
  receivedUsd: string;
  /** Sum of funding paid (negative events only). Always <= 0. */
  paidUsd: string;
  /** How many funding_events rows fed the roll-up. */
  eventCount: number;
  /** How many distinct positions contributed (position-linked legs). */
  positionCount: number;
}

/** A single funding event's signed amount — the only field the pure
 *  aggregation needs. */
export interface FundingEventAmount {
  amount: string;
}

/**
 * Pure aggregation of signed funding amounts into a {@link FundingRollup}.
 *
 * Kept side-effect-free (no DB, no clock) so it is unit-testable in
 * isolation. Uses decimal.js for the running sums — funding amounts are
 * numeric(38,18) in Postgres and summing them as JS floats would drift.
 *
 * `positionCount` is supplied by the caller (it knows the leg set); when
 * omitted it defaults to 0.
 */
export function aggregateFundingEvents(
  events: readonly FundingEventAmount[],
  positionCount = 0,
): FundingRollup {
  let net = new Decimal(0);
  let received = new Decimal(0);
  let paid = new Decimal(0);

  for (const ev of events) {
    // Guard against malformed input — a non-numeric amount is skipped rather
    // than poisoning the whole roll-up with NaN.
    let amt: Decimal;
    try {
      amt = new Decimal(ev.amount);
    } catch {
      continue;
    }
    if (!amt.isFinite()) continue;
    net = net.plus(amt);
    if (amt.isPositive()) {
      received = received.plus(amt);
    } else if (amt.isNegative()) {
      paid = paid.plus(amt);
    }
  }

  // `.toFixed()` (no arg) renders the exact value in plain decimal notation.
  // `.toString()` would switch to exponential for very small numeric(38,18)
  // amounts (e.g. "3e-18"), which is awkward for a string-decimal contract
  // that downstream code parses and displays.
  return {
    netUsd: net.toFixed(),
    receivedUsd: received.toFixed(),
    paidUsd: paid.toFixed(),
    eventCount: events.length,
    positionCount,
  };
}

/**
 * Roll up `funding_events` for every position-linked leg of a spread.
 *
 * Only USD-equivalent settlement currencies are summed — the figure is
 * rendered as USD, so coin-margined funding (inverse perps) is excluded
 * rather than mislabeled.
 *
 * `positionIds` is the set of `position_id`s from the spread's legs (callers
 * derive it from {@link getSpreadLegs}). When it is empty the spread has no
 * position-linked legs — a pure manual spread — and funding cannot exist, so
 * we return `null` (the page renders a dash; we never fabricate a zero).
 *
 * Ownership: `funding_events.user_id` is gated directly. Non-UUID position
 * ids are dropped before the query.
 */
export async function getSpreadFundingPnl(
  userId: string,
  positionIds: readonly string[],
): Promise<FundingRollup | null> {
  const valid = positionIds.filter((id) => UUID_RE.test(id));
  if (valid.length === 0) return null;

  const rows = await sql<FundingEventAmount[]>`
    SELECT fe.amount AS amount
    FROM public.funding_events fe
    WHERE fe.position_id = ANY(${valid}::uuid[])
      AND fe.user_id = ${userId}::uuid
      -- The roll-up renders with a "$" prefix, so only USD-equivalent
      -- settlement currencies may be summed; coin-margined funding
      -- (BTC/ETH on inverse perps) is excluded rather than mislabeled.
      AND fe.currency IN ('USDT', 'USDC', 'USD', 'BUSD', 'DAI', 'FDUSD', 'TUSD')
  `;

  return aggregateFundingEvents(rows, valid.length);
}
