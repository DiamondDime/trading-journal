import { requireUser } from "@/lib/auth/server";
import { getT, getLocale } from "@/lib/i18n/server";
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

function fmtSinceDate(iso: string | null, locale: "en" | "ru"): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
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
  const t = await getT();
  const locale = await getLocale();

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
          locale={locale}
        />
        <div className="mt-8">
          <AnalyticsEmptyState
            headline={t("analytics.trackRecord.empty.headline")}
            body={t("analytics.trackRecord.empty.body", { min: MIN_FOR_ANALYTICS })}
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
      label: t("analytics.trackRecord.metrics.profitFactor"),
      value: fmtRatio(more.profitFactor),
      caption: t("analytics.trackRecord.metricCaptions.profitFactor"),
      delta:
        more.profitFactor != null
          ? t("analytics.trackRecord.metricDeltas.avgWinLoss", { win: fmtUsd(more.avgWin), loss: fmtUsd(-more.avgLoss) })
          : t("analytics.trackRecord.metricDeltas.needsBoth"),
      tone:
        more.profitFactor == null
          ? "neutral"
          : more.profitFactor >= 1
          ? "up"
          : "down",
    },
    {
      label: t("analytics.trackRecord.metrics.payoffRatio"),
      value: fmtPayoff(more.payoffRatio),
      caption: t("analytics.trackRecord.metricCaptions.payoffRatio"),
      delta: more.payoffRatio != null
        ? t("analytics.trackRecord.metricDeltas.winLossSize")
        : t("analytics.trackRecord.metricDeltas.needsBoth"),
      tone:
        more.payoffRatio == null
          ? "neutral"
          : more.payoffRatio >= 1
          ? "up"
          : "down",
    },
    {
      label: t("analytics.trackRecord.metrics.expectancy"),
      value: fmtUsd(more.expectancy, true),
      caption: t("analytics.trackRecord.metricCaptions.expectancy"),
      delta: t("analytics.trackRecord.metricDeltas.overActivities", { count: closedRows.length }),
      tone: more.expectancy >= 0 ? "up" : "down",
    },
    {
      label: t("analytics.trackRecord.metrics.sqn"),
      value: fmtRatio(more.systemQualityNumber),
      caption: t("analytics.trackRecord.metricCaptions.sqn"),
      delta:
        more.systemQualityNumber == null
          ? t("analytics.trackRecord.metricDeltas.needsVariance")
          : t("analytics.trackRecord.metricDeltas.sqnFormula", { n: closedRows.length }),
      tone:
        more.systemQualityNumber == null
          ? "neutral"
          : more.systemQualityNumber >= 2
          ? "up"
          : "neutral",
    },
    {
      label: t("analytics.trackRecord.metrics.sharpe"),
      value: sharpe.enoughData ? sharpe.sharpe.toFixed(2) : "—",
      caption: t("analytics.trackRecord.metricCaptions.sharpe"),
      delta: sharpe.enoughData
        ? t("analytics.trackRecord.metricDeltas.sharpeReady", { days: sharpe.sampleDays, factor: sharpe.annualizationFactor })
        : t("analytics.trackRecord.metricDeltas.sharpeNeeds", { days: sharpe.sampleDays }),
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
      label: t("analytics.trackRecord.metrics.sortino"),
      value: sharpe.enoughData ? sharpe.sortino.toFixed(2) : "—",
      caption: t("analytics.trackRecord.metricCaptions.sortino"),
      delta: sharpe.enoughData
        ? t("analytics.trackRecord.metricDeltas.ddVol", { pct: (sharpe.downsideStdevDailyReturnPct * 100).toFixed(2) })
        : t("analytics.trackRecord.metricDeltas.sharpeNeeds", { days: sharpe.sampleDays }),
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
      label: t("analytics.trackRecord.metrics.longestWin"),
      value: fmtNumber(streaks.longestWinStreak),
      caption: t("analytics.trackRecord.metricCaptions.longestWin"),
      delta: t("analytics.trackRecord.metricDeltas.overActivities", { count: closedRows.length }),
      tone: streaks.longestWinStreak > 0 ? "up" : "neutral",
    },
    {
      label: t("analytics.trackRecord.metrics.longestLoss"),
      value: fmtNumber(streaks.longestLossStreak),
      caption: t("analytics.trackRecord.metricCaptions.longestLoss"),
      delta: t("analytics.trackRecord.metricDeltas.overActivities", { count: closedRows.length }),
      tone: streaks.longestLossStreak > 0 ? "down" : "neutral",
    },
    {
      label: t("analytics.trackRecord.metrics.currentStreak"),
      value:
        streaks.currentStreak.kind === "none"
          ? "—"
          : String(streaks.currentStreak.length),
      caption:
        streaks.currentStreak.kind === "win"
          ? t("analytics.trackRecord.metricCaptions.streakWin")
          : streaks.currentStreak.kind === "loss"
          ? t("analytics.trackRecord.metricCaptions.streakLoss")
          : t("analytics.trackRecord.metricCaptions.streakNone"),
      delta:
        streaks.currentStreak.kind === "win"
          ? t("analytics.trackRecord.metricDeltas.winsSince")
          : streaks.currentStreak.kind === "loss"
          ? t("analytics.trackRecord.metricDeltas.lossesSince")
          : t("analytics.trackRecord.metricDeltas.noStreak"),
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
    locale,
  );
  const lastCloseLabel = fmtSinceDate(
    (withCloseDate[withCloseDate.length - 1]?.closedAt as string | null) ?? null,
    locale,
  );

  return (
    <div className="px-8 py-10 lg:px-12">
      {/* ── Hero / amber headline ───────────────────────────────────────── */}
      <PageHero
        cumulativeNet={cumulativeNet}
        count={closedRows.length}
        firstClose={(withCloseDate[0]?.closedAt as string | null | undefined) ?? null}
        locale={locale}
      />

      <div className="mt-10 flex flex-col gap-8">
        {/* 1. Equity curve, full-width, 480px */}
        <SectionCard
          title={t("analytics.trackRecord.sections.equity")}
          caption={t("analytics.trackRecord.captions.equity")}
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
          title={t("analytics.trackRecord.sections.underwater")}
          caption={t("analytics.trackRecord.captions.underwater")}
          meta={
            drawdown.maxDrawdownUsd > 0
              ? t("analytics.trackRecord.meta.maxDrawdown", {
                  pct: (drawdown.maxDrawdownPct * 100).toFixed(1),
                  usd: fmtUsd(-drawdown.maxDrawdownUsd),
                })
              : t("analytics.trackRecord.meta.noDrawdown")
          }
        >
          <UnderwaterChart points={underwater} />
        </SectionCard>

        {/* 3. Monthly returns grid */}
        <SectionCard
          title={t("analytics.trackRecord.sections.monthly")}
          caption={t("analytics.trackRecord.captions.monthly")}
        >
          <MonthlyReturnsGrid rows={monthly} />
        </SectionCard>

        {/* 4. Rolling win rate */}
        <SectionCard
          title={t("analytics.trackRecord.sections.rollingTitle", { n: ROLLING_WIN_WINDOW })}
          caption={t("analytics.trackRecord.captions.rolling", { n: ROLLING_WIN_WINDOW })}
          meta={
            rolling.length > 0
              ? t("analytics.trackRecord.meta.latestWinRate", {
                  pct: ((rolling[rolling.length - 1]?.winRate ?? 0) * 100).toFixed(0),
                })
              : ""
          }
        >
          <RollingWinRateChart points={rolling} window={ROLLING_WIN_WINDOW} />
        </SectionCard>

        {/* 5. Hold time histogram */}
        <SectionCard
          title={t("analytics.trackRecord.sections.holdTime")}
          caption={t("analytics.trackRecord.captions.holdTime")}
        >
          <HoldTimeHistogram rows={holdBuckets} />
        </SectionCard>

        {/* 6. Top 10 best / worst */}
        <SectionCard
          title={t("analytics.trackRecord.sections.topBestWorst")}
          caption={t("analytics.trackRecord.captions.topBestWorst")}
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <TopTradesTable
              title={t("analytics.trackRecord.topBest")}
              tone="up"
              rows={topBest.map((b, i) => ({
                activity: bestActivities[i],
                rMultiple: b.rMultiple,
              }))}
            />
            <TopTradesTable
              title={t("analytics.trackRecord.topWorst")}
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
          title={t("analytics.trackRecord.sections.system")}
          caption={t("analytics.trackRecord.captions.system")}
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
async function PageHero({
  cumulativeNet,
  count,
  firstClose,
  locale,
}: {
  cumulativeNet: number;
  count: number;
  firstClose: string | null | undefined;
  locale: "en" | "ru";
}) {
  const t = await getT();
  const sinceLabel = firstClose
    ? new Date(firstClose).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
  const subtitle = count === 1
    ? t("analytics.trackRecord.heroSubtitleOne", { date: sinceLabel })
    : t("analytics.trackRecord.heroSubtitle", { date: sinceLabel, count });
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
        {t("analytics.nav.trackRecord")}
      </p>
      <AnalyticsHeadline
        label={t("analytics.trackRecord.heroLabel")}
        value={fmtUsd(cumulativeNet, true)}
        subtitle={subtitle}
      />
    </header>
  );
}
