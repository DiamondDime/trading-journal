import Link from "next/link";
import { ArrowRight, Filter, Download, RefreshCw } from "lucide-react";
import { KpiCard } from "@/components/spread/kpi-card";
import { CalendarHeatmap } from "@/components/spread/calendar-heatmap";
import {
  SpreadListCard,
  type SpreadListItem,
} from "@/components/spread/spread-list-card";
import { EquityCurveChart } from "@/components/spread/equity-curve-chart";
import { FundingTicker } from "@/components/spread/funding-ticker";
import { NotesFeed } from "@/components/spread/notes-feed";
import { ActivityMix } from "@/components/spread/activity-mix";
import {
  fmtCapital,
  fmtUsd,
  getActivityTypeCounts,
  getRecentCloses,
  getTotals,
  ACTIVITY_TYPE_LABELS,
  SPREAD_TYPE_LABELS,
  type Activity,
} from "@/lib/data/archive-data";

export const dynamic = "force-static";

const RECENT_COUNT = 8;
const recentRows = getRecentCloses(RECENT_COUNT);
const recentNetSum = recentRows.reduce((s, r) => s + r.netPnl, 0);
const totals = getTotals();
const typeCounts = getActivityTypeCounts();

function describeActivity(a: Activity): string {
  switch (a.type) {
    case "spread":
      return `${a.variant} · ${a.venues}`;
    case "trade":
      return `${a.exchange} · ${a.instrument} · ${a.side}`;
    case "sale":
      return `${a.saleKind.toUpperCase()} · ${a.venue}`;
    case "airdrop":
      return `${a.protocol} · retro drop`;
  }
}

function bestDelta(a: Activity): string {
  if (a.type === "spread") {
    return `${a.serial} · ${SPREAD_TYPE_LABELS[a.spreadType].toLowerCase()} · ${a.daysLabel}`;
  }
  return `${a.serial} · ${ACTIVITY_TYPE_LABELS[a.type].toLowerCase()} · ${a.daysLabel}`;
}

const recentCloses: SpreadListItem[] = recentRows.map((r) => ({
  serial: r.serial,
  name: r.name,
  typeLabel: describeActivity(r),
  status: r.status,
  headline: r.headlineLabel,
  headlineUnit: r.headlineKind,
  tone: r.tone,
  summary:
    r.type === "airdrop"
      ? `${r.daysLabel} · ${r.note}`
      : `${fmtCapital(r.capital)} · ${r.daysLabel} · ${r.note}`,
  href: r.href,
  activityType: r.type,
}));

export default function SpreadsPage() {
  return (
    <div className="w-full">
      {/* ── hero strip ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-border px-8 py-7 md:flex-row md:items-end md:justify-between lg:px-12">
        <div>
          <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
            The book
          </h1>
          <p className="mt-2 font-serif text-sm italic text-text-tertiary">
            {totals.count} activities · {typeCounts.spread} spreads · {typeCounts.trade} trades · {typeCounts.sale} sales · {typeCounts.airdrop} airdrops · since Jan 12, 2026
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
            <span className="text-up">●</span> 3 exchanges connected
          </div>
          <div className="h-4 w-px bg-border" />
          <button className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle">
            <Filter className="h-3 w-3" /> Filter
          </button>
          <button className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle">
            <Download className="h-3 w-3" /> Export
          </button>
          <button className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle">
            <RefreshCw className="h-3 w-3" /> Sync
          </button>
        </div>
      </header>

      <div className="px-8 py-8 lg:px-12">
        {/* ── KPI row · 6 cross-activity cards ─────────────────────────── */}
        <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            variant="hero"
            label="Net P&L · YTD"
            value={fmtUsd(totals.net, true)}
            delta={`across ${totals.count} activities`}
          />
          <KpiCard
            label="Activities closed"
            value={`${totals.count}`}
            delta="4 activity types"
          />
          <KpiCard
            label="Win rate"
            value={`${totals.winRate.toFixed(1)}%`}
            tone="up"
            delta={`${totals.winners} winners · ${totals.losers} losers`}
          />
          <KpiCard
            label="Weighted return"
            value={`${totals.weightedReturnPct.toFixed(1)}%`}
            tone={totals.weightedReturnPct >= 0 ? "up" : "down"}
            delta="realized · capital-weighted"
          />
          <KpiCard
            label="Best activity"
            value={fmtUsd(totals.best.netPnl, true)}
            tone="up"
            delta={bestDelta(totals.best)}
          />
          <KpiCard
            label="Worst activity"
            value={fmtUsd(totals.worst.netPnl, true)}
            tone="down"
            delta={bestDelta(totals.worst)}
          />
        </section>

        {/* ── heatmap + funding ticker ──────────────────────────────────── */}
        <section className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
          <div className="rounded-md border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                Daily realized P&L · last 13 weeks
              </h3>
              <Link
                href="#"
                className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary hover:text-text"
              >
                Full year <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="px-6 py-6">
              <CalendarHeatmap />
            </div>
          </div>

          <FundingTicker />
        </section>

        {/* ── recent closes grid ────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="font-serif text-[15px] font-semibold uppercase tracking-[0.16em] text-text">
                Recent closes
              </h2>
              <span className="font-mono text-[11px] text-text-tertiary">
                {RECENT_COUNT} of {totals.count} · {fmtUsd(recentNetSum)} realized
              </span>
            </div>
            <Link
              href="/spreads/archive"
              className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary hover:text-text"
            >
              The archive <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {recentCloses.map((item) => (
              <SpreadListCard key={item.serial} item={item} />
            ))}
          </div>
        </section>

        {/* ── equity curve ──────────────────────────────────────────────── */}
        <section className="mb-10 rounded-md border border-border bg-surface p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                Equity curve · cumulative realized
              </h3>
              <p className="mt-1 font-serif text-[12px] italic text-text-tertiary">
                Stacked by activity type · sale/airdrop dampened for scale
              </p>
            </div>
            <span className="font-mono text-[11px] text-text-tertiary">
              Jan 8 → May 16, 2026
            </span>
          </div>
          <EquityCurveChart />
        </section>

        {/* ── notes feed + activity mix ─────────────────────────────────── */}
        <section className="mb-10 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.6fr]">
          <NotesFeed />
          <ActivityMix />
        </section>

        {/* ── footer ────────────────────────────────────────────────────── */}
        <footer className="mt-8 flex items-center justify-between border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          <span>crypto journal · v0.1 · since Jan 12, 2026</span>
          <span>3 exchanges connected · {totals.count} activities archived</span>
        </footer>
      </div>
    </div>
  );
}
