/**
 * Strategy attribution rollup.
 *
 * Groups every non-deleted activity by the v5 `activity.strategy_tag` column
 * and computes the cumulative scorecard for each tag:
 *
 *   - activity_count        — how many trades / spreads / sales / etc carry the tag
 *   - total_capital_deployed
 *   - net_pnl
 *   - days_active           — span between first opened_at and last closed_at
 *   - realized_apr          — net_pnl / capital × (365 / days_active)
 *   - win_rate              — fraction of activities with net_pnl > 0
 *
 * Plus a daily P&L curve over the last 90 days for the sparkline column.
 *
 * NULL strategy_tag values are bucketed as `'__untagged__'` and rendered with
 * a friendly "Untagged" label by the caller. The sentinel string is chosen
 * to never collide with a real tag (the underscore-prefix convention).
 */
import { sql } from '@/lib/db/client';
import type { Decimal } from '@/types/canonical';

/** Sentinel bucket key for activities with NULL strategy_tag. */
export const UNTAGGED_BUCKET = '__untagged__';

/**
 * Sortable columns. Anything not in this set falls back to net_pnl desc —
 * the default the page boots into.
 */
export type StrategySortField =
  | 'strategy'
  | 'activityCount'
  | 'capital'
  | 'netPnl'
  | 'realizedApr'
  | 'daysActive'
  | 'winRate';

export type SortDir = 'asc' | 'desc';

/** One point in the sparkline series — daily cumulative net P&L. */
export interface StrategySparklinePoint {
  date: string;
  cumulativeNetPnl: number;
}

export interface StrategyRollupRow {
  /**
   * Tag name as stored in `activity.strategy_tag`, or `UNTAGGED_BUCKET`
   * when the underlying rows have NULL strategy_tag. The page caller
   * substitutes the user-facing "Untagged" label at render time.
   */
  strategy: string;
  /** True when this row is the `__untagged__` bucket. Saves the caller a string compare. */
  isUntagged: boolean;
  activityCount: number;
  totalCapitalDeployedUsd: number;
  netPnlUsd: number;
  /** APR % (decimal — multiply by 100 for the display). Null when math degenerates. */
  realizedApr: number | null;
  /** Span between earliest opened_at and latest closed_at within the bucket, in days. */
  daysActive: number;
  /** Win rate as a 0..1 fraction. 0 when activityCount=0 (defensive only — the row would not exist). */
  winRate: number;
  /** Last-90-days daily cumulative P&L points. May be empty if the bucket has no closes in window. */
  sparkline: StrategySparklinePoint[];
}

interface ListStrategyRollupOpts {
  sortBy?: StrategySortField;
  sortDir?: SortDir;
  /** Sparkline window in days. v1 default: 90. */
  sparklineWindowDays?: number;
}

/**
 * Pull the rollup. Two queries — one aggregate per strategy, one daily-bucket
 * series for sparklines. The series query is keyed by strategy_tag so we can
 * fan it out into the rollup rows in a single pass.
 *
 * The aggregate query uses the same `v_activity_feed` view the rest of the
 * journal reads from, so headline numbers stay consistent with /spreads,
 * /analytics/track-record, etc.
 */
export async function listStrategyRollup(
  userId: string,
  opts: ListStrategyRollupOpts = {},
): Promise<StrategyRollupRow[]> {
  const sortBy: StrategySortField = opts.sortBy ?? 'netPnl';
  const sortDir: SortDir = opts.sortDir ?? 'desc';
  const sparklineWindowDays = opts.sparklineWindowDays ?? 90;

  // ── 1. Per-tag aggregates ──────────────────────────────────────────────
  // `coalesce(strategy_tag, UNTAGGED_BUCKET)` collapses NULLs into the
  // sentinel so GROUP BY produces a single row for them. `count(*) filter
  // (where net_pnl_usd > 0)::float / count(*)` gives the win rate without
  // a second pass.
  const aggRows = await sql<
    {
      strategy: string;
      activityCount: string;
      totalCapital: string | null;
      netPnl: string | null;
      winners: string;
      firstOpen: Date | string | null;
      lastClose: Date | string | null;
    }[]
  >`
    select
      coalesce(strategy_tag, ${UNTAGGED_BUCKET})       as strategy,
      count(*)::text                                   as activity_count,
      sum(coalesce(capital_deployed_usd, 0))::text     as total_capital,
      sum(coalesce(net_pnl_usd, 0))::text              as net_pnl,
      count(*) filter (where net_pnl_usd > 0)::text    as winners,
      min(opened_at)                                   as first_open,
      max(closed_at)                                   as last_close
    from public.v_activity_feed
    where user_id = ${userId}::uuid
    group by 1
  `;

  if (aggRows.length === 0) return [];

  // ── 2. Sparkline series ────────────────────────────────────────────────
  // One row per (strategy, date) bucket with sum(net_pnl_usd) on that day.
  // We bucket on closed_at::date in the server's local TZ — same convention
  // as getDailyPnl(). The window is just the last N days; for v1 this is
  // server-side cheap (< 90 rows per strategy).
  const seriesRows = await sql<
    {
      strategy: string;
      day: string;
      dayPnl: string | null;
    }[]
  >`
    select
      coalesce(strategy_tag, ${UNTAGGED_BUCKET})       as strategy,
      to_char(closed_at::date, 'YYYY-MM-DD')           as day,
      sum(coalesce(net_pnl_usd, 0))::text              as day_pnl
    from public.v_activity_feed
    where user_id  = ${userId}::uuid
      and closed_at is not null
      and closed_at >= now() - make_interval(days => ${sparklineWindowDays})
    group by 1, 2
    order by 1 asc, 2 asc
  `;

  // Fan series rows into per-strategy point arrays with running cumulative
  // P&L (caller renders the curve directly).
  const seriesByStrategy = new Map<string, StrategySparklinePoint[]>();
  let cumulative = 0;
  let cursor: string | null = null;
  for (const r of seriesRows) {
    if (r.strategy !== cursor) {
      cumulative = 0;
      cursor = r.strategy;
    }
    cumulative += Number(r.dayPnl ?? 0);
    const list = seriesByStrategy.get(r.strategy) ?? [];
    list.push({ date: r.day, cumulativeNetPnl: cumulative });
    seriesByStrategy.set(r.strategy, list);
  }

  // ── 3. Project aggregates → return rows ────────────────────────────────
  const projected: StrategyRollupRow[] = aggRows.map((r) => {
    const count = Number(r.activityCount ?? 0);
    const capital = Number(r.totalCapital ?? 0);
    const net = Number(r.netPnl ?? 0);
    const winners = Number(r.winners ?? 0);
    const firstOpen = r.firstOpen ? new Date(r.firstOpen as string) : null;
    const lastClose = r.lastClose ? new Date(r.lastClose as string) : null;
    const daysActive =
      firstOpen && lastClose && Number.isFinite(firstOpen.getTime()) && Number.isFinite(lastClose.getTime())
        ? Math.max(0, (lastClose.getTime() - firstOpen.getTime()) / 86_400_000)
        : 0;
    const realizedApr =
      capital > 0 && daysActive > 0
        ? (net / capital) * (365 / daysActive)
        : null;
    return {
      strategy: r.strategy,
      isUntagged: r.strategy === UNTAGGED_BUCKET,
      activityCount: count,
      totalCapitalDeployedUsd: capital,
      netPnlUsd: net,
      realizedApr,
      daysActive,
      winRate: count > 0 ? winners / count : 0,
      sparkline: seriesByStrategy.get(r.strategy) ?? [],
    };
  });

  // ── 4. Apply sort ──────────────────────────────────────────────────────
  // Mutate-and-return is fine — the array is a fresh projection above.
  projected.sort((a, b) => compareRows(a, b, sortBy, sortDir));
  return projected;
}

function compareRows(
  a: StrategyRollupRow,
  b: StrategyRollupRow,
  field: StrategySortField,
  dir: SortDir,
): number {
  const mult = dir === 'asc' ? 1 : -1;

  // String sort for the strategy column. Untagged always sinks to the bottom
  // — it's a residual bucket, never the headline.
  if (field === 'strategy') {
    if (a.isUntagged && !b.isUntagged) return 1;
    if (!a.isUntagged && b.isUntagged) return -1;
    return mult * a.strategy.localeCompare(b.strategy);
  }

  const av = pickNumeric(a, field);
  const bv = pickNumeric(b, field);

  // Null APR rows go last regardless of direction (degenerate math has no
  // signal to sort on — they belong at the tail of the list).
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return mult * (av - bv);
}

function pickNumeric(
  row: StrategyRollupRow,
  field: StrategySortField,
): number | null {
  switch (field) {
    case 'activityCount':
      return row.activityCount;
    case 'capital':
      return row.totalCapitalDeployedUsd;
    case 'netPnl':
      return row.netPnlUsd;
    case 'realizedApr':
      return row.realizedApr;
    case 'daysActive':
      return row.daysActive;
    case 'winRate':
      return row.winRate;
    case 'strategy':
      return null; // unreachable — handled above
  }
}
