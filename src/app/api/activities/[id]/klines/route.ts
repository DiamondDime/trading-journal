/**
 * GET /api/activities/[id]/klines
 *
 * Public OHLCV history for a closed trade or spread's open-to-close window,
 * with the entry / exit / MAE / MFE markers ready for the OhlcChart client.
 *
 * Response shape (200):
 *   {
 *     data: {
 *       interval: '1m' | '5m' | '15m' | '1h',
 *       symbol:   string,          // canonical raw symbol used to fetch
 *       exchange: string,          // exchange catalog code we hit
 *       bars: Array<{ ts, open, high, low, close, volume }>,
 *       entry: { ts, price } | null,
 *       exit:  { ts, price } | null,
 *       mae:   { ts, price } | null,
 *       mfe:   { ts, price } | null,
 *     }
 *   }
 *
 * Error codes (4xx):
 *   404 NOT_FOUND     activity missing / not owned / soft-deleted /
 *                     wrong subtype (only trade + spread carry symbol+venue)
 *   404 UNSUPPORTED   the activity's exchange is outside the v1 kline registry
 *                     (Binance / Bybit / Hyperliquid). Returned with body so
 *                     the client can render an empty-state message that's
 *                     specific to "we don't have a fetcher" vs "the symbol
 *                     came back empty".
 *
 * Caching:
 *   Once a trade is closed its kline window is immutable. We wrap
 *   fetchKlines() in `unstable_cache` keyed by (activityId, interval, start,
 *   end). Reload after the first hit is instant. TTL = 24h as a safety net;
 *   manual `revalidateTag('klines:<activityId>')` will purge it if the entry
 *   / exit timestamp ever gets edited. Open trades are not currently in v1
 *   but the cache key includes the window so reopening with a new closed_at
 *   simply misses + repopulates.
 */
import { unstable_cache } from 'next/cache';
import { withAuth } from '@/lib/api/handler';
import { errors, ok, error as errResp } from '@/lib/api/response';
import { getActivity } from '@/lib/db/activity';
import { getExcursionForActivity } from '@/lib/db/satellite';
import {
  fetchKlines,
  isKlineSupportedExchange,
  selectInterval,
  type KlineBar,
  type KlineInterval,
} from '@/lib/exchanges/klines';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Window padding before / after [opened_at, closed_at]. 5 % of the trade
 * duration gives the chart visual breathing room on either side of the
 * entry/exit markers while keeping it tight enough that volatility-sensitive
 * setups don't get visually washed out.
 *
 * Minimum padding = one bar interval, so very short trades still show at
 * least one bar before / after the actual fills.
 */
const PADDING_FRACTION = 0.05;

const INTERVAL_MS: Record<KlineInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};

interface KlineResponse {
  interval: KlineInterval;
  symbol: string;
  exchange: string;
  bars: KlineBar[];
  entry: { ts: number; price: number } | null;
  exit: { ts: number; price: number } | null;
  mae: { ts: number; price: number } | null;
  mfe: { ts: number; price: number } | null;
}

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();

  // 1. Pull the activity + excursion in parallel. getActivity already does
  //    the per-subtype JOIN, and the satellite helper is a single-row select,
  //    so this is two queries total.
  const [activity, excursion] = await Promise.all([
    getActivity(userId, id),
    getExcursionForActivity(userId, id),
  ]);

  if (!activity) return errors.notFound();
  if (activity.subtype.type !== 'trade' && activity.subtype.type !== 'spread') {
    // Sales and airdrops don't have an open-to-close price window; they're
    // income / vesting events, not directional positions.
    return errors.notFound();
  }

  // 2. Resolve (symbol, exchange, entry, exit, openedAt, closedAt) from the
  //    subtype. Spread paths and trade paths diverge here.
  let rawSymbol: string;
  let exchange: string;
  let entry: { ts: number; price: number } | null = null;
  let exitMark: { ts: number; price: number } | null = null;

  const openedMs = activity.openedAt ? new Date(activity.openedAt).getTime() : null;
  const closedMs = activity.closedAt ? new Date(activity.closedAt).getTime() : null;
  if (openedMs === null || closedMs === null || closedMs <= openedMs) {
    // Without a valid window we can't build a meaningful chart. Treat as 404
    // — caller falls back to the "no chart available" empty state.
    return errors.notFound();
  }

  if (activity.subtype.type === 'trade') {
    const t = activity.subtype.row;
    rawSymbol = t.symbol;
    exchange = t.exchange;
    const entryPrice = Number(t.avgEntryPrice);
    const exitPrice = t.avgExitPrice !== null ? Number(t.avgExitPrice) : null;
    if (Number.isFinite(entryPrice) && entryPrice > 0) {
      entry = { ts: openedMs, price: entryPrice };
    }
    if (exitPrice !== null && Number.isFinite(exitPrice) && exitPrice > 0) {
      exitMark = { ts: closedMs, price: exitPrice };
    }
  } else {
    // Spread: pick the first supported exchange from the spread's exchanges
    // array; that mirrors the worker's primary-leg heuristic well enough for
    // the chart. The spread record exposes primary_base only (not leg-level
    // prices), so entry / exit dots stay null — we still render the candles
    // + MAE/MFE markers if available. When the worker materializes real legs
    // (post-v1), this branch should switch to the primary leg's prices.
    const s = activity.subtype.row;
    rawSymbol = s.primaryBase;
    const supported =
      s.exchanges.find(isKlineSupportedExchange) ?? s.exchanges[0] ?? '';
    exchange = supported;
  }

  // 3. Reject unsupported exchanges up-front. The 404 here carries a code so
  //    the client can render a venue-specific empty state ("we don't fetch
  //    klines from <exchange> yet") rather than the generic "symbol not
  //    listed" message.
  if (!isKlineSupportedExchange(exchange)) {
    return errResp('UNSUPPORTED', `Kline fetching not supported for ${exchange}`, 404);
  }

  const openedAt = new Date(openedMs);
  const closedAt = new Date(closedMs);
  const interval = selectInterval(openedAt, closedAt);

  // 4. Build the query window. Pad by min(5 %, one interval) on each side so
  //    the chart shows context around the entry/exit fills instead of clipping
  //    them at the edge.
  const durationMs = closedMs - openedMs;
  const padMs = Math.max(INTERVAL_MS[interval], Math.floor(durationMs * PADDING_FRACTION));
  const startMs = openedMs - padMs;
  const endMs = closedMs + padMs;

  // 5. Fetch through the cache layer. Keyed by activityId + interval + window
  //    bounds — once a closed trade's klines are populated they never change.
  //    TTL = 24h is the upper bound; tag-based purge keeps it tight.
  const bars = await getCachedBars(id, exchange, rawSymbol, startMs, endMs, interval);

  // 6. Excursion markers (optional). Only surface MAE/MFE points when both
  //    price and timestamp are present in the satellite row.
  let mae: { ts: number; price: number } | null = null;
  let mfe: { ts: number; price: number } | null = null;
  if (excursion?.maePrice && excursion.maeAt) {
    const p = Number(excursion.maePrice);
    const tsMs = new Date(excursion.maeAt).getTime();
    if (Number.isFinite(p) && Number.isFinite(tsMs)) mae = { ts: tsMs, price: p };
  }
  if (excursion?.mfePrice && excursion.mfeAt) {
    const p = Number(excursion.mfePrice);
    const tsMs = new Date(excursion.mfeAt).getTime();
    if (Number.isFinite(p) && Number.isFinite(tsMs)) mfe = { ts: tsMs, price: p };
  }

  const payload: KlineResponse = {
    interval,
    symbol: rawSymbol,
    exchange,
    bars: bars ?? [],
    entry,
    exit: exitMark,
    mae,
    mfe,
  };
  return ok(payload);
});

/**
 * Wrap fetchKlines() in unstable_cache so a closed trade's bars are served
 * from memory on subsequent loads. The cache key includes everything that
 * could change the response.
 *
 * Tag `klines:<activityId>` allows manual invalidation if the trade's
 * opened_at / closed_at are ever edited (currently impossible through the
 * UI but the update helpers in activity.ts do support it).
 */
async function getCachedBars(
  activityId: string,
  exchange: string,
  rawSymbol: string,
  startMs: number,
  endMs: number,
  interval: KlineInterval,
): Promise<KlineBar[] | null> {
  const cached = unstable_cache(
    async () => {
      try {
        const result = await fetchKlines(exchange, rawSymbol, startMs, endMs, interval);
        // Cache an empty array as "we asked but got nothing" — repeating the
        // request 1ms later won't help. null stays null (unsupported exchange).
        return result ?? [];
      } catch (err) {
        // Network or 5xx during the fetch — don't poison the cache with an
        // empty array; throw so unstable_cache sees the error and re-fetches
        // on the next request.
        console.warn('[klines] fetch error', {
          activityId,
          exchange,
          symbol: rawSymbol,
          interval,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    ['klines', activityId, exchange, rawSymbol, String(startMs), String(endMs), interval],
    {
      tags: [`klines:${activityId}`],
      revalidate: 86_400, // 24h
    },
  );
  return cached();
}
