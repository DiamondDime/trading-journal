import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getT, getLocale } from "@/lib/i18n/server";
import { KpiCard, defaultFontSize } from "@/components/spread/kpi-card";
import { CalendarHeatmap } from "@/components/spread/calendar-heatmap";
import {
  SpreadListCard,
  type SpreadListItem,
} from "@/components/spread/spread-list-card";
import {
  EquityCurveChart,
  type EquityPoint,
} from "@/components/spread/equity-curve-chart";
import {
  RDistributionChart,
  type RBarPoint,
} from "@/components/spread/r-distribution-chart";
import { FundingTicker } from "@/components/spread/funding-ticker";
import { NotesFeed } from "@/components/spread/notes-feed";
import { ActivityMix } from "@/components/spread/activity-mix";
import {
  fmtCapital,
  fmtUsd,
  type Activity,
} from "@/lib/data/archive-data";
import { requireUser } from "@/lib/auth/server";
import {
  getTotals,
  getActivityTypeCounts,
  getRecentCloses,
  listActivities,
  getDailyPnl,
  getAllClosedActivities,
  getConnectedExchangeCount,
} from "@/lib/db/activity";
import { getTagAggregations } from "@/lib/db/satellite";
import { TagPerformanceTable } from "@/components/spread/tag-performance-table";
import {
  computeDrawdown,
  computeStreaks,
  computeMoreMetrics,
  computeRDistribution,
} from "@/lib/analytics";
import { fetchSubtypeMetaForIds } from "@/lib/data/db-queries";
import { feedRowsToActivities } from "@/lib/data/db-adapter";
import { DashboardActions } from "@/components/spread/dashboard-actions";
import { HeatmapWindowToggle } from "@/components/spread/heatmap-window-toggle";
import {
  parseDashboardSearchParams,
  buildDashboardFilters,
  heatmapWeeks,
} from "@/lib/dashboard/filters";

// The dashboard reads the user's full feed once per render. With <1k
// activities for a single-user app this is fast (<10ms total across the
// aggregate queries). Force-dynamic keeps the data fresh post-wizard submit.
export const dynamic = "force-dynamic";

const RECENT_COUNT = 8;

// Local-time YYYY-MM-DD — used to align with getDailyPnl's date buckets which
// come back from Postgres as date strings in the server's TZ.
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Coerce a possibly-Date `closedAt` value to a YYYY-MM-DD string. postgres.js's
 * camelCase transform returns timestamptz columns as `Date` instances at
 * runtime, while the type declares them as `string` (an ISO-shape promise the
 * adapter normally fulfills). Analytics functions key off `closedAt.slice(...)`
 * so a raw Date would throw. Normalize before passing through.
 */
function ymdOf(closedAt: unknown): string | null {
  if (closedAt instanceof Date) {
    if (!Number.isFinite(closedAt.getTime())) return null;
    return closedAt.toISOString().slice(0, 10);
  }
  if (typeof closedAt === "string" && closedAt.length >= 10) {
    return closedAt.slice(0, 10);
  }
  return null;
}

/**
 * Walk the closed-activity feed in chronological order, bucketing per
 * calendar day. Each output point is one bucket with the running cumulative
 * equity + running peak + drawdown. Days without activity are omitted —
 * Recharts AreaChart interpolates between them linearly which gives the
 * curve a clean monotonic stair-step rather than a noisy zigzag.
 *
 * Decoupled from `computeDrawdown` because the analytics math library
 * returns aggregate scalars only; the chart needs the full point series.
 */
function buildEquityPoints(
  rows: { closedAt: string | null; netPnlUsd: string | null }[],
  intlLocale: string,
): EquityPoint[] {
  // Group by YYYY-MM-DD then sort chronologically. ISO string sort is stable
  // for date-only buckets.
  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const ymd = ymdOf(r.closedAt);
    if (!ymd || r.netPnlUsd == null) continue;
    const pnl = Number(r.netPnlUsd);
    if (!Number.isFinite(pnl)) continue;
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
    const label = new Date(`${ymd}T00:00:00`).toLocaleDateString(intlLocale, {
      month: "short",
      day: "numeric",
    });
    points.push({
      date: ymd,
      label,
      equity,
      peak,
      drawdownUsd: equity - peak,
    });
  }
  return points;
}

/**
 * Normalise `closedAt` on a feed row from Date → ISO string. The DB type says
 * `string | null` but postgres.js hands us `Date` at runtime. Analytics
 * helpers (and our own buildEquityPoints) call `.slice()` on it, so this
 * boundary coerces once before the math layer runs.
 */
function normalizeClosedAt<T extends { closedAt: unknown }>(
  rows: T[],
): T[] {
  return rows.map((r) => {
    if (r.closedAt instanceof Date) {
      return { ...r, closedAt: r.closedAt.toISOString() };
    }
    return r;
  });
}

// ── formatters for the second KPI row ─────────────────────────────────────

function fmtRatio(n: number | null, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}${suffix}`;
}

/** Payoff ratio is displayed as "1.4 : 1" per the brief. */
function fmtPayoff(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} : 1`;
}

function fmtPercent(n: number | null, mult100 = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = mult100 ? n * 100 : n;
  return `${v.toFixed(1)}%`;
}

function fmtExpectancy(n: number): string {
  // Expectancy can be ≪ 1 dollar; show 2 dp + signed prefix.
  return fmtUsd(n, true);
}

// R-distribution caption helpers — keep formatters tight + mono-friendly.
function fmtR(n: number, signed = true): string {
  if (!Number.isFinite(n)) return "—";
  const sign = signed ? (n >= 0 ? "+" : "−") : "";
  return `${sign}${Math.abs(n).toFixed(2)}R`;
}

// Next.js 16 hands `searchParams` as a Promise. The page awaits it once and
// then derives the canonical filter shape used by every DB call below.
interface SpreadsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SpreadsPage({ searchParams }: SpreadsPageProps) {
  const { id: userId } = await requireUser();
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";

  // Translated activity-type label (singular, lowercased) for delta lines.
  function activityTypeLower(type: Activity["type"]): string {
    switch (type) {
      case "spread":
        return t("spreadsList.activityTypeLower.spread");
      case "trade":
        return t("spreadsList.activityTypeLower.trade");
      case "sale":
        return t("spreadsList.activityTypeLower.sale");
      case "airdrop":
        return t("spreadsList.activityTypeLower.airdrop");
    }
  }

  // Translated spread-type label (singular, lowercased) for delta lines.
  function spreadTypeLower(spreadType: string): string {
    switch (spreadType) {
      case "cash_carry":
        return t("spreadsList.spreadTypeLower.cashCarry");
      case "calendar":
        return t("spreadsList.spreadTypeLower.calendar");
      case "funding":
        return t("spreadsList.spreadTypeLower.funding");
      case "cross_exchange":
        return t("spreadsList.spreadTypeLower.crossExchange");
      case "dex_cex":
        return t("spreadsList.spreadTypeLower.dexCex");
      default:
        return t("spreadsList.spreadTypeLower.cashCarry");
    }
  }

  // Build the "describe activity" suffix for the recent-closes grid.
  function describeActivity(a: Activity): string {
    switch (a.type) {
      case "spread":
        return `${a.variant} · ${a.venues}`;
      case "trade":
        return `${a.exchange} · ${a.instrument} · ${a.side}`;
      case "sale":
        return `${a.saleKind.toUpperCase()} · ${a.venue}`;
      case "airdrop":
        return `${a.protocol} · ${t("spreadsList.retroDrop")}`;
    }
  }

  // Build the "best/worst" subtitle for the KPI cards: serial + type + held.
  function bestDelta(a: Activity | null | undefined): string {
    if (!a) return "—";
    if (a.type === "spread") {
      return `${a.serial} · ${spreadTypeLower(a.spreadType)} · ${a.daysLabel}`;
    }
    return `${a.serial} · ${activityTypeLower(a.type)} · ${a.daysLabel}`;
  }

  const rawSearchParams = await searchParams;
  const dashParams = parseDashboardSearchParams(rawSearchParams);
  const filters = buildDashboardFilters(dashParams);

  // Heatmap window — 13/26/52 weeks. Default 13. The DB query sweeps the
  // wider window when the user has selected 26w/52w.
  const heatmapWeekCount = heatmapWeeks(dashParams.heatmap);

  // 13/26/52-week window ending today, in the server's local TZ. Day buckets are
  // YYYY-MM-DD strings — see getDailyPnl for the TZ caveat.
  const today = new Date();
  const heatmapEnd = ymdLocal(today);
  const heatmapStart = ymdLocal(
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - (heatmapWeekCount * 7 - 1),
    ),
  );

  // Parallel reads — independent aggregations + recent-closes window + full
  // closed-feed for the analytics block (KPIs, equity curve, R distribution).
  const [
    totals,
    typeCounts,
    recentRows,
    allRows,
    closedRows,
    dailyPnl,
    tagAggs,
    connectedExchangeCount,
  ] = await Promise.all([
    getTotals(userId, filters),
    getActivityTypeCounts(userId, filters),
    getRecentCloses(userId, RECENT_COUNT, filters),
    // listActivities is also used for the activity-mix card; we use the same
    // filter signature, but mapping closedAfter/Before → openedAfter/Before
    // because that's what listActivities exposes.
    listActivities(userId, {
      limit: 200,
      sortField: "closed_at",
      sortDir: "desc",
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.closedAfter ? { openedAfter: filters.closedAfter } : {}),
      ...(filters.closedBefore ? { openedBefore: filters.closedBefore } : {}),
    }),
    getAllClosedActivities(userId, filters),
    getDailyPnl(userId, heatmapStart, heatmapEnd, {
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.minCapital ? { minCapital: filters.minCapital } : {}),
    }),
    getTagAggregations(userId),
    getConnectedExchangeCount(userId),
  ]);

  const firstActivityYmd = totals.firstClose
    ? totals.firstClose.slice(0, 10)
    : null;

  // ── Analytics (Wave 9B-1 math, server-side computation) ───────────────────
  // The metrics module operates on the DB-shape rows directly so we don't
  // have to round-trip through the display adapter. closedAt comes back as
  // `Date` from postgres.js's camelCase transform — analytics expects ISO
  // strings (per ActivityFeedRowDb's type), so we coerce at this boundary.
  const closedNormalized = normalizeClosedAt(closedRows);
  const drawdown = computeDrawdown(closedNormalized);
  const streaks = computeStreaks(closedNormalized);
  const more = computeMoreMetrics(closedNormalized);
  // 1R = average loss (USD). When there are no losses, fall back to the
  // grand-average activity size so the histogram still has a sensible
  // unit; with rUnit=0 the R-distribution helper returns an empty result.
  const rUnit =
    more.avgLoss > 0
      ? more.avgLoss
      : closedNormalized.length > 0
        ? Math.max(
            1,
            Math.abs(
              closedNormalized.reduce(
                (s, r) => s + Number(r.netPnlUsd ?? 0),
                0,
              ),
            ) / closedNormalized.length,
          )
        : 0;
  // Cap the histogram domain at ±5R: a single 50R airdrop win would otherwise
  // produce 100 mostly-empty bins and squash the meaningful distribution into
  // a sliver. Overflow is preserved as "+5R+" / "-5R-" buckets on the ends.
  const R_DOMAIN = 5;
  const rDistRaw = computeRDistribution(closedNormalized, rUnit, 0.5);

  // Pre-built equity-curve points, ready to ship to the client wrapper.
  const equityPoints = buildEquityPoints(closedNormalized, intlLocale);
  const currentEquity =
    equityPoints.length > 0
      ? equityPoints[equityPoints.length - 1].equity
      : 0;
  const peakUsd = equityPoints.reduce((p, pt) => Math.max(p, pt.peak), 0);
  const currentDrawdownUsd = Math.max(0, peakUsd - currentEquity);

  // Compress the raw bins into the ±R_DOMAIN window. Bins below -R_DOMAIN
  // collapse into a single "-5R−" overflow bucket; bins ≥ +R_DOMAIN into a
  // "+5R+" bucket. Result is a readable categorical x-axis with the long
  // tail acknowledged but not given visual weight.
  const rBins: RBarPoint[] = (() => {
    const out: RBarPoint[] = [];
    // Underflow accumulator
    let underCount = 0;
    let overCount = 0;
    for (const b of rDistRaw.bins) {
      const centre = (b.rangeLow + b.rangeHigh) / 2;
      if (centre < -R_DOMAIN) {
        underCount += b.count;
        continue;
      }
      if (centre > R_DOMAIN) {
        overCount += b.count;
        continue;
      }
      out.push({
        rangeLow: b.rangeLow,
        rangeHigh: b.rangeHigh,
        count: b.count,
        label: fmtR(centre, true).replace(".00R", "R"),
      });
    }
    if (underCount > 0) {
      out.unshift({
        rangeLow: -Infinity,
        rangeHigh: -R_DOMAIN,
        count: underCount,
        label: `<−${R_DOMAIN}R`,
      });
    }
    if (overCount > 0) {
      out.push({
        rangeLow: R_DOMAIN,
        rangeHigh: Infinity,
        count: overCount,
        label: `>+${R_DOMAIN}R`,
      });
    }
    return out;
  })();

  // Subtype metadata for: best, worst, recent grid, and the full chart set.
  const allInteresting = [
    ...allRows,
    ...(totals.best ? [totals.best] : []),
    ...(totals.worst ? [totals.worst] : []),
  ];
  const meta = await fetchSubtypeMetaForIds(userId, allInteresting);

  const recentDisplays = feedRowsToActivities(recentRows, meta);
  const allDisplays = feedRowsToActivities(allRows, meta);
  const bestDisplay = totals.best ? feedRowsToActivities([totals.best], meta)[0] : null;
  const worstDisplay = totals.worst ? feedRowsToActivities([totals.worst], meta)[0] : null;

  const recentNetSum = recentRows.reduce((s, r) => s + Number(r.netPnlUsd ?? 0), 0);

  // Pull a venue string per row so the card can render exchange logos
  // beside the type label. Spreads carry "venues" already; trades give us
  // their single exchange; sale/airdrop have no venue logo (the venue is
  // a launchpad / OTC desk / protocol, not a tradable exchange).
  function venueOf(r: Activity): string | undefined {
    if (r.type === "spread") return r.venues;
    if (r.type === "trade") return r.exchange;
    return undefined;
  }

  const recentCloses: SpreadListItem[] = recentDisplays.map((r) => ({
    serial: r.serial,
    name: r.name,
    typeLabel: describeActivity(r),
    status: r.status,
    statusLabel: t(`status.${r.status}` as const),
    activityBadgeLabel: t(`spreadListCard.activityBadge.${r.type}` as const),
    headline: r.headlineLabel,
    headlineUnit: r.headlineKind,
    tone: r.tone,
    summary:
      r.type === "airdrop"
        ? `${r.daysLabel} · ${r.note || "—"}`
        : `${fmtCapital(r.capital)} · ${r.daysLabel} · ${r.note || "—"}`,
    href: r.href,
    activityType: r.type,
    venues: venueOf(r),
  }));

  // Friendly "since" date — use first close from totals if available.
  const sinceLabel = totals.firstClose
    ? new Date(totals.firstClose).toLocaleDateString(intlLocale, {
        month: "short", day: "numeric", year: "numeric",
      })
    : t("spreadsList.sinceToday");

  return (
    <div className="w-full">
      {/* ── hero strip ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-border px-8 py-7 md:flex-row md:items-end md:justify-between lg:px-12">
        <div>
          <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
            {t("dashboard.title")}
          </h1>
          <p className="mt-2 font-serif text-sm italic text-text-tertiary">
            {t("dashboard.summary", {
              count: totals.count,
              spread: typeCounts.spread,
              trade: typeCounts.trade,
              sale: typeCounts.sale,
              airdrop: typeCounts.airdrop,
              yieldPosition: typeCounts.yield_position,
              option: typeCounts.option,
              date: sinceLabel,
            })}
          </p>
        </div>

        <DashboardActions
          connectedExchangeCount={connectedExchangeCount}
          current={dashParams}
        />
      </header>

      <div className="px-8 py-8 lg:px-12">
        {/* ── KPI row · cross-activity cards (top, hero spans 2 cols) ──────
            Net P&L is the hero — gets 2 grid columns so long values like
            "+$1,234,567.89" fit cleanly without the font collapsing into a
            squint. 5 peer cards × 1 col = 5; 1 hero × 2 cols = 2; total 7
            units; grid is lg:grid-cols-7 to match. */}
        <section className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-7">
          <KpiCard
            variant="hero"
            label={t("dashboard.kpi.netPnlYtd")}
            value={fmtUsd(totals.net, true)}
            delta={t("dashboard.deltas.acrossActivities", { count: totals.count })}
          />
          <KpiCard
            label={t("dashboard.kpi.activitiesClosed")}
            value={`${totals.count}`}
            delta={t("dashboard.deltas.fourTypes")}
          />
          <KpiCard
            label={t("dashboard.kpi.winRate")}
            value={`${totals.winRate.toFixed(1)}%`}
            tone="up"
            delta={t("dashboard.deltas.winLossPair", {
              winners: totals.winners,
              losers: totals.losers,
            })}
          />
          <KpiCard
            label={t("dashboard.kpi.weightedReturn")}
            value={`${totals.weightedReturnPct.toFixed(1)}%`}
            tone={totals.weightedReturnPct >= 0 ? "up" : "down"}
            delta={t("dashboard.deltas.realizedCapWeighted")}
          />
          <KpiCard
            label={t("dashboard.kpi.bestActivity")}
            value={bestDisplay ? fmtUsd(bestDisplay.netPnl, true) : "—"}
            tone="up"
            delta={bestDelta(bestDisplay)}
          />
          <KpiCard
            label={t("dashboard.kpi.worstActivity")}
            value={worstDisplay ? fmtUsd(worstDisplay.netPnl, true) : "—"}
            tone="down"
            delta={bestDelta(worstDisplay)}
          />
        </section>

        {/* ── KPI row 2 · risk / quality metrics ─────────────────────────
            Each card carries a one-line italic-serif explanation so the
            number is self-evident without a glossary. No hero variant —
            the single amber moment lives upstairs. */}
        <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <KpiCardWithCaption
            label={t("dashboard.kpi.profitFactor")}
            value={fmtRatio(more.profitFactor)}
            caption={t("dashboard.captions.profitFactor")}
            delta={
              more.profitFactor != null
                ? t("dashboard.deltas.avgWinLoss", {
                    win: fmtUsd(more.avgWin),
                    loss: fmtUsd(-more.avgLoss),
                  })
                : t("dashboard.deltas.needsBoth")
            }
          />
          <KpiCardWithCaption
            label={t("dashboard.kpi.payoffRatio")}
            value={fmtPayoff(more.payoffRatio)}
            caption={t("dashboard.captions.payoffRatio")}
            delta={
              more.payoffRatio != null
                ? t("dashboard.deltas.winLossSize")
                : t("dashboard.deltas.needsBoth")
            }
          />
          <KpiCardWithCaption
            label={t("dashboard.kpi.expectancy")}
            value={fmtExpectancy(more.expectancy)}
            tone={more.expectancy >= 0 ? "up" : "down"}
            caption={t("dashboard.captions.expectancy")}
            delta={
              closedRows.length > 0
                ? t("dashboard.deltas.overActivities", { count: closedRows.length })
                : t("dashboard.deltas.noDataYet")
            }
          />
          <KpiCardWithCaption
            label={t("dashboard.kpi.maxDrawdown")}
            value={fmtPercent(drawdown.maxDrawdownPct)}
            tone="down"
            caption={t("dashboard.captions.maxDrawdown")}
            delta={
              drawdown.maxDrawdownUsd > 0
                ? t("dashboard.deltas.drawdownFrom", {
                    usd: fmtUsd(-drawdown.maxDrawdownUsd),
                    date: drawdown.peakAt
                      ? new Date(drawdown.peakAt).toLocaleDateString(intlLocale, {
                          month: "short",
                          day: "numeric",
                        })
                      : "—",
                  })
                : t("dashboard.deltas.noDrawdown")
            }
          />
          <KpiCardWithCaption
            label={t("dashboard.kpi.lossStreak")}
            value={
              closedRows.length > 0 ? String(streaks.longestLossStreak) : "—"
            }
            tone={streaks.longestLossStreak > 0 ? "down" : "neutral"}
            caption={t("dashboard.captions.lossStreak")}
            delta={
              streaks.currentStreak.kind === "loss" &&
              streaks.currentStreak.length > 0
                ? t("dashboard.deltas.streakNow", { count: streaks.currentStreak.length })
                : streaks.currentStreak.kind === "win"
                  ? t("dashboard.deltas.streakNowWins", { count: streaks.currentStreak.length })
                  : t("dashboard.deltas.streakNoStreak")
            }
          />
        </section>

        {/* ── partners callout · only when no exchanges connected ──────── */}
        {connectedExchangeCount === 0 && (
          <section className="mb-8">
            <div className="flex flex-col gap-4 rounded-md border border-border border-l-4 border-l-signature bg-surface px-6 py-5 md:flex-row md:items-center md:justify-between">
              <div className="flex-1">
                <h3 className="font-serif text-[14px] font-semibold text-text">
                  {t("partners.dashboardCallout.title")}
                </h3>
                <p className="mt-1 font-serif text-[12px] italic text-text-secondary">
                  {t("partners.dashboardCallout.body")}
                </p>
              </div>
              <Link
                href="/partners"
                className="inline-flex items-center gap-2 self-start rounded-md bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-opacity hover:opacity-90 md:self-auto"
              >
                {t("partners.dashboardCallout.cta")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </section>
        )}

        {/* ── heatmap + funding ticker ──────────────────────────────────── */}
        <section className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
          <div className="rounded-md border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                {t("dashboard.sections.dailyPnl", { weeks: heatmapWeekCount })}
              </h3>
              <HeatmapWindowToggle current={dashParams.heatmap} />
            </div>
            <div className="px-6 py-6">
              <CalendarHeatmap
                days={dailyPnl}
                endDate={heatmapEnd}
                firstActivityDate={firstActivityYmd}
                weeks={heatmapWeekCount}
              />
            </div>
          </div>

          <FundingTicker />
        </section>

        {/* ── recent closes grid ────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="font-serif text-[15px] font-semibold uppercase tracking-[0.16em] text-text">
                {t("dashboard.sections.recentCloses")}
              </h2>
              <span className="font-mono text-[11px] text-text-tertiary">
                {t("dashboard.sections.recentCount", {
                  n: recentRows.length,
                  total: totals.count,
                  pnl: fmtUsd(recentNetSum),
                })}
              </span>
            </div>
            <Link
              href="/spreads/archive"
              className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary hover:text-text"
            >
              {t("dashboard.archiveLink")} <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {recentCloses.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {recentCloses.map((item) => (
                <SpreadListCard key={item.serial} item={item} />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-surface py-12 text-center">
              <p className="font-serif text-base italic text-text-secondary">
                {t("dashboard.emptyRecent")}
              </p>
              <Link
                href="/add"
                className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary underline-offset-4 hover:text-text hover:underline"
              >
                {t("dashboard.emptyRecentCta")}
              </Link>
            </div>
          )}
        </section>

        {/* ── equity curve · running cumulative net P&L ─────────────────── */}
        <section className="mb-10 rounded-md border border-border bg-surface p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                {t("dashboard.sections.equity")}
              </h3>
              <p className="mt-1 font-serif text-[12px] italic text-text-tertiary">
                {t("dashboard.sections.equityCaption")}
              </p>
            </div>
            <span className="font-mono text-[11px] text-text-tertiary">
              {totals.firstClose
                ? `${new Date(totals.firstClose).toLocaleDateString(intlLocale, { month: "short", day: "numeric" })} → ${new Date(totals.lastClose ?? totals.firstClose).toLocaleDateString(intlLocale, { month: "short", day: "numeric", year: "numeric" })}`
                : "—"}
            </span>
          </div>
          <EquityCurveChart
            points={equityPoints}
            peakUsd={peakUsd}
            currentEquity={currentEquity}
            currentDrawdownUsd={currentDrawdownUsd}
          />
        </section>

        {/* ── R-multiple distribution ───────────────────────────────────── */}
        <section className="mb-10 rounded-md border border-border bg-surface p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                {t("dashboard.sections.rDist")}
              </h3>
              <p className="mt-1 font-serif text-[12px] italic text-text-tertiary">
                {rUnit > 0
                  ? t("dashboard.sections.rDistCaption", { value: fmtUsd(rUnit) })
                  : t("dashboard.sections.rDistCaptionNoUnit")}
              </p>
            </div>
            {rBins.length > 0 && (
              <span className="font-mono text-[11px] text-text-tertiary">
                {t("dashboard.sections.rDistStats", {
                  med: fmtR(rDistRaw.median),
                  mean: fmtR(rDistRaw.mean),
                  pos: rDistRaw.positiveCount,
                  neg: rDistRaw.negativeCount,
                })}
              </span>
            )}
          </div>
          <RDistributionChart bins={rBins} />
        </section>

        {/* ── performance by tag (Wave 10-2) ─────────────────────────────── */}
        <section className="mb-10 rounded-md border border-border bg-surface p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                {t("dashboard.sections.byTag")}
              </h3>
              <p className="mt-1 font-serif text-[12px] italic text-text-tertiary">
                {t("dashboard.sections.byTagCaption")}
              </p>
            </div>
            {tagAggs.length > 0 && (
              <span className="font-mono text-[11px] text-text-tertiary">
                {t.plural("spreadsList.distinctTags", tagAggs.length)}
              </span>
            )}
          </div>
          {tagAggs.length > 0 ? (
            <TagPerformanceTable rows={tagAggs} topN={10} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-inset py-10">
              <p className="font-serif text-sm italic text-text-secondary">
                {t("dashboard.sections.byTagEmpty")}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                {t("dashboard.sections.byTagHints")}
              </p>
            </div>
          )}
        </section>

        {/* ── notes feed + activity mix ─────────────────────────────────── */}
        <section className="mb-10 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.6fr]">
          <NotesFeed />
          <ActivityMix data={allDisplays} />
        </section>

        {/* ── footer ────────────────────────────────────────────────────── */}
        <footer className="mt-8 flex items-center justify-between border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          <span>{t("dashboard.footer", { since: sinceLabel })}</span>
          <span>
            {t.plural(
              "dashboard.footerRightParts.exchanges",
              connectedExchangeCount,
            )}
            {" · "}
            {t.plural("dashboard.footerRightParts.archived", totals.count)}
          </span>
        </footer>
      </div>
    </div>
  );
}

/**
 * Variant of KpiCard that injects an italic-serif explainer between the
 * value and the delta line. Localized here because the brief asks for it
 * on the analytics row only — promoting it into `KpiCard` proper would
 * require editorial decisions across every screen using the card.
 */
function KpiCardWithCaption({
  label,
  value,
  caption,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  caption: string;
  delta?: string;
  tone?: "up" | "down" | "neutral";
}) {
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface px-5 py-4 transition-colors hover:border-border-strong">
      <p className="font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </p>
      <p
        className={`mt-2 font-mono font-medium leading-none tabular-nums ${toneClass}`}
        style={{ fontSize: defaultFontSize(value) }}
      >
        {value}
      </p>
      <p className="mt-2 font-serif text-[11px] italic leading-tight text-text-tertiary">
        {caption}
      </p>
      {delta && (
        <p className="mt-1.5 font-mono text-[10px] tracking-wide text-text-tertiary">
          {delta}
        </p>
      )}
    </div>
  );
}
