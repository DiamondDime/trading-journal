/**
 * Unit tests for src/lib/analytics/{metrics,risk}.ts.
 *
 * Strategy: build small targeted activity fixtures using only the fields the
 * analytics helpers read (closedAt, netPnlUsd, capitalDeployedUsd). The full
 * ActivityFeedRowDb shape is wider; we cast through `as unknown as` since the
 * unused fields don't affect the math.
 *
 * Hand-computed expected values appear inline so future maintainers can
 * verify the math without re-deriving it.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDrawdown,
  computeStreaks,
  computeRDistribution,
  computeMoreMetrics,
  computeSharpeSortino,
} from '@/lib/analytics';
import type { ActivityFeedRowDb } from '@/lib/db/activity';

// Minimal builder — only the fields the analytics layer inspects. The rest of
// ActivityFeedRowDb is uninvolved in the math, so it stays unset.
function row(closedAt: string, netPnl: number, capital?: number): ActivityFeedRowDb {
  return {
    closedAt,
    netPnlUsd: String(netPnl),
    capitalDeployedUsd: capital == null ? null : String(capital),
  } as unknown as ActivityFeedRowDb;
}

// =============================================================================
// computeDrawdown
// =============================================================================

describe('computeDrawdown', () => {
  it('returns a zero-shaped result on empty input', () => {
    const r = computeDrawdown([]);
    expect(r).toEqual({
      maxDrawdownUsd: 0,
      maxDrawdownPct: 0,
      peakAt: null,
      troughAt: null,
      recoveredAt: null,
      currentDrawdownUsd: 0,
    });
  });

  it('handles the classic peak → trough → recovery scenario', () => {
    // Hand-computed equity walk:
    //   t1 +1000 → equity 1000, peak 1000 (peakAt=t1), dd=0
    //   t2  -300 → equity  700, peak 1000, dd=300
    //   t3  -200 → equity  500, peak 1000, dd=500   <- max drawdown
    //   t4  +600 → equity 1100, peak 1100 (peakAt=t4), dd=0  <- recovery
    //
    // maxDrawdownUsd = 500
    // peak-at-max-drawdown = 1000  → maxDrawdownPct = 0.5
    // peakAt   = t1 (the activity that set the peak we fell from)
    // troughAt = t3
    // recoveredAt = t4 (first time after trough equity >= 1000)
    // currentDrawdownUsd = 1100 - 1100 = 0
    const acts = [
      row('2026-05-01T10:00:00Z', 1000),
      row('2026-05-02T10:00:00Z', -300),
      row('2026-05-03T10:00:00Z', -200),
      row('2026-05-04T10:00:00Z', 600),
    ];
    const r = computeDrawdown(acts);
    expect(r.maxDrawdownUsd).toBeCloseTo(500, 6);
    expect(r.maxDrawdownPct).toBeCloseTo(0.5, 6);
    expect(r.peakAt).toBe('2026-05-01T10:00:00Z');
    expect(r.troughAt).toBe('2026-05-03T10:00:00Z');
    expect(r.recoveredAt).toBe('2026-05-04T10:00:00Z');
    expect(r.currentDrawdownUsd).toBeCloseTo(0, 6);
  });

  it('reports no recovery when equity never returns to peak', () => {
    // Peak is set at +500, then we draw down and never recover.
    //   t1 +500 → equity 500, peak 500
    //   t2 -300 → equity 200, peak 500, dd=300  <- max DD
    //   t3 +100 → equity 300, peak 500, dd=200  (still below 500)
    const acts = [
      row('2026-05-01T10:00:00Z', 500),
      row('2026-05-02T10:00:00Z', -300),
      row('2026-05-03T10:00:00Z', 100),
    ];
    const r = computeDrawdown(acts);
    expect(r.maxDrawdownUsd).toBeCloseTo(300, 6);
    expect(r.peakAt).toBe('2026-05-01T10:00:00Z');
    expect(r.troughAt).toBe('2026-05-02T10:00:00Z');
    expect(r.recoveredAt).toBeNull(); // still under
    expect(r.currentDrawdownUsd).toBeCloseTo(200, 6); // 500 - 300
  });

  it('handles the all-losses (peak = 0) edge case', () => {
    // Peak stays at the initial 0 — no activity ever surpasses start.
    // maxDrawdownPct should be 0 (peak=0 ratio undefined), peakAt null.
    const acts = [
      row('2026-05-01T10:00:00Z', -100),
      row('2026-05-02T10:00:00Z', -50),
    ];
    const r = computeDrawdown(acts);
    expect(r.maxDrawdownUsd).toBeCloseTo(150, 6);
    expect(r.maxDrawdownPct).toBe(0); // peak-was-0 guard
    expect(r.peakAt).toBeNull(); // initial state has no closedAt
    expect(r.troughAt).toBe('2026-05-02T10:00:00Z');
    expect(r.recoveredAt).toBeNull();
    expect(r.currentDrawdownUsd).toBeCloseTo(150, 6);
  });

  it('returns zero drawdown when every activity is a win', () => {
    const acts = [
      row('2026-05-01T10:00:00Z', 100),
      row('2026-05-02T10:00:00Z', 50),
      row('2026-05-03T10:00:00Z', 200),
    ];
    const r = computeDrawdown(acts);
    expect(r.maxDrawdownUsd).toBe(0);
    expect(r.maxDrawdownPct).toBe(0);
    expect(r.peakAt).toBeNull();
    expect(r.troughAt).toBeNull();
    expect(r.recoveredAt).toBeNull();
    expect(r.currentDrawdownUsd).toBe(0);
  });

  it('re-sorts unordered input by closedAt', () => {
    // Same activities as the "peak/trough/recovery" test, shuffled.
    const acts = [
      row('2026-05-04T10:00:00Z', 600),
      row('2026-05-01T10:00:00Z', 1000),
      row('2026-05-03T10:00:00Z', -200),
      row('2026-05-02T10:00:00Z', -300),
    ];
    const r = computeDrawdown(acts);
    expect(r.maxDrawdownUsd).toBeCloseTo(500, 6);
    expect(r.recoveredAt).toBe('2026-05-04T10:00:00Z');
  });
});

// =============================================================================
// computeStreaks
// =============================================================================

describe('computeStreaks', () => {
  it('returns zero-shaped result on empty input', () => {
    expect(computeStreaks([])).toEqual({
      longestWinStreak: 0,
      longestLossStreak: 0,
      currentStreak: { kind: 'none', length: 0 },
    });
  });

  it('tracks longest streaks and current streak across a mixed series', () => {
    // Series: W W L W W W L L
    //  longestWinStreak  = 3
    //  longestLossStreak = 2
    //  currentStreak     = { kind: 'loss', length: 2 }
    const acts = [
      row('2026-05-01T10:00:00Z', 50),
      row('2026-05-02T10:00:00Z', 30),
      row('2026-05-03T10:00:00Z', -20),
      row('2026-05-04T10:00:00Z', 10),
      row('2026-05-05T10:00:00Z', 25),
      row('2026-05-06T10:00:00Z', 40),
      row('2026-05-07T10:00:00Z', -15),
      row('2026-05-08T10:00:00Z', -35),
    ];
    const r = computeStreaks(acts);
    expect(r.longestWinStreak).toBe(3);
    expect(r.longestLossStreak).toBe(2);
    expect(r.currentStreak).toEqual({ kind: 'loss', length: 2 });
  });

  it('treats exact-zero PnL as a streak-break', () => {
    // W W 0 W → longest win = 2, current = win 1 (the 0 broke the streak).
    const acts = [
      row('2026-05-01T10:00:00Z', 50),
      row('2026-05-02T10:00:00Z', 30),
      row('2026-05-03T10:00:00Z', 0),
      row('2026-05-04T10:00:00Z', 10),
    ];
    const r = computeStreaks(acts);
    expect(r.longestWinStreak).toBe(2);
    expect(r.currentStreak).toEqual({ kind: 'win', length: 1 });
  });
});

// =============================================================================
// computeRDistribution
// =============================================================================

describe('computeRDistribution', () => {
  it('returns empty bins on empty input', () => {
    const r = computeRDistribution([], 100);
    expect(r.bins).toEqual([]);
    expect(r.mean).toBe(0);
    expect(r.median).toBe(0);
  });

  it('histograms an R series with binWidth=0.5R', () => {
    // rUnit=100, pnls=[+150,-100,+50,-200,+100]
    //   R values: [1.5, -1.0, 0.5, -2.0, 1.0]
    //   min=-2.0, max=1.5 → bins span -2.0 to 1.5 in 0.5-wide slices
    //   7 bins: [-2,-1.5), [-1.5,-1.0), [-1.0,-0.5), [-0.5,0), [0,0.5), [0.5,1.0), [1.0,1.5]
    //   counts: 1, 0, 1, 0, 0, 1, 2
    //   mean = 0.0, median = 0.5 (sorted middle)
    //   positiveCount = 3, negativeCount = 2
    const acts = [
      row('2026-05-01T10:00:00Z', 150),
      row('2026-05-02T10:00:00Z', -100),
      row('2026-05-03T10:00:00Z', 50),
      row('2026-05-04T10:00:00Z', -200),
      row('2026-05-05T10:00:00Z', 100),
    ];
    const r = computeRDistribution(acts, 100, 0.5);
    expect(r.bins).toHaveLength(7);
    expect(r.bins.map((b) => b.count)).toEqual([1, 0, 1, 0, 0, 1, 2]);
    expect(r.mean).toBeCloseTo(0.0, 6);
    expect(r.median).toBeCloseTo(0.5, 6);
    expect(r.positiveCount).toBe(3);
    expect(r.negativeCount).toBe(2);
    // Bin labels are clean ("0.5R to 1.0R" etc).
    expect(r.bins[5].label).toBe('0.5R to 1.0R');
  });

  it('bails to empty result when rUnit <= 0', () => {
    // A 0 or negative rUnit makes R values nonsensical — we return empty.
    const acts = [row('2026-05-01T10:00:00Z', 100)];
    const r = computeRDistribution(acts, 0);
    expect(r.bins).toEqual([]);
  });
});

// =============================================================================
// computeMoreMetrics
// =============================================================================

describe('computeMoreMetrics', () => {
  it('returns zero-shaped result with null ratios on empty input', () => {
    const r = computeMoreMetrics([]);
    expect(r.profitFactor).toBeNull();
    expect(r.payoffRatio).toBeNull();
    expect(r.expectancy).toBe(0);
    expect(r.systemQualityNumber).toBeNull();
  });

  it('computes profit factor, payoff ratio, expectancy, and SQN', () => {
    // pnls = [+100, +50, -30, -70, +20]
    //   grossWins  = 170, grossLosses = 100, winCount=3, lossCount=2
    //   avgWin     = 170/3 ≈ 56.6667
    //   avgLoss    = 100/2 = 50
    //   largestWin = 100, largestLoss = -70
    //   expectancy = (100+50-30-70+20)/5 = 70/5 = 14
    //   profitFactor = 170/100 = 1.7
    //   payoffRatio  = 56.6667 / 50 = 1.13333
    //   variance (population): mean=14, deviations=[86,36,-44,-84,6]
    //     sqsum = 7396+1296+1936+7056+36 = 17720; var = 17720/5 = 3544
    //     stddev ≈ 59.5315
    //   SQN = 14 / 59.5315 * sqrt(5) ≈ 0.2352 * 2.2361 ≈ 0.5260
    const acts = [
      row('2026-05-01T10:00:00Z', 100),
      row('2026-05-02T10:00:00Z', 50),
      row('2026-05-03T10:00:00Z', -30),
      row('2026-05-04T10:00:00Z', -70),
      row('2026-05-05T10:00:00Z', 20),
    ];
    const r = computeMoreMetrics(acts);
    expect(r.profitFactor).toBeCloseTo(1.7, 6);
    expect(r.payoffRatio).toBeCloseTo(170 / 3 / 50, 6);
    expect(r.expectancy).toBeCloseTo(14, 6);
    expect(r.avgWin).toBeCloseTo(170 / 3, 6);
    expect(r.avgLoss).toBeCloseTo(50, 6);
    expect(r.largestWin).toBeCloseTo(100, 6);
    expect(r.largestLoss).toBeCloseTo(-70, 6);
    expect(r.systemQualityNumber).not.toBeNull();
    expect(r.systemQualityNumber!).toBeCloseTo(0.5260, 3);
  });

  it('returns null ratios when one side has no entries', () => {
    // All wins: profitFactor undefined (no losses), payoff undefined.
    const acts = [
      row('2026-05-01T10:00:00Z', 100),
      row('2026-05-02T10:00:00Z', 50),
    ];
    const r = computeMoreMetrics(acts);
    expect(r.profitFactor).toBeNull();
    expect(r.payoffRatio).toBeNull();
    expect(r.expectancy).toBeCloseTo(75, 6);
    expect(r.avgLoss).toBe(0);
  });
});

// =============================================================================
// computeSharpeSortino
// =============================================================================

describe('computeSharpeSortino', () => {
  it('flags insufficient data when sample < 7 days', () => {
    const acts = [
      row('2026-05-01T10:00:00Z', 100, 10000),
      row('2026-05-02T10:00:00Z', 50, 10000),
    ];
    const r = computeSharpeSortino(acts);
    expect(r.enoughData).toBe(false);
    expect(r.sharpe).toBe(0);
    expect(r.sampleDays).toBe(2);
  });

  it('annualizes Sharpe & Sortino over a 10-day synthetic series', () => {
    // 10 days, capitalDeployed=10000 on day 1 (sets the starting equity),
    // varied netPnls. Daily returns are computed via time-weighted-return
    // (each day's pnl / equity at start of that day). We assert:
    //   • enoughData is true (10 >= 7 minimum sample)
    //   • meanDailyReturnPct > 0 (the series is net positive)
    //   • sharpe > 0 (positive risk-adjusted return)
    //   • sortino >= sharpe (Sortino's downside-only stddev is <= total stddev
    //     so the ratio is at least as large)
    //   • annualizationFactor defaults to 365 (crypto convention)
    //
    // The exact value of Sharpe depends on the daily-return path; we verify
    // the mean of dailyReturns hand-computed inside the test to lock in the
    // time-weighted-return semantics.
    const pnls = [100, 50, -200, 150, 80, -50, 120, -100, 60, 90];
    const acts = pnls.map((p, i) =>
      row(`2026-05-${String(i + 1).padStart(2, '0')}T10:00:00Z`, p, i === 0 ? 10000 : undefined),
    );

    const r = computeSharpeSortino(acts);
    expect(r.enoughData).toBe(true);
    expect(r.sampleDays).toBe(10);
    expect(r.annualizationFactor).toBe(365);
    expect(r.sharpe).toBeGreaterThan(0);
    // Sortino uses only downside deviation in the denominator → for a net-
    // positive series, |downsideStdev| <= |stdev|, so Sortino >= Sharpe.
    expect(r.sortino).toBeGreaterThanOrEqual(r.sharpe - 1e-9);

    // Reconstruct the daily-return path inline so the test fails loudly if
    // we ever change the time-weighted-return convention.
    let equity = 10000;
    const dailyReturns: number[] = [];
    for (const p of pnls) {
      dailyReturns.push(p / equity);
      equity += p;
    }
    const meanExpected =
      dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length;
    expect(r.meanDailyReturnPct).toBeCloseTo(meanExpected, 6);
  });

  it('respects a custom annualization factor and risk-free rate', () => {
    // Same series as above, but annualize over 252 (stock convention) and
    // apply a 4% annual risk-free rate. Result should differ — and Sharpe
    // should be smaller (risk-free baseline raises the hurdle).
    const pnls = [100, 50, -200, 150, 80, -50, 120, -100, 60, 90];
    const acts = pnls.map((p, i) =>
      row(`2026-05-${String(i + 1).padStart(2, '0')}T10:00:00Z`, p, i === 0 ? 10000 : undefined),
    );

    const base = computeSharpeSortino(acts);
    const adjusted = computeSharpeSortino(acts, {
      annualizationFactor: 252,
      riskFreeRate: 0.04,
    });

    expect(adjusted.annualizationFactor).toBe(252);
    expect(adjusted.sharpe).toBeLessThan(base.sharpe); // hurdle raised
  });
});
