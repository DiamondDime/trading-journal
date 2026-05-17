import { requireUser } from "@/lib/auth/server";
import {
  getAllClosedActivities,
  getMonthlyPnl,
  getHoldTimeBuckets,
  type ActivityFeedRowDb,
} from "@/lib/db/activity";
import { fetchSubtypeMetaForIds } from "@/lib/data/db-queries";
import { feedRowsToActivities } from "@/lib/data/db-adapter";
import {
  computeDrawdown,
  computeStreaks,
  computeMoreMetrics,
  computeSharpeSortino,
  buildEquityPoints,
  buildUnderwaterPoints,
  buildRollingWinRate,
  pickTopBestWorst,
  computeCumulativeNet,
} from "@/lib/analytics";
import { fmtUsd } from "@/lib/data/archive-data";

import { AnalyticsHeadline } from "@/components/analytics/analytics-headline";
import { SectionCard } from "@/components/analytics/section-card";
import { EquityCurveLarge } from "@/components/analytics/equity-curve-large";
import { UnderwaterChart } from "@/components/analytics/underwater-chart";
import { MonthlyReturnsGrid } from "@/components/analytics/monthly-returns-grid";
import { RollingWinRateChart } from "@/components/analytics/rolling-win-rate-chart";
import { HoldTimeHistogram } from "@/components/analytics/hold-time-histogram";
import { TopTradesTable } from "@/components/analytics/top-trades-table";
import { SystemMetricsGrid, type SystemMetric } from "@/components/analytics/system-metrics-grid";
import { LastUpdatedFooter } from "@/components/analytics/last-updated";
import { AnalyticsEmptyState, MIN_FOR_ANALYTICS } from "@/components/analytics/empty-state";

/**
 * Track Record — the trader's edge laid bare in seven sections:
 *
 *   1. Equity curve (480px)         — running cumulative net P&L
 *   2. Underwater drawdown chart    — drawdown % over time (zero on top)
 *   3. Monthly returns grid         — years × months pivot
 *   4. Rolling win rate             — sliding window of priors
 *   5. Hold time histogram          — count + avg P&L per band
 *   6. Top 10 best / worst trades   — clickable rows
 *   7. System metrics card grid     — profit factor, payoff, expectancy,
 *                                     SQN, Sharpe, Sortino, streaks
 *
 * Everything is computed server-side. Data is force-dynamic to keep the
 * page fresh after wizard submits.
 */
export const dynamic = "force-dynamic";

const ROLLING_WIN_WINDOW = 20;
const TOP_N = 10;

function normalizeClosedAt<T extends { closedAt: unknown }>(rows: T[]): T[] {
  return rows.map((r) =>
    r.closedAt instanceof Date ? { ...r, closedAt: r.closedAt.toISOString() } : r,
  );
}

function fmtSinceDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtRatio(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtPayoff(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} : 1`;
}

function fmtNumber(n: number): string {
  return String(n);
}

export default async function TrackRecordPage() {
  const { id: userId } = await requireUser();

  // Parallel reads — one full closed feed (drives 6 of 7 sections) + the
  // monthly pivot + hold-time buckets.
  const [closedRowsRaw, monthly, holdBuckets] = await Promise.all([
    getAllClosedActivities(userId),
    getMonthlyPnl(userId),
    getHoldTimeBuckets(userId),
  ]);

  const closedRows = normalizeClosedAt(closedRowsRaw);

  // Insufficient-data short-circuit. Everything renders even with 1 activity
  // but the metrics aren't meaningful — surface the friendly empty state.
  if (closedRows.length < MIN_FOR_ANALYTICS) {
    const earlyFirst = closedRows.find((r) => r.closedAt != null);
    return (
      <div className="px-8 py-10 lg:px-12">
        <PageHero
          cumulativeNet={computeCumulativeNet(closedRows)}
          count={closedRows.length}
          firstClose={(earlyFirst?.closedAt as string | null | undefined) ?? null}
        />
        <div className="mt-8">
          <AnalyticsEmptyState
            headline="Track record needs more data."
            body={`Log at least ${MIN_FOR_ANALYTICS} activities to see meaningful drawdown, edge, and consistency metrics.`}
            current={closedRows.length}
          />
        </div>
        <LastUpdatedFooter />
      </div>
    );
  }

  // ── Analytics math ──────────────────────────────────────────────────────
  const drawdown = computeDrawdown(closedRows);
  const streaks = computeStreaks(closedRows);
  const more = computeMoreMetrics(closedRows);
  const sharpe = computeSharpeSortino(closedRows);

  // 1R = average loss (USD). When there are no losses, fall back to the
  // grand-average activity P&L magnitude (same convention as the dashboard).
  const rUnit =
    more.avgLoss > 0
      ? more.avgLoss
      : closedRows.length > 0
        ? Math.max(
            1,
            Math.abs(
              closedRows.reduce(
                (s, r) => s + Number(r.netPnlUsd ?? 0),
                0,
              ),
            ) / closedRows.length,
          )
        : 0;

  const equityPoints = buildEquityPoints(closedRows);
  const peakUsd = equityPoints.reduce((p, pt) => Math.max(p, pt.peak), 0);
  const currentEquity =
    equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].equity : 0;
  const currentDrawdownUsd = Math.max(0, peakUsd - currentEquity);
  const cumulativeNet = currentEquity;

  const underwater = buildUnderwaterPoints(closedRows);
  const rolling = buildRollingWinRate(closedRows, ROLLING_WIN_WINDOW);
  const { best: topBest, worst: topWorst } = pickTopBestWorst(
    closedRows,
    TOP_N,
    rUnit,
  );

  // Adapt the best/worst slices into display Activity rows. We need subtype
  // metadata so the type badge labels render correctly — fetch once for the
  // union set.
  const interesting: ActivityFeedRowDb[] = [
    ...topBest.map((b) => b.row),
    ...topWorst.map((w) => w.row),
  ];
  const meta = await fetchSubtypeMetaForIds(userId, interesting);
  const bestActivities = feedRowsToActivities(topBest.map((b) => b.row), meta);
  const worstActivities = feedRowsToActivities(topWorst.map((w) => w.row), meta);

  // ── System metrics card grid (9 cards) ──────────────────────────────────
  const systemMetrics: SystemMetric[] = [
    {
      label: "Profit factor",
      value: fmtRatio(more.profitFactor),
      caption: "Gross wins ÷ gross losses. Above 1.5 is healthy.",
      delta:
        more.profitFactor != null
          ? `${fmtUsd(more.avgWin)} avg win · ${fmtUsd(-more.avgLoss)} avg loss`
          : "needs both wins + losses",
      tone:
        more.profitFactor == null
          ? "neutral"
          : more.profitFactor >= 1
          ? "up"
          : "down",
    },
    {
      label: "Payoff ratio",
      value: fmtPayoff(more.payoffRatio),
      caption: "Average win size relative to average loss.",
      delta: more.payoffRatio != null ? "win-size : loss-size" : "needs both wins + losses",
      tone:
        more.payoffRatio == null
          ? "neutral"
          : more.payoffRatio >= 1
          ? "up"
          : "down",
    },
    {
      label: "Expectancy",
      value: fmtUsd(more.expectancy, true),
      caption: "Average dollar P&L per activity, all-in.",
      delta: `over ${closedRows.length} closed activities`,
      tone: more.expectancy >= 0 ? "up" : "down",
    },
    {
      label: "SQN",
      value: fmtRatio(more.systemQualityNumber),
      caption: "Van Tharp System Quality. Above 2.0 is good.",
      delta:
        more.systemQualityNumber == null
          ? "needs variance + ≥ 2 trades"
          : `pop. stddev · √${closedRows.length}`,
      tone:
        more.systemQualityNumber == null
          ? "neutral"
          : more.systemQualityNumber >= 2
          ? "up"
          : "neutral",
    },
    {
      label: "Sharpe",
      value: sharpe.enoughData ? sharpe.sharpe.toFixed(2) : "—",
      caption: "Risk-adjusted return, annualized.",
      delta: sharpe.enoughData
        ? `${sharpe.sampleDays} active days · ann. ${sharpe.annualizationFactor}d`
        : `needs ≥7 active days (${sharpe.sampleDays})`,
      tone:
        !sharpe.enoughData
          ? "neutral"
          : sharpe.sharpe >= 1
          ? "up"
          : sharpe.sharpe < 0
          ? "down"
          : "neutral",
    },
    {
      label: "Sortino",
      value: sharpe.enoughData ? sharpe.sortino.toFixed(2) : "—",
      caption: "Like Sharpe but penalises only downside variance.",
      delta: sharpe.enoughData
        ? `dd-vol ${(sharpe.downsideStdevDailyReturnPct * 100).toFixed(2)}%`
        : `needs ≥7 active days (${sharpe.sampleDays})`,
      tone:
        !sharpe.enoughData
          ? "neutral"
          : sharpe.sortino >= 1
          ? "up"
          : sharpe.sortino < 0
          ? "down"
          : "neutral",
    },
    {
      label: "Longest win streak",
      value: fmtNumber(streaks.longestWinStreak),
      caption: "Consecutive winners — your hot hand.",
      delta: `over ${closedRows.length} closed activities`,
      tone: streaks.longestWinStreak > 0 ? "up" : "neutral",
    },
    {
      label: "Longest loss streak",
      value: fmtNumber(streaks.longestLossStreak),
      caption: "Consecutive losers — your worst tilt risk.",
      delta: `over ${closedRows.length} closed activities`,
      tone: streaks.longestLossStreak > 0 ? "down" : "neutral",
    },
    {
      label: "Current streak",
      value:
        streaks.currentStreak.kind === "none"
          ? "—"
          : String(streaks.currentStreak.length),
      caption:
        streaks.currentStreak.kind === "win"
          ? "Running win streak. Don't ruin it."
          : streaks.currentStreak.kind === "loss"
          ? "Running loss streak. Mind your sizing."
          : "Last activity was flat — no streak active.",
      delta:
        streaks.currentStreak.kind === "win"
          ? "wins · since last loss"
          : streaks.currentStreak.kind === "loss"
          ? "losses · since last win"
          : "no streak active",
      tone:
        streaks.currentStreak.kind === "win"
          ? "up"
          : streaks.currentStreak.kind === "loss"
          ? "down"
          : "neutral",
    },
  ];

  // closedRows can contain rows with null closedAt (e.g. vesting status), and
  // listActivities sorts NULLS LAST so the tail of the array may be null. Pick
  // the first and last rows with a non-null closedAt for the equity-curve meta.
  const withCloseDate = closedRows.filter((r) => r.closedAt != null);
  const firstCloseLabel = fmtSinceDate(
    (withCloseDate[0]?.closedAt as string | null) ?? null,
  );
  const lastCloseLabel = fmtSinceDate(
    (withCloseDate[withCloseDate.length - 1]?.closedAt as string | null) ?? null,
  );

  return (
    <div className="px-8 py-10 lg:px-12">
      {/* ── Hero / amber headline ───────────────────────────────────────── */}
      <PageHero
        cumulativeNet={cumulativeNet}
        count={closedRows.length}
        firstClose={(withCloseDate[0]?.closedAt as string | null | undefined) ?? null}
      />

      <div className="mt-10 flex flex-col gap-8">
        {/* 1. Equity curve, full-width, 480px */}
        <SectionCard
          title="Equity curve · cumulative realized"
          caption="Running sum of net P&L across every closed activity. Dotted line is the all-time high; vertical mark shows the current drawdown from peak."
          meta={`${firstCloseLabel} → ${lastCloseLabel}`}
        >
          <EquityCurveLarge
            points={equityPoints}
            peakUsd={peakUsd}
            currentEquity={currentEquity}
            currentDrawdownUsd={currentDrawdownUsd}
          />
        </SectionCard>

        {/* 2. Underwater drawdown chart */}
        <SectionCard
          title="Underwater drawdown"
          caption="How far below the all-time high you've been. The deeper the curve dips, the longer the recovery."
          meta={
            drawdown.maxDrawdownUsd > 0
              ? `Max ${(drawdown.maxDrawdownPct * 100).toFixed(1)}% · ${fmtUsd(-drawdown.maxDrawdownUsd)}`
              : "no drawdown yet"
          }
        >
          <UnderwaterChart points={underwater} />
        </SectionCard>

        {/* 3. Monthly returns grid */}
        <SectionCard
          title="Monthly returns"
          caption="Realized net P&L per month, colored by sign and intensity. Year totals on the right."
          meta={`${monthly.length} ${monthly.length === 1 ? "month" : "months"}`}
        >
          <MonthlyReturnsGrid rows={monthly} />
        </SectionCard>

        {/* 4. Rolling win rate */}
        <SectionCard
          title={`Rolling win rate · window ${ROLLING_WIN_WINDOW}`}
          caption={`Win rate over the prior ${ROLLING_WIN_WINDOW} activities, plotted as a sliding window. Spot recent edge erosion at a glance.`}
          meta={
            rolling.length > 0
              ? `latest ${((rolling[rolling.length - 1]?.winRate ?? 0) * 100).toFixed(0)}%`
              : ""
          }
        >
          <RollingWinRateChart points={rolling} window={ROLLING_WIN_WINDOW} />
        </SectionCard>

        {/* 5. Hold time histogram */}
        <SectionCard
          title="Hold time distribution"
          caption="Activity count per holding-period band (bars) and the average net P&L within each band (line). Patient money or scalp money?"
        >
          <HoldTimeHistogram rows={holdBuckets} />
        </SectionCard>

        {/* 6. Top 10 best / worst */}
        <SectionCard
          title="Top 10 best · top 10 worst"
          caption="Click any row to jump to its detail page. R-multiples are versus your average loss."
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <TopTradesTable
              title="Top 10 best"
              tone="up"
              rows={topBest.map((b, i) => ({
                activity: bestActivities[i],
                rMultiple: b.rMultiple,
              }))}
            />
            <TopTradesTable
              title="Top 10 worst"
              tone="down"
              rows={topWorst.map((w, i) => ({
                activity: worstActivities[i],
                rMultiple: w.rMultiple,
              }))}
            />
          </div>
        </SectionCard>

        {/* 7. System metrics */}
        <SectionCard
          title="System metrics"
          caption="Where your edge gets quantified. Each metric answers a different question about your trading system's quality."
        >
          <SystemMetricsGrid metrics={systemMetrics} />
        </SectionCard>
      </div>

      <LastUpdatedFooter />
    </div>
  );
}

/**
 * Page hero — extracted so we can render it inside both the empty-state path
 * and the full path with a single source of truth.
 */
function PageHero({
  cumulativeNet,
  count,
  firstClose,
}: {
  cumulativeNet: number;
  count: number;
  firstClose: string | null | undefined;
}) {
  const sinceLabel = firstClose
    ? new Date(firstClose).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
        Track record
      </p>
      <AnalyticsHeadline
        label="Cumulative net P&L"
        value={fmtUsd(cumulativeNet, true)}
        subtitle={`Since ${sinceLabel} · ${count} ${count === 1 ? "activity" : "activities"}`}
      />
    </header>
  );
}
