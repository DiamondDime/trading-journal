/**
 * Pure-function analytics over closed activities.
 *
 * Inputs use the camelCase `ActivityFeedRowDb` shape returned by
 * `src/lib/db/activity.ts`. `netPnlUsd` and `capitalDeployedUsd` arrive as
 * `Decimal | null` (postgres.js gives back strings). All helpers in this
 * module:
 *
 *   • take a CLOSED activities array — caller is responsible for filtering by
 *     status; we additionally skip rows with null `closedAt` or null `netPnlUsd`
 *     defensively so the math never explodes on partially-hydrated rows.
 *   • are sort-stable: we re-sort by `closedAt ASC` internally so callers do
 *     not have to pre-sort.
 *   • return a zero-shaped result on empty input rather than throw.
 *
 * Precision: `Decimal.js` for cumulative sums (where small rounding errors
 * compound across hundreds of activities). We coerce to `number` for ratios
 * where the loss of precision past the 15th significant digit is irrelevant
 * (drawdown percentages, win rates, etc).
 */

import Decimal from 'decimal.js';
import type { ActivityFeedRowDb } from '@/lib/db/activity';

// =============================================================================
// Public result shapes
// =============================================================================

export interface DrawdownResult {
  /** Worst peak-to-trough drop in dollars. Non-negative. */
  maxDrawdownUsd: number;
  /** maxDrawdownUsd / peakAtMaxDrawdown. 0 if the peak was 0 (no prior high). */
  maxDrawdownPct: number;
  /** closedAt of the activity that established the peak we fell from. Null when
   * peak was the initial-state 0 (i.e. the very first trade was a loss), or
   * when no drawdown ever occurred. */
  peakAt: string | null;
  /** closedAt of the activity at the trough of the max drawdown. Null when no
   * drawdown ever occurred. */
  troughAt: string | null;
  /** closedAt of the activity where equity first returned to >= peakAtMaxDrawdown
   * after the trough. Null if still under that peak at the end of the series. */
  recoveredAt: string | null;
  /** Present-day drawdown from all-time-high equity. 0 if at new high. */
  currentDrawdownUsd: number;
}

export interface StreakResult {
  longestWinStreak: number;
  longestLossStreak: number;
  /** Streak at the end of the series. `kind='none'` only when there are no
   * scoring activities (every row was a flat zero or input was empty). */
  currentStreak: { kind: 'win' | 'loss' | 'none'; length: number };
}

export interface RDistribution {
  bins: Array<{ rangeLow: number; rangeHigh: number; count: number; label: string }>;
  median: number;
  mean: number;
  positiveCount: number;
  negativeCount: number;
}

export interface MoreMetrics {
  /** gross wins / |gross losses|. null when there are no losses. */
  profitFactor: number | null;
  /** avgWin / |avgLoss|. null when there are no wins or no losses. */
  payoffRatio: number | null;
  /** mean(netPnl) — winRate*avgWin - lossRate*|avgLoss| (algebraically equivalent). */
  expectancy: number;
  /** Van Tharp's SQN: expectancy / stddev(pnl) * sqrt(N). null when stddev=0 or N<2. */
  systemQualityNumber: number | null;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
}

// =============================================================================
// Internal: normalize input rows once for every helper.
//
// • Coerces netPnl string → number (small precision loss acceptable here; the
//   raw values are USD with at most 2-4 decimals of meaningful precision).
// • Drops rows missing closedAt or netPnlUsd.
// • Returns rows sorted ASC by closedAt for time-series math.
// =============================================================================

interface Normalized {
  closedAt: string;
  netPnl: number;
  capitalDeployedUsd: number | null;
}

function normalize(activities: ActivityFeedRowDb[]): Normalized[] {
  const out: Normalized[] = [];
  for (const a of activities) {
    if (a.closedAt == null || a.netPnlUsd == null) continue;
    const pnl = Number(a.netPnlUsd);
    if (!Number.isFinite(pnl)) continue;
    const cap = a.capitalDeployedUsd == null ? null : Number(a.capitalDeployedUsd);
    // postgres.js auto-parses timestamptz to Date even though the type says
    // string | null. Coerce both shapes to ISO 8601.
    const raw = a.closedAt as unknown;
    const iso = raw instanceof Date ? raw.toISOString() : (raw as string);
    out.push({
      closedAt: iso,
      netPnl: pnl,
      capitalDeployedUsd: cap != null && Number.isFinite(cap) ? cap : null,
    });
  }
  // Stable sort by closedAt ASC. JS Array#sort has been spec-stable since
  // ES2019 so ties preserve original input order — fine here.
  out.sort((a, b) => (a.closedAt < b.closedAt ? -1 : a.closedAt > b.closedAt ? 1 : 0));
  return out;
}

// =============================================================================
// computeDrawdown
// =============================================================================

/**
 * Walk closed activities in chronological order, tracking running equity
 * (cumulative net PnL). For each step:
 *
 *   • equity = previous equity + this activity's net PnL
 *   • peak   = max(peak, equity); when equity > peak, this row becomes the
 *              candidate "peak" for any drawdown that follows.
 *   • drawdown = peak - equity (always >= 0)
 *
 * The "max drawdown" is the largest drawdown ever observed during the walk.
 * Recovery: once we have the max-drawdown peak fixed, recovery is the first
 * subsequent point where equity >= that peak.
 *
 * Edge cases handled:
 *   • Empty input → zero result.
 *   • All wins → max drawdown 0, peakAt/troughAt/recoveredAt null.
 *   • All losses (peak stays at the initial 0) → maxDrawdownPct = 0 (peak=0
 *     ratio undefined per spec), peakAt = null (no activity established the
 *     peak), troughAt = the worst-equity activity, recoveredAt = null.
 *   • Multi-peak with recovery in middle → tracks the worst draw across the
 *     full series, not just the final one.
 */
export function computeDrawdown(activities: ActivityFeedRowDb[]): DrawdownResult {
  const rows = normalize(activities);
  if (rows.length === 0) {
    return {
      maxDrawdownUsd: 0,
      maxDrawdownPct: 0,
      peakAt: null,
      troughAt: null,
      recoveredAt: null,
      currentDrawdownUsd: 0,
    };
  }

  // We use Decimal for the equity walk — pennies compound when you stack
  // hundreds of activities and small floating-point error can flip an
  // equity > peak comparison at the boundary.
  let equity = new Decimal(0);
  let peak = new Decimal(0);
  // peakClosedAt tracks the closedAt of the activity that set the current peak.
  // null while peak is still the initial 0 (no activity has surpassed start).
  let peakClosedAt: string | null = null;

  let maxDrawdown = new Decimal(0);
  let maxDrawdownPeak = new Decimal(0); // peak at the moment of max drawdown
  let maxDrawdownPeakAt: string | null = null;
  let maxDrawdownTroughAt: string | null = null;

  for (const r of rows) {
    equity = equity.plus(r.netPnl);
    if (equity.gt(peak)) {
      peak = equity;
      peakClosedAt = r.closedAt;
    }
    const drawdown = peak.minus(equity);
    if (drawdown.gt(maxDrawdown)) {
      maxDrawdown = drawdown;
      maxDrawdownPeak = peak;
      maxDrawdownPeakAt = peakClosedAt;
      maxDrawdownTroughAt = r.closedAt;
    }
  }

  // Recovery scan: walk again from the trough forward; first time equity
  // >= maxDrawdownPeak is the recovery point.
  let recoveredAt: string | null = null;
  if (maxDrawdown.gt(0) && maxDrawdownTroughAt != null) {
    let scanEquity = new Decimal(0);
    let pastTrough = false;
    for (const r of rows) {
      scanEquity = scanEquity.plus(r.netPnl);
      if (!pastTrough) {
        if (r.closedAt === maxDrawdownTroughAt) pastTrough = true;
        continue;
      }
      if (scanEquity.gte(maxDrawdownPeak)) {
        recoveredAt = r.closedAt;
        break;
      }
    }
  }

  // Current drawdown = how far below the all-time-high we sit at series end.
  const currentDrawdown = peak.minus(equity);

  // Ratio guard: when peak is 0 (all-losses case), no drawdown ratio exists.
  const maxDrawdownPct = maxDrawdownPeak.gt(0)
    ? maxDrawdown.div(maxDrawdownPeak).toNumber()
    : 0;

  return {
    maxDrawdownUsd: maxDrawdown.toNumber(),
    maxDrawdownPct,
    peakAt: maxDrawdown.gt(0) ? maxDrawdownPeakAt : null,
    troughAt: maxDrawdown.gt(0) ? maxDrawdownTroughAt : null,
    recoveredAt,
    currentDrawdownUsd: currentDrawdown.toNumber(),
  };
}

// =============================================================================
// computeStreaks
// =============================================================================

/**
 * Walk in chronological order. Activities with positive netPnl extend a win
 * streak; negative extends a loss streak; exactly zero resets neither
 * direction (it's neither a win nor a loss — call it a flat; we treat it as
 * a streak-break for both). The `currentStreak` reports what was running at
 * the end of the series.
 */
export function computeStreaks(activities: ActivityFeedRowDb[]): StreakResult {
  const rows = normalize(activities);
  if (rows.length === 0) {
    return {
      longestWinStreak: 0,
      longestLossStreak: 0,
      currentStreak: { kind: 'none', length: 0 },
    };
  }

  let winRun = 0;
  let lossRun = 0;
  let longestWin = 0;
  let longestLoss = 0;
  // Last meaningful streak kind — what's "currently running" at series end.
  let currentKind: 'win' | 'loss' | 'none' = 'none';
  let currentLen = 0;

  for (const r of rows) {
    if (r.netPnl > 0) {
      winRun += 1;
      lossRun = 0;
      if (winRun > longestWin) longestWin = winRun;
      currentKind = 'win';
      currentLen = winRun;
    } else if (r.netPnl < 0) {
      lossRun += 1;
      winRun = 0;
      if (lossRun > longestLoss) longestLoss = lossRun;
      currentKind = 'loss';
      currentLen = lossRun;
    } else {
      // Exact zero — neither win nor loss. Break both runs but don't extend
      // a streak. The current-streak indicator stays whatever it was unless
      // we want to be strict — we choose "flat is a break", so reset display.
      winRun = 0;
      lossRun = 0;
      currentKind = 'none';
      currentLen = 0;
    }
  }

  return {
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    currentStreak: { kind: currentKind, length: currentLen },
  };
}

// =============================================================================
// computeRDistribution
// =============================================================================

/**
 * Histogram of R-multiples. R is defined as `netPnl / rUnit`, where `rUnit`
 * is the user-defined dollar value of "1R" (typically average loss, or the
 * pre-trade risk per unit). The caller passes `rUnit` in — this helper does
 * not infer it.
 *
 * Bin layout: width = `binWidth` (default 0.5R). The range spans the data
 * symmetrically so the histogram visually balances around 0. We snap the
 * outer edges to multiples of `binWidth` so labels are clean.
 *
 * Returns:
 *   • bins: ordered low → high. Each bin's range is [low, high).
 *   • median, mean: in R units
 *   • positiveCount, negativeCount: in R units (zero counts as neither)
 */
export function computeRDistribution(
  activities: ActivityFeedRowDb[],
  rUnit: number,
  binWidth: number = 0.5,
): RDistribution {
  const rows = normalize(activities);
  // rUnit must be positive — a 0 or negative value would invert sign semantics
  // and make the distribution meaningless. Bail with an empty result.
  if (rows.length === 0 || !(rUnit > 0) || !(binWidth > 0)) {
    return {
      bins: [],
      median: 0,
      mean: 0,
      positiveCount: 0,
      negativeCount: 0,
    };
  }

  const rValues = rows.map((r) => r.netPnl / rUnit);
  const min = Math.min(...rValues);
  const max = Math.max(...rValues);

  // Snap to bin boundaries so labels are tidy. Floor for the low edge, ceil
  // for the high. Use a tiny epsilon to avoid snapping a value that's
  // exactly on a boundary onto the next bin.
  const floorEdge = Math.floor(min / binWidth) * binWidth;
  const ceilEdge = Math.ceil(max / binWidth) * binWidth;
  // Ensure we always have at least one bin even if all values are identical.
  const endEdge = ceilEdge === floorEdge ? floorEdge + binWidth : ceilEdge;

  const bins: Array<{ rangeLow: number; rangeHigh: number; count: number; label: string }> = [];
  // Build bins as half-open intervals [low, high). Last bin is inclusive on
  // the right so the max value isn't dropped on a boundary.
  for (let edge = floorEdge; edge < endEdge - 1e-9; edge += binWidth) {
    const low = roundTo(edge, 6);
    const high = roundTo(edge + binWidth, 6);
    bins.push({
      rangeLow: low,
      rangeHigh: high,
      count: 0,
      label: `${low.toFixed(1)}R to ${high.toFixed(1)}R`,
    });
  }

  for (const v of rValues) {
    // Find the bin: ((v - floorEdge) / binWidth) is the index, clamp to
    // last bin for the inclusive-right edge case.
    let idx = Math.floor((v - floorEdge) / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= bins.length) idx = bins.length - 1;
    bins[idx].count += 1;
  }

  // mean / median in R units
  const mean = rValues.reduce((s, v) => s + v, 0) / rValues.length;
  const sorted = [...rValues].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  let positiveCount = 0;
  let negativeCount = 0;
  for (const v of rValues) {
    if (v > 0) positiveCount += 1;
    else if (v < 0) negativeCount += 1;
  }

  return { bins, median, mean, positiveCount, negativeCount };
}

// =============================================================================
// computeMoreMetrics
// =============================================================================

/**
 * Standard performance metrics derived from netPnl alone. All ratios guard
 * against division by zero by returning `null` when undefined.
 *
 *   • profitFactor = Σ wins / |Σ losses|. null when there are no losses.
 *   • payoffRatio  = avgWin / |avgLoss|. null when either side is empty.
 *   • expectancy   = mean(netPnl) across all activities. (Algebraically equal
 *                    to winRate*avgWin - lossRate*|avgLoss|.)
 *   • SQN          = (expectancy / stddev(netPnl)) * sqrt(N). Van Tharp's
 *                    formula. null when stddev = 0 or N < 2.
 */
export function computeMoreMetrics(activities: ActivityFeedRowDb[]): MoreMetrics {
  const rows = normalize(activities);
  if (rows.length === 0) {
    return {
      profitFactor: null,
      payoffRatio: null,
      expectancy: 0,
      systemQualityNumber: null,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
    };
  }

  let grossWins = new Decimal(0);
  let grossLosses = new Decimal(0); // accumulator stays positive (sum of |losses|)
  let winCount = 0;
  let lossCount = 0;
  let largestWin = 0;
  let largestLoss = 0; // negative number; 0 if no losses

  for (const r of rows) {
    if (r.netPnl > 0) {
      grossWins = grossWins.plus(r.netPnl);
      winCount += 1;
      if (r.netPnl > largestWin) largestWin = r.netPnl;
    } else if (r.netPnl < 0) {
      grossLosses = grossLosses.plus(Math.abs(r.netPnl));
      lossCount += 1;
      if (r.netPnl < largestLoss) largestLoss = r.netPnl;
    }
  }

  const avgWin = winCount > 0 ? grossWins.div(winCount).toNumber() : 0;
  const avgLoss = lossCount > 0 ? grossLosses.div(lossCount).toNumber() : 0;
  // expectancy = mean of netPnl — independent algebraic path, not derived
  // from win/loss split (so it remains correct when there are zero-pnl rows).
  const sumAll = rows.reduce((acc, r) => acc.plus(r.netPnl), new Decimal(0));
  const expectancy = sumAll.div(rows.length).toNumber();

  // stddev (population) for SQN. We use population (not sample) per the
  // Van Tharp convention — for N=1 stddev is 0 and SQN is undefined anyway.
  const meanNum = expectancy;
  let sqSum = new Decimal(0);
  for (const r of rows) {
    const d = new Decimal(r.netPnl).minus(meanNum);
    sqSum = sqSum.plus(d.times(d));
  }
  const variance = rows.length > 0 ? sqSum.div(rows.length).toNumber() : 0;
  const stddev = Math.sqrt(variance);

  const profitFactor =
    lossCount > 0 ? grossWins.div(grossLosses).toNumber() : null;
  const payoffRatio =
    winCount > 0 && lossCount > 0 ? avgWin / avgLoss : null;
  const systemQualityNumber =
    rows.length >= 2 && stddev > 0
      ? (expectancy / stddev) * Math.sqrt(rows.length)
      : null;

  return {
    profitFactor,
    payoffRatio,
    expectancy,
    systemQualityNumber,
    avgWin,
    avgLoss, // positive number — caller can prefix '-' if rendering as "avg loss"
    largestWin,
    largestLoss, // negative number — preserved sign so callers can format
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

function roundTo(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
