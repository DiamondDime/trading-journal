/**
 * Page-level series builders for the /analytics/* suite.
 *
 * These compose on top of the pure-function math in `metrics.ts` / `risk.ts`
 * and return display-ready point series. They are intentionally NOT in
 * metrics.ts because they bake in display conventions (label formatting,
 * date keys, chart-friendly shapes) that the math library has no business
 * knowing about.
 *
 * All helpers expect the normalised camelCase ActivityFeedRowDb shape from
 * `src/lib/db/activity.ts` and tolerate empty inputs gracefully.
 */
import Decimal from 'decimal.js';
import type { ActivityFeedRowDb } from '@/lib/db/activity';
import type { EquityPoint } from '@/components/spread/equity-curve-chart';
import type { UnderwaterPoint } from '@/components/analytics/underwater-chart';
import type { RollingWinRatePoint } from '@/components/analytics/rolling-win-rate-chart';

// =============================================================================
// Coercion helpers — closedAt can arrive as Date or string from postgres.js.
// =============================================================================

function isoOfClosedAt(v: unknown): string | null {
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return null;
    return v.toISOString();
  }
  if (typeof v === 'string' && v.length >= 10) return v;
  return null;
}

function fmtLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// =============================================================================
// buildEquityPoints — daily-bucketed cumulative equity curve.
// =============================================================================

/**
 * Walk closed activities in chronological order, bucketing per calendar day.
 * Each output point is one bucket with running cumulative equity + running
 * peak + drawdown.
 *
 * Used by both the dashboard's compact chart and the track-record's large
 * variant — the data shape is identical.
 */
export function buildEquityPoints(
  rows: ActivityFeedRowDb[],
): EquityPoint[] {
  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const iso = isoOfClosedAt(r.closedAt);
    if (!iso || r.netPnlUsd == null) continue;
    const pnl = Number(r.netPnlUsd);
    if (!Number.isFinite(pnl)) continue;
    const ymd = iso.slice(0, 10);
    dayMap.set(ymd, (dayMap.get(ymd) ?? 0) + pnl);
  }
  const ordered = [...dayMap.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  let equity = 0;
  let peak = 0;
  const points: EquityPoint[] = [];
  for (const [ymd, dayPnl] of ordered) {
    equity += dayPnl;
    if (equity > peak) peak = equity;
    points.push({
      date: ymd,
      label: fmtLabel(ymd),
      equity,
      peak,
      drawdownUsd: equity - peak,
    });
  }
  return points;
}

// =============================================================================
// buildUnderwaterPoints — drawdown % time series.
// =============================================================================

/**
 * For each equity point produced by `buildEquityPoints`, compute the drawdown
 * percentage `(equity - peak) / peak`. By construction this is always ≤ 0:
 *   • equity > peak is impossible (peak is the running max),
 *   • equity = peak gives 0%,
 *   • equity < peak gives negative %.
 *
 * Edge case: when peak == 0 (very first activity is a loss), we report 0%
 * for that point — there's no prior high to fall from. The underwater curve
 * "starts" the first time equity prints positive.
 */
export function buildUnderwaterPoints(
  rows: ActivityFeedRowDb[],
): UnderwaterPoint[] {
  const equity = buildEquityPoints(rows);
  return equity.map((p) => {
    const ddPct = p.peak > 0 ? (p.equity - p.peak) / p.peak : 0;
    return {
      date: p.date,
      label: p.label,
      ddPct: Math.min(0, ddPct),
      ddUsd: Math.min(0, p.drawdownUsd),
    };
  });
}

// =============================================================================
// buildRollingWinRate — sliding window of N-most-recent priors.
// =============================================================================

/**
 * For each activity (in chronological order), report the win rate of the
 * `window` activities that closed BEFORE it. The first activity reports the
 * empty-window rate (0); the second reports the rate of just the first one;
 * the kth (k < window) reports the rate of k-1 priors; everything after
 * reports a true `window`-sized rolling rate.
 *
 * "Win" is defined as netPnl > 0; zero and negative don't count as wins.
 * The denominator is the number of priors with non-null pnl (we skip any
 * activity in the window that's missing the netPnl signal).
 *
 * Why a 1-step lag (prior window, not inclusive of current): the chart
 * answers "where was my edge GOING IN to this activity?" — adding the
 * current activity to the window leaks the outcome forward.
 */
export function buildRollingWinRate(
  rows: ActivityFeedRowDb[],
  window: number,
): RollingWinRatePoint[] {
  // Normalise to chronological order, drop rows without enough signal.
  type Norm = { closedAt: string; netPnl: number };
  const list: Norm[] = [];
  for (const r of rows) {
    const iso = isoOfClosedAt(r.closedAt);
    if (!iso || r.netPnlUsd == null) continue;
    const pnl = Number(r.netPnlUsd);
    if (!Number.isFinite(pnl)) continue;
    list.push({ closedAt: iso, netPnl: pnl });
  }
  list.sort((a, b) => (a.closedAt < b.closedAt ? -1 : a.closedAt > b.closedAt ? 1 : 0));

  if (list.length === 0) return [];

  const out: RollingWinRatePoint[] = [];
  for (let i = 0; i < list.length; i++) {
    // Priors are `[max(0, i - window), i)` — exclusive of i, the current one.
    const start = Math.max(0, i - window);
    const priors = list.slice(start, i);
    const windowSize = priors.length;
    const winners = priors.reduce((c, p) => c + (p.netPnl > 0 ? 1 : 0), 0);
    const winRate = windowSize > 0 ? winners / windowSize : 0;
    out.push({
      index: i + 1,
      label: fmtLabel(list[i].closedAt.slice(0, 10)),
      winRate,
      windowSize,
      winners,
    });
  }
  // We intentionally include the early points (windowSize < window) — they
  // give the chart a sense of "first N activities" rather than starting it
  // visually empty for the first 20 entries.
  return out;
}

// =============================================================================
// pickTopBestWorst — top N by net P&L, with rUnit-based R-multiple.
// =============================================================================

/**
 * Return the top `n` activities sorted by net P&L (descending for best,
 * ascending for worst). Each row gets an R-multiple computed against the
 * given rUnit; when rUnit is 0 / undefined, rMultiple is null.
 *
 * The shape is `{ row, rMultiple }` so the consumer can adapt the row into
 * the display Activity later without recomputing R.
 */
export function pickTopBestWorst(
  rows: ActivityFeedRowDb[],
  n: number,
  rUnit: number,
): {
  best: Array<{ row: ActivityFeedRowDb; rMultiple: number | null }>;
  worst: Array<{ row: ActivityFeedRowDb; rMultiple: number | null }>;
} {
  // Filter to rows with a scoring netPnl; we don't want zero-PnL airdrops
  // crowding either list.
  const scoring = rows.filter((r) => {
    if (r.netPnlUsd == null) return false;
    const n = Number(r.netPnlUsd);
    return Number.isFinite(n) && n !== 0;
  });

  const valid = rUnit > 0 && Number.isFinite(rUnit);

  const sortedDesc = [...scoring].sort(
    (a, b) => Number(b.netPnlUsd) - Number(a.netPnlUsd),
  );
  const sortedAsc = [...scoring].sort(
    (a, b) => Number(a.netPnlUsd) - Number(b.netPnlUsd),
  );

  function map(rows: ActivityFeedRowDb[]) {
    return rows.slice(0, n).map((row) => ({
      row,
      rMultiple: valid ? Number(row.netPnlUsd) / rUnit : null,
    }));
  }

  return {
    best: map(sortedDesc),
    worst: map(sortedAsc),
  };
}

// =============================================================================
// computeAtHomeNet — running cumulative net P&L for headline display.
// =============================================================================

/** Sum of net P&L across all rows. Uses Decimal to avoid penny drift. */
export function computeCumulativeNet(rows: ActivityFeedRowDb[]): number {
  let acc = new Decimal(0);
  for (const r of rows) {
    if (r.netPnlUsd == null) continue;
    const n = Number(r.netPnlUsd);
    if (!Number.isFinite(n)) continue;
    acc = acc.plus(n);
  }
  return acc.toNumber();
}
