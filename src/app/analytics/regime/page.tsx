import { requireUser } from "@/lib/auth/server";
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
            headline="Regime analysis needs more data."
            body={`Tag at least ${MIN_FOR_ANALYTICS} activities with regime context (e.g. funding-positive, contango, risk-on) to see which markets pay you.`}
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
      meta: `${r.count} · ${(r.winRate * 100).toFixed(0)}% win`,
    }));

  return (
    <div className="px-8 py-10 lg:px-12">
      <PageHero best={best} totalCount={totals.count} regimeCount={regimes.length} />

      <div className="mt-10 flex flex-col gap-8">
        {/* 1. Per-regime stats table */}
        <SectionCard
          title="Per-regime stats"
          caption={`Each row aggregates every activity tagged with that regime. An activity tagged twice contributes to two rows. Click a column header to sort. Regimes with fewer than ${MIN_REGIME_SAMPLES} samples are statistically noisy.`}
          meta={`${regimes.length} ${regimes.length === 1 ? "regime" : "regimes"}`}
        >
          <RegimeStatsTable rows={regimes} />
        </SectionCard>

        {/* 2. P&L by regime bar chart */}
        <SectionCard
          title="P&L by regime"
          caption="Total realized P&L per regime tag, ranked by magnitude. Up vs down tone makes the spreads obvious at a glance."
          meta={regimes.length > BAR_MAX ? `top ${BAR_MAX} of ${regimes.length}` : undefined}
        >
          <BarRank rows={barRows} />
        </SectionCard>

        {/* 3. Best / worst callouts */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <RegimeCallout title="Best regime" regime={best} tone="up" />
          <RegimeCallout title="Worst regime" regime={worst} tone="down" />
        </section>

        {/* 4. Untagged prompt */}
        {untaggedCount > 0 && (
          <div className="flex items-center justify-between gap-4 rounded-md border border-dashed border-border bg-inset px-5 py-4">
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
                {untaggedCount} {untaggedCount === 1 ? "activity has" : "activities have"} no regime tag
              </p>
              <p className="font-serif text-[12px] italic text-text-tertiary">
                Tagging activities with regime context (e.g. funding-positive, risk-on, contango) is what makes this page meaningful.
              </p>
            </div>
            <a
              href="#"
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary underline-offset-4 hover:text-text hover:underline"
              aria-disabled="true"
              title="Bulk-tagging UI coming in v2"
            >
              Bulk tag (soon)
            </a>
          </div>
        )}
      </div>

      <LastUpdatedFooter />
    </div>
  );
}

function PageHero({
  best,
  totalCount,
  regimeCount,
}: {
  best: RegimeAggRow | null;
  totalCount: number;
  regimeCount: number;
}) {
  // When we have a best regime, headline is "{N}% win rate · {tag name}".
  // When we don't (too thin), fall back to a neutral count headline.
  if (best) {
    const winRate = `${(best.winRate * 100).toFixed(0)}%`;
    const subtitle = `Your strongest market regime · ${fmtUsd(best.avgPnl, true)} avg over ${best.count} activities`;
    return (
      <header className="flex flex-col gap-2 border-b border-border pb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
          Regime distribution
        </p>
        <AnalyticsHeadline
          label="Best regime · win rate"
          value={`${winRate} · ${best.regime}`}
          subtitle={subtitle}
        />
      </header>
    );
  }
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
        Regime distribution
      </p>
      <AnalyticsHeadline
        label="Regimes tracked"
        value={String(regimeCount)}
        subtitle={`Across ${totalCount} ${totalCount === 1 ? "activity" : "activities"}. Tag more activities to surface your strongest market regime.`}
      />
    </header>
  );
}
