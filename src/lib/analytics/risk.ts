/**
 * Risk-adjusted return metrics — Sharpe & Sortino — over a series of closed
 * activities.
 *
 * These metrics care about return *variance*, so they roll the activity series
 * up to one observation per day. We use the time-weighted-return approach:
 *
 *   • Sum each day's netPnl.
 *   • Maintain a running "account equity" baseline = cumulative netPnl from
 *     the start of the series, treating equity at series-start as a synthetic
 *     "starting capital" so day-1's return % is computable.
 *   • Daily return % = todayPnl / equityAtStartOfDay (i.e. previous day's
 *     closing equity, or starting capital on day 1).
 *
 * Annualization defaults to 365 (crypto trades 24/7). Pass `annualizationFactor:
 * 252` for stock-style annualization. Default risk-free rate is 0 — adjust via
 * `options.riskFreeRate` (annual decimal, e.g. 0.04 for 4%).
 *
 * Starting-capital convention: when capitalDeployedUsd is available on the
 * first day, we use it as the synthetic starting equity. When it isn't (some
 * rows have null capitalDeployed), we fall back to the absolute value of the
 * day's net pnl — this prevents div-by-zero and keeps the day-1 return finite,
 * though the practical effect on long series is negligible since later days
 * use accumulated equity.
 *
 * Sample-size guard: < 7 daily observations returns zeros so the dashboard can
 * render "Not enough data yet" instead of a flapping value.
 */

import Decimal from 'decimal.js';
import type { ActivityFeedRowDb } from '@/lib/db/activity';

export interface SharpeResult {
  /** Annualized Sharpe ratio. 0 when sampleDays < 7 or stddev is 0. */
  sharpe: number;
  /** Annualized Sortino ratio. 0 when no downside variance to measure. */
  sortino: number;
  meanDailyReturnPct: number;
  stdevDailyReturnPct: number;
  downsideStdevDailyReturnPct: number;
  sampleDays: number;
  annualizationFactor: number;
  /** When false, sampleDays was below the minimum threshold (7) — callers
   * should render an "insufficient data" state rather than the raw numbers. */
  enoughData: boolean;
}

export interface SharpeOptions {
  /** Annual periods per year. Default 365 (crypto 24/7). Use 252 for stocks. */
  annualizationFactor?: number;
  /** Annual risk-free rate as decimal (0.04 = 4%). Default 0. */
  riskFreeRate?: number;
}

const MIN_SAMPLE_DAYS = 7;

export function computeSharpeSortino(
  activities: ActivityFeedRowDb[],
  options: SharpeOptions = {},
): SharpeResult {
  const annualization = options.annualizationFactor ?? 365;
  const annualRiskFree = options.riskFreeRate ?? 0;
  const dailyRiskFree = annualRiskFree / annualization;

  // Group by YYYY-MM-DD prefix of closedAt. postgres.js auto-parses
  // timestamptz to `Date` at runtime even though the type is `string | null`,
  // so we normalize both shapes to ISO 8601 then slice the first 10 chars.
  type DayBucket = { netPnl: Decimal; capitalSum: Decimal; capitalCount: number };
  const byDay = new Map<string, DayBucket>();
  for (const a of activities) {
    if (a.closedAt == null || a.netPnlUsd == null) continue;
    const pnl = Number(a.netPnlUsd);
    if (!Number.isFinite(pnl)) continue;
    const raw = a.closedAt as unknown;
    const iso = raw instanceof Date ? raw.toISOString() : (raw as string);
    const day = iso.slice(0, 10);
    const bucket = byDay.get(day) ?? {
      netPnl: new Decimal(0),
      capitalSum: new Decimal(0),
      capitalCount: 0,
    };
    bucket.netPnl = bucket.netPnl.plus(pnl);
    if (a.capitalDeployedUsd != null) {
      const cap = Number(a.capitalDeployedUsd);
      if (Number.isFinite(cap) && cap > 0) {
        bucket.capitalSum = bucket.capitalSum.plus(cap);
        bucket.capitalCount += 1;
      }
    }
    byDay.set(day, bucket);
  }

  const days = [...byDay.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );

  const sampleDays = days.length;
  if (sampleDays < MIN_SAMPLE_DAYS) {
    return {
      sharpe: 0,
      sortino: 0,
      meanDailyReturnPct: 0,
      stdevDailyReturnPct: 0,
      downsideStdevDailyReturnPct: 0,
      sampleDays,
      annualizationFactor: annualization,
      enoughData: false,
    };
  }

  // Establish starting equity. We use day-1's mean capitalDeployed as a
  // synthetic baseline, falling back to |day-1 pnl| if no capital info is
  // present. This keeps day-1's return finite.
  const day1 = days[0][1];
  let startingEquity =
    day1.capitalCount > 0
      ? day1.capitalSum.div(day1.capitalCount)
      : new Decimal(Math.abs(day1.netPnl.toNumber()));
  // Guard against zero-day-1 (no capital info AND netPnl == 0): use 1 to
  // avoid div-by-zero. Realistically this means the result is meaningless
  // for that single day, but the series still computes for the rest.
  if (startingEquity.lte(0)) startingEquity = new Decimal(1);

  // Walk the days, computing daily return as netPnl / equityAtStartOfDay.
  let runningEquity = startingEquity;
  const dailyReturns: number[] = [];
  for (const [, bucket] of days) {
    // Day's return = pnl / equity at start of day.
    const ret = bucket.netPnl.div(runningEquity).toNumber();
    dailyReturns.push(ret);
    runningEquity = runningEquity.plus(bucket.netPnl);
    // Guard against equity going negative or zero — clamp to a small positive
    // so subsequent returns don't explode. If a journal has truly blown up
    // past 0, downstream metrics are already meaningless.
    if (runningEquity.lte(0)) runningEquity = new Decimal(1);
  }

  // Mean and stddev of daily returns
  const mean = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length;
  // Sample (N-1) standard deviation — appropriate for an inferred population
  // mean. Matches what most stat libs and Excel's STDEV.S compute.
  const n = dailyReturns.length;
  let sumSq = 0;
  for (const r of dailyReturns) {
    const d = r - mean;
    sumSq += d * d;
  }
  const variance = n > 1 ? sumSq / (n - 1) : 0;
  const stdev = Math.sqrt(variance);

  // Downside deviation — same shape but only over returns that fell below the
  // risk-free rate (the convention; for rf=0 that's just negative returns).
  // Denominator stays N-1 over the full sample, not just the downside subset
  // (this is the Sortino convention — "asymmetric variance of the full
  // series", not "variance of the downside slice").
  let sumDownSq = 0;
  for (const r of dailyReturns) {
    if (r < dailyRiskFree) {
      const d = r - dailyRiskFree;
      sumDownSq += d * d;
    }
  }
  const downsideVariance = n > 1 ? sumDownSq / (n - 1) : 0;
  const downsideStdev = Math.sqrt(downsideVariance);

  const sqrtAnnual = Math.sqrt(annualization);
  const sharpe = stdev > 0 ? ((mean - dailyRiskFree) / stdev) * sqrtAnnual : 0;
  const sortino =
    downsideStdev > 0 ? ((mean - dailyRiskFree) / downsideStdev) * sqrtAnnual : 0;

  return {
    sharpe,
    sortino,
    meanDailyReturnPct: mean,
    stdevDailyReturnPct: stdev,
    downsideStdevDailyReturnPct: downsideStdev,
    sampleDays,
    annualizationFactor: annualization,
    enoughData: true,
  };
}
