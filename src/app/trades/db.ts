/**
 * /trades positions feed — DB helpers.
 *
 * Surfaces every position the user has across every connected exchange as
 * a single flat row list, with optional filters + cursor pagination + a
 * "linked to spread X" indicator.
 *
 * Lives next to the page rather than in `src/lib/db/activity.ts` so the
 * feed-specific shape (positions joined to exchange_connections + the
 * spread_legs/activity left-join for linkage labels) doesn't bleed into the
 * shared module the dashboard / archive depend on.
 *
 * All money / quantity fields stay as strings end-to-end per CLAUDE.md's
 * "Decimals as strings" rule.
 */
import { sql } from '@/lib/db/client';

// ============================================================================
// Public shapes
// ============================================================================

export interface TradeFeedRow {
  id: string;
  exchangeCode: string;
  exchangeConnectionLabel: string;
  instrument: string;
  instrumentType: 'spot' | 'perp' | 'dated_future' | 'option';
  side: 'long' | 'short';
  totalQty: string;
  avgEntryPrice: string;
  avgExitPrice: string | null;
  openedAt: string;
  closedAt: string | null;
  status: 'open' | 'closed';
  realizedPnlQuote: string;
  totalFeesQuote: string;
  totalFundingQuote: string;
  quoteCurrency: string;
  marginMode: 'cross' | 'isolated' | 'spot';
  leverage: string | null;
  linkedActivityId: string | null;
  linkedActivityName: string | null;
}

export interface TradeFeedFilters {
  exchange?: string;
  symbol?: string;
  side?: 'long' | 'short';
  status?: 'open' | 'closed' | 'all';
  instrument?: 'spot' | 'perp' | 'dated_future';
  linked?: 'linked' | 'unlinked' | 'all';
}

export type TradeFeedSort = 'opened_desc' | 'opened_asc' | 'pnl_desc' | 'pnl_asc';

export interface FeedExchangeOption {
  code: string;
  label: string;
  count: number;
}

// ============================================================================
// Helpers
// ============================================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_INSTRUMENTS: ReadonlyArray<TradeFeedFilters['instrument']> = [
  'spot',
  'perp',
  'dated_future',
];

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Cursor encoding — encodes a tuple of (sort-key, id) so cursor pagination
 * stays stable across pages even when many rows share the same timestamp /
 * pnl value. Format: base64("ISO|UUID") for time-based sorts, base64("NUM|UUID")
 * for pnl sorts. We tolerate Date | string input so the caller can hand the
 * raw row off without normalising first.
 */
function encodeCursor(sortKey: string | Date | number, id: string): string {
  const key = sortKey instanceof Date ? sortKey.toISOString() : String(sortKey);
  return Buffer.from(`${key}|${id}`, 'utf8').toString('base64url');
}

interface DecodedCursor {
  sortKey: string;
  id: string;
}

function decodeCursor(raw: string | null | undefined): DecodedCursor | null {
  if (!raw) return null;
  try {
    const txt = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = txt.lastIndexOf('|');
    if (sep < 0) return null;
    const id = txt.slice(sep + 1);
    if (!UUID_RE.test(id)) return null;
    return { sortKey: txt.slice(0, sep), id };
  } catch {
    return null;
  }
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(n)), MAX_LIMIT);
}

// ============================================================================
// listTradeFeed
// ============================================================================

/**
 * Read one page of positions for the trade feed.
 *
 * Implementation notes:
 *   - Single SELECT against positions joined to exchange_connections and
 *     LEFT-joined to (spread_legs → activity) for the linkage label. We pick
 *     the first non-null matching activity using a correlated lateral subquery
 *     so positions with multiple historical spread links (if that ever
 *     happens) don't fan out the result set.
 *   - All filter values are bound via the postgres.js template tag — no raw
 *     string interpolation. Postgres.js coerces values to text parameters
 *     automatically so we don't need a separate sanitiser pass.
 *   - Cursor pagination on (sort-key, id). For desc sorts the next page's
 *     predicate is "(sort-key, id) < (cursor.sortKey, cursor.id)"; for asc
 *     it's ">". The `id` tiebreaker keeps the order deterministic when
 *     opened_at / pnl are equal.
 *   - `total` is a separate count query reusing the same WHERE so the user
 *     sees the unfiltered count for the active filter set.
 *
 * The function returns one extra row past `limit` to detect whether a next
 * page exists, then trims it before returning.
 */
export async function listTradeFeed(
  userId: string,
  filters: TradeFeedFilters,
  sort: TradeFeedSort,
  limit: number,
  cursor: string | null,
): Promise<{ rows: TradeFeedRow[]; nextCursor: string | null; total: number }> {
  if (!UUID_RE.test(userId)) {
    return { rows: [], nextCursor: null, total: 0 };
  }

  const lim = clampLimit(limit);
  const decoded = decodeCursor(cursor);

  // Normalise filters — empty strings collapse to "no filter".
  const fExchange =
    filters.exchange && filters.exchange.trim() ? filters.exchange.trim() : null;
  const fSymbol =
    filters.symbol && filters.symbol.trim() ? filters.symbol.trim() : null;
  const fSide = filters.side === 'long' || filters.side === 'short' ? filters.side : null;
  const fStatus =
    filters.status === 'open' || filters.status === 'closed'
      ? filters.status
      : null;
  const fInstrument =
    filters.instrument && VALID_INSTRUMENTS.includes(filters.instrument)
      ? filters.instrument
      : null;
  const fLinked =
    filters.linked === 'linked' || filters.linked === 'unlinked'
      ? filters.linked
      : null;

  // For numeric cursors (pnl sorts) we need to coerce the cursor's stringified
  // number back to a numeric comparison server-side. Postgres will cast a
  // numeric column against a text parameter implicitly, so we feed it the
  // raw string; the cast happens in the predicate below.
  const cursorKey = decoded?.sortKey ?? null;
  const cursorId = decoded?.id ?? null;

  // Build the ORDER BY + cursor predicate fragments. postgres.js's `sql`
  // template tag returns nested fragments that are spliced in safely.
  const orderClause = (() => {
    switch (sort) {
      case 'opened_asc':
        return sql`ORDER BY p.opened_at ASC, p.id ASC`;
      case 'pnl_desc':
        return sql`ORDER BY (p.realized_pnl_quote - p.total_fees_quote + p.total_funding_quote) DESC, p.id DESC`;
      case 'pnl_asc':
        return sql`ORDER BY (p.realized_pnl_quote - p.total_fees_quote + p.total_funding_quote) ASC, p.id ASC`;
      case 'opened_desc':
      default:
        return sql`ORDER BY p.opened_at DESC, p.id DESC`;
    }
  })();

  // Cursor predicate. Different shapes for time vs numeric sorts; we pass the
  // sortKey verbatim and let Postgres cast.
  const cursorPredicate = (() => {
    if (!cursorKey || !cursorId) return sql``;
    switch (sort) {
      case 'opened_asc':
        return sql`
          AND (p.opened_at, p.id) > (${cursorKey}::timestamptz, ${cursorId}::uuid)
        `;
      case 'pnl_desc':
        return sql`
          AND ((p.realized_pnl_quote - p.total_fees_quote + p.total_funding_quote), p.id)
              < (${cursorKey}::numeric, ${cursorId}::uuid)
        `;
      case 'pnl_asc':
        return sql`
          AND ((p.realized_pnl_quote - p.total_fees_quote + p.total_funding_quote), p.id)
              > (${cursorKey}::numeric, ${cursorId}::uuid)
        `;
      case 'opened_desc':
      default:
        return sql`
          AND (p.opened_at, p.id) < (${cursorKey}::timestamptz, ${cursorId}::uuid)
        `;
    }
  })();

  // Shared WHERE for both rows + count queries. We splice it into both so the
  // count never drifts from the filter the user is looking at.
  const whereClause = sql`
    WHERE p.user_id = ${userId}::uuid
      AND p.deleted_at IS NULL
      ${fExchange ? sql`AND ec.exchange_code = ${fExchange}` : sql``}
      ${fSymbol ? sql`AND p.instrument ILIKE ${'%' + fSymbol + '%'}` : sql``}
      ${fSide ? sql`AND p.side = ${fSide}::position_side` : sql``}
      ${fStatus ? sql`AND p.status = ${fStatus}::position_status` : sql``}
      ${fInstrument ? sql`AND p.instrument_type = ${fInstrument}::instrument_type` : sql``}
      ${fLinked === 'linked' ? sql`AND EXISTS (SELECT 1 FROM public.spread_legs sl WHERE sl.position_id = p.id)` : sql``}
      ${fLinked === 'unlinked' ? sql`AND NOT EXISTS (SELECT 1 FROM public.spread_legs sl WHERE sl.position_id = p.id)` : sql``}
  `;

  type Row = {
    id: string;
    exchangeCode: string;
    exchangeConnectionLabel: string;
    instrument: string;
    instrumentType: 'spot' | 'perp' | 'dated_future' | 'option';
    side: 'long' | 'short';
    totalQty: string;
    avgEntryPrice: string;
    avgExitPrice: string | null;
    openedAt: string | Date;
    closedAt: string | Date | null;
    status: 'open' | 'closed';
    realizedPnlQuote: string;
    totalFeesQuote: string;
    totalFundingQuote: string;
    netPnlQuote: string;
    quoteCurrency: string;
    marginMode: 'cross' | 'isolated' | 'spot';
    leverage: string | null;
    linkedActivityId: string | null;
    linkedActivityName: string | null;
  };

  // We fetch (limit + 1) so we can detect "more pages exist" without a
  // separate has-next query. The extra row is sliced off before return.
  const rows = await sql<Row[]>`
    SELECT
      p.id::text                              AS id,
      ec.exchange_code                        AS exchange_code,
      ec.label                                AS exchange_connection_label,
      p.instrument,
      p.instrument_type,
      p.side,
      p.total_qty                             AS total_qty,
      p.avg_entry_price                       AS avg_entry_price,
      p.avg_exit_price                        AS avg_exit_price,
      p.opened_at,
      p.closed_at,
      p.status,
      p.realized_pnl_quote                    AS realized_pnl_quote,
      p.total_fees_quote                      AS total_fees_quote,
      p.total_funding_quote                   AS total_funding_quote,
      (p.realized_pnl_quote - p.total_fees_quote + p.total_funding_quote)::text
                                              AS net_pnl_quote,
      p.quote_currency                        AS quote_currency,
      p.margin_mode                           AS margin_mode,
      p.leverage,
      link.activity_id::text                  AS linked_activity_id,
      link.name                               AS linked_activity_name
    FROM public.positions p
    JOIN public.exchange_connections ec
      ON ec.id = p.exchange_connection_id
    LEFT JOIN LATERAL (
      SELECT a.id AS activity_id, a.name
      FROM public.spread_legs sl
      JOIN public.activity a ON a.id = sl.activity_id
      WHERE sl.position_id = p.id
        AND a.deleted_at IS NULL
      ORDER BY sl.created_at ASC
      LIMIT 1
    ) link ON true
    ${whereClause}
    ${cursorPredicate}
    ${orderClause}
    LIMIT ${lim + 1}
  `;

  // Count query — same WHERE, no LATERAL join (cheaper). We only want the
  // unfiltered-by-cursor total so the UI can say "showing 1–25 of 73".
  const [countRow] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM public.positions p
    JOIN public.exchange_connections ec
      ON ec.id = p.exchange_connection_id
    ${whereClause}
  `;
  const total = Number(countRow?.count ?? 0);

  const hasMore = rows.length > lim;
  const sliced = hasMore ? rows.slice(0, lim) : rows;

  // Build the next cursor from the LAST row we're returning (not the trimmed
  // one), keyed off the active sort.
  let nextCursor: string | null = null;
  if (hasMore && sliced.length > 0) {
    const last = sliced[sliced.length - 1];
    switch (sort) {
      case 'opened_asc':
      case 'opened_desc':
        nextCursor = encodeCursor(last.openedAt, last.id);
        break;
      case 'pnl_desc':
      case 'pnl_asc':
        nextCursor = encodeCursor(last.netPnlQuote, last.id);
        break;
    }
  }

  // Normalise Date instances to ISO strings — postgres.js's camelCase
  // transform hands timestamptz back as Date. The page formatters expect
  // strings (or null) so we coerce at this boundary.
  const out: TradeFeedRow[] = sliced.map((r) => ({
    id: r.id,
    exchangeCode: r.exchangeCode,
    exchangeConnectionLabel: r.exchangeConnectionLabel,
    instrument: r.instrument,
    instrumentType: r.instrumentType,
    side: r.side,
    totalQty: r.totalQty,
    avgEntryPrice: r.avgEntryPrice,
    avgExitPrice: r.avgExitPrice,
    openedAt: r.openedAt instanceof Date ? r.openedAt.toISOString() : r.openedAt,
    closedAt:
      r.closedAt instanceof Date
        ? r.closedAt.toISOString()
        : (r.closedAt ?? null),
    status: r.status,
    realizedPnlQuote: r.realizedPnlQuote,
    totalFeesQuote: r.totalFeesQuote,
    totalFundingQuote: r.totalFundingQuote,
    quoteCurrency: r.quoteCurrency,
    marginMode: r.marginMode,
    leverage: r.leverage,
    linkedActivityId: r.linkedActivityId,
    linkedActivityName: r.linkedActivityName,
  }));

  return { rows: out, nextCursor, total };
}

// ============================================================================
// listFeedExchangeOptions
// ============================================================================

/**
 * Power the exchange filter dropdown — every exchange the user has at least
 * one position on, with a row count for the option label.
 */
export async function listFeedExchangeOptions(
  userId: string,
): Promise<FeedExchangeOption[]> {
  if (!UUID_RE.test(userId)) return [];

  type Row = { code: string; label: string; count: string };
  const rows = await sql<Row[]>`
    SELECT
      ec.exchange_code                                              AS code,
      coalesce(cat.display_name, initcap(ec.exchange_code))         AS label,
      count(*)::text                                                AS count
    FROM public.positions p
    JOIN public.exchange_connections ec
      ON ec.id = p.exchange_connection_id
    LEFT JOIN public.exchange_catalog cat
      ON cat.code = ec.exchange_code
    WHERE p.user_id = ${userId}::uuid
      AND p.deleted_at IS NULL
    GROUP BY ec.exchange_code, cat.display_name
    ORDER BY count(*) DESC, ec.exchange_code ASC
  `;
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    count: Number(r.count),
  }));
}
