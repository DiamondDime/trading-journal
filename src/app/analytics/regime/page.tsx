import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import {
  getRegimeAggregations,
  getUntaggedRegimeCount,
  getTotals,
  type RegimeAggRow,
} from "@/lib/db/activity";
import { fmtUsd } from "@/lib/data/archive-data";

import { AnalyticsHeadline } from "@/components/analytics/analytics-headline";
import { SectionCard } from "@/components/analytics/section-card";
import { RegimeStatsTable } from "@/components/analytics/regime-stats-table";
import { BarRank } from "@/components/analytics/bar-rank";
import { RegimeCallout } from "@/components/analytics/regime-callout";
import { LastUpdatedFooter } from "@/components/analytics/last-updated";
import { AnalyticsEmptyState, MIN_FOR_ANALYTICS } from "@/components/analytics/empty-state";

/**
 * Regime Distribution — which market regimes pay, which bleed.
 *
 *   1. Headline: best regime's win rate + tag name (amber)
 *   2. Per-regime stats table  — sortable; the meat of the page
 *   3. P&L by regime bar chart — horizontal, up/down tone
 *   4. Best & worst callout cards
 *   5. Untagged activities count — prompt to bulk-tag
 */
export const dynamic = "force-dynamic";

const BAR_MAX = 12;
const MIN_REGIME_SAMPLES = 3;

/**
 * Pick the "best" regime for the headline. Definition:
 *   • count ≥ MIN_REGIME_SAMPLES (so a single 100%-win regime with 1 trade
 *     doesn't claim the crown over a 75%-win regime with 12 trades).
 *   • Sort by win rate DESC, then total P&L DESC as tie-breaker, then
 *     count DESC as second tie-breaker.
 *
 * Returns null if no regime meets the sample-count floor — the headline
 * falls back to a softer "your regime data is too thin" subtitle.
 */
function pickBestRegime(rows: RegimeAggRow[]): RegimeAggRow | null {
  const eligible = rows.filter((r) => r.count >= MIN_REGIME_SAMPLES);
  if (eligible.length === 0) return null;
  const sorted = [...eligible].sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.netPnl !== a.netPnl) return b.netPnl - a.netPnl;
    return b.count - a.count;
  });
  return sorted[0];
}

/**
 * "Worst" regime = lowest win rate (with same sample floor), tie-broken by
 * most-negative total P&L, then count.
 */
function pickWorstRegime(rows: RegimeAggRow[]): RegimeAggRow | null {
  const eligible = rows.filter((r) => r.count >= MIN_REGIME_SAMPLES);
  if (eligible.length === 0) return null;
  const sorted = [...eligible].sort((a, b) => {
    if (a.winRate !== b.winRate) return a.winRate - b.winRate;
    if (a.netPnl !== b.netPnl) return a.netPnl - b.netPnl;
    return b.count - a.count;
  });
  return sorted[0];
}

export default async function RegimeDistributionPage() {
  const { id: userId } = await requireUser();
  const t = await getT();

  const [regimes, untaggedCount, totals] = await Promise.all([
    getRegimeAggregations(userId),
    getUntaggedRegimeCount(userId),
    getTotals(userId),
  ]);

  if (totals.count < MIN_FOR_ANALYTICS) {
    return (
      <div className="px-8 py-10 lg:px-12">
        <PageHero best={null} totalCount={totals.count} regimeCount={regimes.length} />
        <div className="mt-8">
          <AnalyticsEmptyState
            headline={t("analytics.regime.empty.headline")}
            body={t("analytics.regime.empty.body", { min: MIN_FOR_ANALYTICS })}
            current={totals.count}
          />
        </div>
        <LastUpdatedFooter />
      </div>
    );
  }

  const best = pickBestRegime(regimes);
  const worst = pickWorstRegime(regimes);

  // Bar chart rows — top BAR_MAX by absolute P&L, regardless of sample size.
  // The full table below applies the sample-floor filtering implicitly via
  // sort (small-N regimes float to the bottom unless P&L is dramatic).
  const barRows = [...regimes]
    .sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl))
    .slice(0, BAR_MAX)
    .map((r) => ({
      label: r.regime,
      value: r.netPnl,
      meta: t("analytics.common.winMeta", {
        count: r.count,
        pct: (r.winRate * 100).toFixed(0),
      }),
    }));

  return (
    <div className="px-8 py-10 lg:px-12">
      <PageHero best={best} totalCount={totals.count} regimeCount={regimes.length} />

      <div className="mt-10 flex flex-col gap-8">
        {/* 1. Per-regime stats table */}
        <SectionCard
          title={t("analytics.regime.perRegime")}
          caption={t("analytics.regime.perRegimeCaption", { min: MIN_REGIME_SAMPLES })}
          meta={
            regimes.length === 1
              ? t("analytics.regime.regimeOne")
              : t("analytics.regime.regimesCount", { count: regimes.length })
          }
        >
          <RegimeStatsTable rows={regimes} />
        </SectionCard>

        {/* 2. P&L by regime bar chart */}
        <SectionCard
          title={t("analytics.regime.pnlTitle")}
          caption={t("analytics.regime.pnlCaption")}
          meta={regimes.length > BAR_MAX ? t("analytics.regime.pnlMeta", { bar: BAR_MAX, total: regimes.length }) : undefined}
        >
          <BarRank rows={barRows} />
        </SectionCard>

        {/* 3. Best / worst callouts */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <RegimeCallout title={t("analytics.regime.bestCallout")} regime={best} tone="up" />
          <RegimeCallout title={t("analytics.regime.worstCallout")} regime={worst} tone="down" />
        </section>

        {/* 4. Untagged prompt */}
        {untaggedCount > 0 && (
          <div className="flex items-center justify-between gap-4 rounded-md border border-dashed border-border bg-inset px-5 py-4">
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
                {untaggedCount === 1
                  ? t("analytics.regime.untaggedCountOne")
                  : t("analytics.regime.untaggedCount", { count: untaggedCount })}
              </p>
              <p className="font-serif text-[12px] italic text-text-tertiary">
                {t("analytics.regime.untaggedHelp")}
              </p>
            </div>
            <span
              className="cursor-not-allowed font-mono text-[10px] uppercase tracking-[0.16em] text-text-disabled"
              title={t("analytics.regime.bulkTagTitle")}
              aria-disabled="true"
            >
              {t("analytics.regime.bulkTag")}
            </span>
          </div>
        )}
      </div>

      <LastUpdatedFooter />
    </div>
  );
}

async function PageHero({
  best,
  totalCount,
  regimeCount,
}: {
  best: RegimeAggRow | null;
  totalCount: number;
  regimeCount: number;
}) {
  const t = await getT();
  if (best) {
    const winRate = `${(best.winRate * 100).toFixed(0)}%`;
    return (
      <header className="flex flex-col gap-2 border-b border-border pb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
          {t("analytics.nav.regime")}
        </p>
        <AnalyticsHeadline
          label={t("analytics.regime.heroBestLabel")}
          value={`${winRate} · ${best.regime}`}
          subtitle={t("analytics.regime.heroBestSubtitle", {
            avg: fmtUsd(best.avgPnl, true),
            count: best.count,
          })}
        />
      </header>
    );
  }
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
        {t("analytics.nav.regime")}
      </p>
      <AnalyticsHeadline
        label={t("analytics.regime.heroFallbackLabel")}
        value={String(regimeCount)}
        subtitle={
          totalCount === 1
            ? t("analytics.regime.heroFallbackSubtitleOne")
            : t("analytics.regime.heroFallbackSubtitle", { count: totalCount })
        }
      />
    </header>
  );
}
