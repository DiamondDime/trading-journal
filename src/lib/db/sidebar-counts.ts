/**
 * Sidebar aggregation queries.
 *
 * The sidebar's saved-views block shows a count next to every preset filter.
 * Until v5 those numbers were hardcoded (27/16/5/3/3 — fake). This module
 * replaces them with real aggregates pulled from `v_activity_feed` + the
 * v5 `event_log` table.
 *
 * One round-trip per page render: every count below is computed in a single
 * SELECT against `v_activity_feed`, plus one extra against `event_log` and
 * one against `watchlist`-eligible activities. The query is small (single
 * GROUP BY per CTE) and the user is single-tenant so we don't need
 * cardinality estimates or LATERAL joins.
 */
import { sql } from '@/lib/db/client';
import type { ActivityType } from '@/types/canonical';
import { countEvents } from './events';

export interface SidebarCounts {
  /** Total non-deleted activities across all types. */
  all: number;
  /** Counts per activity type (v5: includes yield_position + option). */
  byType: Record<ActivityType, number>;
  /** Counts per spread sub-type (only spread activities). */
  bySpreadType: {
    cash_carry:     number;
    funding:        number;
    cross_exchange: number;
    calendar:       number;
    dex_cex:        number;
  };
  /** Outcome counts — net_pnl > 0 / < 0 across all closed activities. */
  byOutcome: {
    winners: number;
    losers:  number;
  };
  /** Movement event_log rows. Separate from the activity supertype. */
  movements: number;
  /**
   * Watchlist count — pre-claim airdrops + pre-TGE / vesting sales +
   * open options + winding-down spreads. Mirrors the listWatchlistItems
   * predicate so the badge in the sidebar matches the row count on the
   * watchlist page.
   */
  watchlist: number;
  /**
   * Top strategy tags by count. Capped at 5 — these surface in the sidebar
   * as a "By strategy" group. Entries are sorted by count desc.
   */
  topStrategyTags: { tag: string; count: number }[];
  /**
   * Open exchange positions — feeds the badge on the "Trades" sidebar link.
   * Counts public.positions where status='open' (the rows surfaced on
   * /trades by default).
   */
  openPositions: number;
}

const EMPTY_BY_TYPE: Record<ActivityType, number> = {
  spread:         0,
  trade:          0,
  sale:           0,
  airdrop:        0,
  yield_position: 0,
  option:         0,
};

const EMPTY_BY_SPREAD_TYPE: SidebarCounts['bySpreadType'] = {
  cash_carry:     0,
  funding:        0,
  cross_exchange: 0,
  calendar:       0,
  dex_cex:        0,
};

/**
 * Computes every aggregate the sidebar needs in parallel.
 *
 * Runs all queries in parallel via Promise.all — postgres.js opens one
 * connection per concurrent query (up to pool max) so this fan-out is
 * essentially "one server round-trip wall-clock time".
 */
export async function listSidebarCounts(userId: string): Promise<SidebarCounts> {
  const [
    typeRows,
    spreadTypeRows,
    outcomeRows,
    watchlistRow,
    strategyTagRows,
    movements,
    openPositionsRow,
  ] = await Promise.all([
    sql<{ type: ActivityType; count: string }[]>`
      SELECT type, count(*)::text AS count
      FROM public.v_activity_feed
      WHERE user_id = ${userId}::uuid
      GROUP BY type
    `,
    sql<{ spreadType: string; count: string }[]>`
      SELECT asp.spread_type::text AS spread_type, count(*)::text AS count
      FROM public.activity a
      JOIN public.activity_spread asp ON asp.activity_id = a.id
      WHERE a.user_id = ${userId}::uuid
        AND a.deleted_at IS NULL
      GROUP BY asp.spread_type
    `,
    sql<{ winners: string; losers: string }[]>`
      SELECT
        sum(case when net_pnl_usd > 0 then 1 else 0 end)::text AS winners,
        sum(case when net_pnl_usd < 0 then 1 else 0 end)::text AS losers
      FROM public.v_activity_feed
      WHERE user_id = ${userId}::uuid
        AND closed_at IS NOT NULL
    `,
    sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM public.activity a
      LEFT JOIN public.activity_airdrop ad ON ad.activity_id = a.id
      LEFT JOIN public.activity_sale    s  ON s.activity_id  = a.id
      LEFT JOIN public.activity_option  o  ON o.activity_id  = a.id
      WHERE a.user_id = ${userId}::uuid
        AND a.deleted_at IS NULL
        AND (
          (a.type = 'airdrop' AND a.status = 'pending')
          OR (a.type = 'sale'   AND a.status IN ('pending','vesting'))
          OR (a.type = 'option' AND a.status = 'open')
          OR (a.type = 'spread' AND a.status = 'winding_down')
        )
    `,
    sql<{ tag: string; count: string }[]>`
      SELECT strategy_tag AS tag, count(*)::text AS count
      FROM public.v_activity_feed
      WHERE user_id = ${userId}::uuid
        AND strategy_tag IS NOT NULL
      GROUP BY strategy_tag
      ORDER BY count(*) DESC
      LIMIT 5
    `,
    countEvents(userId),
    sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM public.positions p
      WHERE p.user_id = ${userId}::uuid
        AND p.deleted_at IS NULL
        AND p.status = 'open'
    `,
  ]);

  const byType = { ...EMPTY_BY_TYPE };
  let all = 0;
  for (const r of typeRows) {
    const n = Number(r.count);
    byType[r.type] = n;
    all += n;
  }

  const bySpreadType = { ...EMPTY_BY_SPREAD_TYPE };
  for (const r of spreadTypeRows) {
    if (r.spreadType in bySpreadType) {
      bySpreadType[r.spreadType as keyof typeof bySpreadType] = Number(r.count);
    }
  }

  const winners = Number(outcomeRows[0]?.winners ?? 0);
  const losers  = Number(outcomeRows[0]?.losers  ?? 0);
  const watchlist = Number(watchlistRow[0]?.count ?? 0);

  const topStrategyTags = strategyTagRows.map((r) => ({
    tag:   r.tag,
    count: Number(r.count),
  }));

  return {
    all,
    byType,
    bySpreadType,
    byOutcome: { winners, losers },
    movements,
    watchlist,
    topStrategyTags,
    openPositions: Number(openPositionsRow[0]?.count ?? 0),
  };
}
