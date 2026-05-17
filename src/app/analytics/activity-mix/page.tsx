import { requireUser } from "@/lib/auth/server";
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
            headline="Activity mix needs more data."
            body={`Log at least ${MIN_FOR_ANALYTICS} activities to see breakdowns by type, subtype, asset, and capital allocation.`}
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
      sublabel: holdBucketSublabel(b.bucket),
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
          title="P&L by activity type"
          caption="Where each dollar of P&L came from. Slices use neutral tones — the page's signature amber is reserved for the headline."
        >
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.4fr]">
            <PnlDonut
              slices={typeSlices}
              centerLabel="Total net"
              centerValue={fmtUsdCompact(totals.net)}
              centerCaption={`${totals.count} activities`}
            />
            <CategoryTable rows={typeRows} />
          </div>
        </SectionCard>

        {/* 2. Spread subtypes — only when spreads exist */}
        {spreadSubtypes.length > 0 && (
          <SectionCard
            title="Spread subtypes"
            caption="Spreads broken down by structure. Cash-and-carry, funding, cross-exchange — which strategy carries the book?"
          >
            <div className="flex flex-col gap-6">
              <BarRank rows={subtypeBarRows} />
              <CategoryTable rows={subtypeTableRows} />
            </div>
          </SectionCard>
        )}

        {/* 3. Asset rank */}
        <SectionCard
          title="By asset"
          caption="Net P&L per underlying. Sorted by absolute magnitude — find your bread-and-butter ticker."
          meta={`${assets.length} ${assets.length === 1 ? "asset" : "assets"} traded`}
        >
          <BarRank rows={assetRows} />
        </SectionCard>

        {/* 4. Capital allocation donut */}
        <SectionCard
          title="Capital allocation"
          caption="Where the money is parked — distinct from P&L. Look for mismatches: a type that holds 60% of capital but generates 20% of returns."
        >
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.4fr]">
            <PnlDonut
              slices={capitalSlices}
              centerLabel="Total capital"
              centerValue={
                totalCapital > 0
                  ? `$${(totalCapital >= 10_000
                      ? (totalCapital / 1000).toFixed(0) + "k"
                      : totalCapital.toFixed(0))}`
                  : "—"
              }
              centerCaption={`across ${ACTIVITY_TYPE_ORDER.filter((t) => capitalByType[t] > 0).length} types`}
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
          title="Average hold time + return per band"
          caption="Distribution of activities across holding-period bands, with average P&L per band."
        >
          <CategoryTable rows={holdTableRows} showCapital={false} showWinRate={false} />
        </SectionCard>
      </div>

      <LastUpdatedFooter />
    </div>
  );
}

function PageHero({ totalNet, count }: { totalNet: number; count: number }) {
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
        Activity mix
      </p>
      <AnalyticsHeadline
        label="Total realized P&L"
        value={fmtUsd(totalNet, true)}
        subtitle={`Breakdown by type, subtype, asset, and capital allocation · ${count} ${count === 1 ? "activity" : "activities"}`}
      />
    </header>
  );
}

function holdBucketSublabel(bucket: string): string {
  switch (bucket) {
    case "0-1d": return "intraday";
    case "1-7d": return "short swing";
    case "1-4w": return "swing";
    case "1-3m": return "position";
    case "3m+": return "long hold";
    default: return "";
  }
}

/**
 * Right-column callout list for the capital allocation donut — surfaces
 * the % capital vs % P&L mismatch the user is looking for.
 */
function CapitalDonutCallouts({
  capitalByType,
  netByType,
  totalCapital,
}: {
  capitalByType: Record<ActivityType, number>;
  netByType: Record<ActivityType, number>;
  totalCapital: number;
}) {
  const totalNetAbs = ACTIVITY_TYPE_ORDER.reduce(
    (s, t) => s + Math.abs(netByType[t]),
    0,
  );
  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
        Capital share · vs · P&L share
      </h4>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="grid grid-cols-4 border-b border-border bg-inset px-4 py-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          <span className="text-left">Type</span>
          <span>Capital</span>
          <span>% Cap</span>
          <span>% P&L</span>
        </div>
        {ACTIVITY_TYPE_ORDER.map((t) => {
          const cap = capitalByType[t];
          const net = netByType[t];
          const capShare = totalCapital > 0 ? (cap / totalCapital) * 100 : 0;
          const pnlShare =
            totalNetAbs > 0 ? (Math.abs(net) / totalNetAbs) * 100 : 0;
          if (cap === 0 && net === 0) return null;
          // Mismatch is interesting when the two shares differ by >= 10pp
          // either way. Tag it visually so the eye lands on it.
          const mismatch = Math.abs(capShare - pnlShare);
          return (
            <div
              key={t}
              className={
                "grid grid-cols-4 border-b border-border-subtle px-4 py-2 text-right font-mono text-[11px] tabular-nums last:border-b-0 " +
                (mismatch >= 10 ? "bg-inset/40" : "")
              }
            >
              <span className="text-left font-serif text-[12px] not-italic text-text">
                {ACTIVITY_TYPE_LABELS[t]}
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
        Highlighted rows are types where capital share and P&L share differ by
        10 points or more — a sign of mis-allocation worth investigating.
      </p>
    </div>
  );
}
