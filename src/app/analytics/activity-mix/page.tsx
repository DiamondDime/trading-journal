import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import {
  getActivityTypeAggregations,
  getCapitalByActivityType,
  getSpreadSubtypeAggregations,
  getAssetAggregations,
  getHoldTimeBuckets,
  getTotals,
} from "@/lib/db/activity";
import {
  ACTIVITY_TYPE_LABELS,
  SPREAD_TYPE_LABELS,
  fmtUsd,
  type ActivityType,
  type SpreadType,
} from "@/lib/data/archive-data";

import { AnalyticsHeadline } from "@/components/analytics/analytics-headline";
import { SectionCard } from "@/components/analytics/section-card";
import { PnlDonut, type DonutSlice } from "@/components/analytics/pnl-donut";
import { BarRank } from "@/components/analytics/bar-rank";
import { CategoryTable, type CategoryRow } from "@/components/analytics/category-table";
import { LastUpdatedFooter } from "@/components/analytics/last-updated";
import { AnalyticsEmptyState, MIN_FOR_ANALYTICS } from "@/components/analytics/empty-state";

/**
 * Activity Mix — Where is the P&L actually coming from, and how is the
 * capital allocated to make it?
 *
 * Sections:
 *   1. Headline: total realized P&L (amber)
 *   2. P&L by activity type     — donut + breakdown table
 *   3. Spread subtypes          — stacked bar + table (only if spreads exist)
 *   4. By asset                 — horizontal bar chart sorted by abs P&L
 *   5. Capital allocation donut — where the money is parked
 *   6. Avg hold + return by cat. — compact table
 */
export const dynamic = "force-dynamic";

const ACTIVITY_TYPE_ORDER: ActivityType[] = ["spread", "trade", "sale", "airdrop"];

// Spread subtype display order — mirrors src/lib/data/archive-data.ts UI vocab
// but the DB column uses canonical names. We map at the boundary.
const SPREAD_TYPE_DB_TO_UI: Record<string, SpreadType> = {
  cash_carry: "cash_carry",
  funding_capture: "funding",
  cross_exchange_perp_arb: "cross_exchange",
  calendar: "calendar",
  dex_cex_arb: "dex_cex",
};

function spreadTypeLabel(dbKey: string): string {
  const ui = SPREAD_TYPE_DB_TO_UI[dbKey];
  return ui ? SPREAD_TYPE_LABELS[ui] : dbKey;
}

function fmtUsdCompact(v: number): string {
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default async function ActivityMixPage() {
  const { id: userId } = await requireUser();
  const t = await getT();

  const [
    totals,
    typeAggs,
    capitalByType,
    spreadSubtypes,
    assets,
    holdBuckets,
  ] = await Promise.all([
    getTotals(userId),
    getActivityTypeAggregations(userId),
    getCapitalByActivityType(userId),
    getSpreadSubtypeAggregations(userId),
    getAssetAggregations(userId),
    getHoldTimeBuckets(userId),
  ]);

  // Helper accessors so the rest of the page reads like the old typeCounts /
  // typeNetPnl split — keeps the diff focused on the new winRate column.
  const typeCounts = {
    spread: typeAggs.spread.count,
    trade: typeAggs.trade.count,
    sale: typeAggs.sale.count,
    airdrop: typeAggs.airdrop.count,
  };
  const typeNetPnl = {
    spread: typeAggs.spread.netPnl,
    trade: typeAggs.trade.netPnl,
    sale: typeAggs.sale.netPnl,
    airdrop: typeAggs.airdrop.netPnl,
  };

  if (totals.count < MIN_FOR_ANALYTICS) {
    return (
      <div className="px-8 py-10 lg:px-12">
        <PageHero totalNet={totals.net} count={totals.count} />
        <div className="mt-8">
          <AnalyticsEmptyState
            headline={t("analytics.activityMix.empty.headline")}
            body={t("analytics.activityMix.empty.body", { min: MIN_FOR_ANALYTICS })}
            current={totals.count}
          />
        </div>
        <LastUpdatedFooter />
      </div>
    );
  }

  // ── P&L by activity type donut + table ────────────────────────────────
  const totalPnlMagnitude = ACTIVITY_TYPE_ORDER.reduce(
    (s, t) => s + Math.abs(typeNetPnl[t]),
    0,
  );

  const typeSlices: DonutSlice[] = ACTIVITY_TYPE_ORDER
    .filter((t) => typeCounts[t] > 0)
    .map((t) => ({
      key: t,
      name: ACTIVITY_TYPE_LABELS[t],
      value: typeNetPnl[t],
      tone:
        typeNetPnl[t] > 0
          ? "up"
          : typeNetPnl[t] < 0
          ? "down"
          : "neutral",
    }));

  const typeRows: CategoryRow[] = ACTIVITY_TYPE_ORDER
    .filter((t) => typeCounts[t] > 0)
    .map((t) => {
      const agg = typeAggs[t];
      const scoring = agg.winners + agg.losers;
      return {
        label: ACTIVITY_TYPE_LABELS[t],
        sublabel: `${agg.count} ${agg.count === 1 ? "activity" : "activities"}`,
        count: agg.count,
        netPnl: agg.netPnl,
        avgPnl: agg.count > 0 ? agg.netPnl / agg.count : 0,
        // Win rate denominator is "scoring activities" (winners + losers),
        // not total count — flat-zero airdrops shouldn't pull a sale's win
        // rate down to 50% via a denominator inflation.
        winRate: scoring > 0 ? agg.winners / scoring : 0,
        share:
          totalPnlMagnitude > 0
            ? (Math.abs(agg.netPnl) / totalPnlMagnitude) * 100
            : 0,
        capital: capitalByType[t],
      };
    });

  // ── Spread subtypes ────────────────────────────────────────────────────
  const subtypeBarRows = spreadSubtypes
    .map((r) => ({
      label: spreadTypeLabel(r.spreadType),
      value: r.netPnl,
      meta: `${r.count} · ${(r.winRate * 100).toFixed(0)}% win`,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const subtypeTotalAbs = spreadSubtypes.reduce(
    (s, r) => s + Math.abs(r.netPnl),
    0,
  );
  const subtypeTableRows: CategoryRow[] = spreadSubtypes.map((r) => ({
    label: spreadTypeLabel(r.spreadType),
    sublabel: `${r.count} ${r.count === 1 ? "spread" : "spreads"}`,
    count: r.count,
    netPnl: r.netPnl,
    avgPnl: r.avgPnl,
    winRate: r.winRate,
    share:
      subtypeTotalAbs > 0 ? (Math.abs(r.netPnl) / subtypeTotalAbs) * 100 : 0,
    capital: r.capital,
  }));

  // ── Asset rank ─────────────────────────────────────────────────────────
  const assetRows = assets
    .filter((a) => a.asset && a.asset.length > 0)
    .slice(0, 12) // cap at 12 — long tail goes "Other"
    .map((a) => ({
      label: a.asset,
      value: a.netPnl,
      meta: `${a.count} · ${(a.winRate * 100).toFixed(0)}% win`,
    }));

  // ── Capital allocation donut ───────────────────────────────────────────
  const totalCapital = ACTIVITY_TYPE_ORDER.reduce(
    (s, t) => s + capitalByType[t],
    0,
  );
  const capitalSlices: DonutSlice[] = ACTIVITY_TYPE_ORDER
    .filter((t) => capitalByType[t] > 0)
    .map((t) => ({
      key: t,
      name: ACTIVITY_TYPE_LABELS[t],
      value: capitalByType[t],
      // Capital allocation is neutral — no win/loss tone for "where the
      // money was parked".
      tone: "neutral",
    }));

  // ── Avg hold time + avg return by hold-time band ───────────────────────
  const holdTableRows: CategoryRow[] = holdBuckets
    .filter((b) => b.count > 0)
    .map((b) => ({
      label: b.bucket,
      sublabel: holdBucketSublabel(b.bucket, t),
      count: b.count,
      netPnl: b.netPnl,
      avgPnl: b.avgPnl,
      winRate: 0,
      share:
        totals.count > 0 ? (b.count / totals.count) * 100 : 0,
    }));

  return (
    <div className="px-8 py-10 lg:px-12">
      <PageHero totalNet={totals.net} count={totals.count} />

      <div className="mt-10 flex flex-col gap-8">
        {/* 1. P&L by activity type — donut + table side by side */}
        <SectionCard
          title={t("analytics.activityMix.sections.byType")}
          caption={t("analytics.activityMix.captions.byType")}
        >
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.4fr]">
            <PnlDonut
              slices={typeSlices}
              centerLabel={t("analytics.activityMix.donut.totalNet")}
              centerValue={fmtUsdCompact(totals.net)}
              centerCaption={t("analytics.activityMix.donut.activities", { count: totals.count })}
            />
            <CategoryTable rows={typeRows} />
          </div>
        </SectionCard>

        {/* 2. Spread subtypes — only when spreads exist */}
        {spreadSubtypes.length > 0 && (
          <SectionCard
            title={t("analytics.activityMix.sections.subtypes")}
            caption={t("analytics.activityMix.captions.subtypes")}
          >
            <div className="flex flex-col gap-6">
              <BarRank rows={subtypeBarRows} />
              <CategoryTable rows={subtypeTableRows} />
            </div>
          </SectionCard>
        )}

        {/* 3. Asset rank */}
        <SectionCard
          title={t("analytics.activityMix.sections.byAsset")}
          caption={t("analytics.activityMix.captions.byAsset")}
          meta={
            assets.length === 1
              ? t("analytics.activityMix.assetTradedOne")
              : t("analytics.activityMix.assetsTraded", { count: assets.length })
          }
        >
          <BarRank rows={assetRows} />
        </SectionCard>

        {/* 4. Capital allocation donut */}
        <SectionCard
          title={t("analytics.activityMix.sections.capital")}
          caption={t("analytics.activityMix.captions.capital")}
        >
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.4fr]">
            <PnlDonut
              slices={capitalSlices}
              centerLabel={t("analytics.activityMix.donut.totalCapital")}
              centerValue={
                totalCapital > 0
                  ? `$${(totalCapital >= 10_000
                      ? (totalCapital / 1000).toFixed(0) + "k"
                      : totalCapital.toFixed(0))}`
                  : "—"
              }
              centerCaption={t("analytics.activityMix.donut.acrossTypes", {
                count: ACTIVITY_TYPE_ORDER.filter((t) => capitalByType[t] > 0).length,
              })}
            />
            <CapitalDonutCallouts
              capitalByType={capitalByType}
              netByType={typeNetPnl}
              totalCapital={totalCapital}
            />
          </div>
        </SectionCard>

        {/* 5. Avg hold time + avg P&L by band */}
        <SectionCard
          title={t("analytics.activityMix.sections.holdTime")}
          caption={t("analytics.activityMix.captions.holdTime")}
        >
          <CategoryTable rows={holdTableRows} showCapital={false} showWinRate={false} />
        </SectionCard>
      </div>

      <LastUpdatedFooter />
    </div>
  );
}

async function PageHero({ totalNet, count }: { totalNet: number; count: number }) {
  const t = await getT();
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
        {t("analytics.nav.activityMix")}
      </p>
      <AnalyticsHeadline
        label={t("analytics.activityMix.heroLabel")}
        value={fmtUsd(totalNet, true)}
        subtitle={
          count === 1
            ? t("analytics.activityMix.heroSubtitleOne")
            : t("analytics.activityMix.heroSubtitle", { count })
        }
      />
    </header>
  );
}

function holdBucketSublabel(bucket: string, t: Awaited<ReturnType<typeof getT>>): string {
  switch (bucket) {
    case "0-1d": return t("analytics.activityMix.holdBuckets.intraday");
    case "1-7d": return t("analytics.activityMix.holdBuckets.shortSwing");
    case "1-4w": return t("analytics.activityMix.holdBuckets.swing");
    case "1-3m": return t("analytics.activityMix.holdBuckets.position");
    case "3m+": return t("analytics.activityMix.holdBuckets.longHold");
    default: return "";
  }
}

/**
 * Right-column callout list for the capital allocation donut — surfaces
 * the % capital vs % P&L mismatch the user is looking for.
 */
async function CapitalDonutCallouts({
  capitalByType,
  netByType,
  totalCapital,
}: {
  capitalByType: Record<ActivityType, number>;
  netByType: Record<ActivityType, number>;
  totalCapital: number;
}) {
  const t = await getT();
  const totalNetAbs = ACTIVITY_TYPE_ORDER.reduce(
    (s, type) => s + Math.abs(netByType[type]),
    0,
  );
  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
        {t("analytics.activityMix.capitalCalloutTitle")}
      </h4>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="grid grid-cols-4 border-b border-border bg-inset px-4 py-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          <span className="text-left">{t("analytics.activityMix.capitalCalloutCols.type")}</span>
          <span>{t("analytics.activityMix.capitalCalloutCols.capital")}</span>
          <span>{t("analytics.activityMix.capitalCalloutCols.capPct")}</span>
          <span>{t("analytics.activityMix.capitalCalloutCols.pnlPct")}</span>
        </div>
        {ACTIVITY_TYPE_ORDER.map((type) => {
          const cap = capitalByType[type];
          const net = netByType[type];
          const capShare = totalCapital > 0 ? (cap / totalCapital) * 100 : 0;
          const pnlShare =
            totalNetAbs > 0 ? (Math.abs(net) / totalNetAbs) * 100 : 0;
          if (cap === 0 && net === 0) return null;
          // Mismatch is interesting when the two shares differ by >= 10pp
          // either way. Tag it visually so the eye lands on it.
          const mismatch = Math.abs(capShare - pnlShare);
          return (
            <div
              key={type}
              className={
                "grid grid-cols-4 border-b border-border-subtle px-4 py-2 text-right font-mono text-[11px] tabular-nums last:border-b-0 " +
                (mismatch >= 10 ? "bg-inset/40" : "")
              }
            >
              <span className="text-left font-serif text-[12px] not-italic text-text">
                {ACTIVITY_TYPE_LABELS[type]}
              </span>
              <span className="text-text-secondary">
                {cap > 0 ? fmtUsdCompact(cap) : "—"}
              </span>
              <span className="text-text-secondary">{capShare.toFixed(0)}%</span>
              <span className={net >= 0 ? "text-up" : "text-down"}>
                {pnlShare.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
      <p className="font-serif text-[11px] italic leading-snug text-text-tertiary">
        {t("analytics.activityMix.capitalCalloutHint")}
      </p>
    </div>
  );
}
