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
import { StrategyMix } from "@/components/spread/strategy-mix";

export const dynamic = "force-static";

const recentCloses: SpreadListItem[] = [
  {
    serial: "#032",
    name: "BTC cash-and-carry",
    typeLabel: "Funding · Bitmex + Coinbase",
    status: "closed",
    headline: "+14.0%",
    headlineUnit: "APR",
    tone: "up",
    summary: "$47,300 · 73d · −21% vs target",
    href: "/spreads/demo",
  },
  {
    serial: "#031",
    name: "BTC calendar",
    typeLabel: "Sep-26 / Dec-26 · Deribit",
    status: "closed",
    headline: "+152",
    headlineUnit: "BPS/D",
    tone: "up",
    summary: "$3,140 · 32d · contango widening",
    href: "/spreads/demo",
  },
  {
    serial: "#030",
    name: "ETH funding capture",
    typeLabel: "Same venue · Bybit",
    status: "closed",
    headline: "+11.3%",
    headlineUnit: "APR",
    tone: "up",
    summary: "$30,840 · 19d · −18% vs target",
    href: "/spreads/demo",
  },
  {
    serial: "#029",
    name: "BTC perp arbitrage",
    typeLabel: "Cross-exchange · Binance/Bybit",
    status: "closed",
    headline: "+4.3",
    headlineUnit: "BPS",
    tone: "up",
    summary: "$5,420 · 47 min · clean exit",
    href: "/spreads/demo",
  },
  {
    serial: "#028",
    name: "BTC cash-and-carry",
    typeLabel: "Basis · Deribit Mar-26 + Bybit",
    status: "expired",
    headline: "+7.9%",
    headlineUnit: "APR",
    tone: "up",
    summary: "$62,500 · 79d · held to expiry",
    href: "/spreads/demo",
  },
  {
    serial: "#027",
    name: "PEPE DEX-CEX",
    typeLabel: "OKX DEX + OKX perp",
    status: "closed",
    headline: "−59",
    headlineUnit: "BPS",
    tone: "down",
    summary: "$8,420 · 11h · gas killed it",
    href: "/spreads/demo",
  },
  {
    serial: "#026",
    name: "ETH funding capture",
    typeLabel: "Cross venue · Binance/OKX",
    status: "closed",
    headline: "+18.2%",
    headlineUnit: "APR",
    tone: "up",
    summary: "$22,400 · 14d · funding inversion",
    href: "/spreads/demo",
  },
  {
    serial: "#025",
    name: "BTC perp arbitrage",
    typeLabel: "Cross-exchange · Bybit/OKX",
    status: "closed",
    headline: "+7.1",
    headlineUnit: "BPS",
    tone: "up",
    summary: "$4,180 · 22 min · widened spread",
    href: "/spreads/demo",
  },
];

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
            Sixteen spreads archived · since Jan 8, 2026 · last close 38h ago
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
        {/* ── KPI row · 6 closed-only cards ─────────────────────────────── */}
        <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            variant="hero"
            label="Net P&L · YTD"
            value="+$4,051.62"
            delta="↑ 7.2% vs Q1 · 21 weeks"
          />
          <KpiCard
            label="Trades closed"
            value="16"
            delta="across 5 spread types"
          />
          <KpiCard
            label="Win rate"
            value="87.5%"
            tone="up"
            delta="14 winners · 2 losers"
          />
          <KpiCard
            label="Weighted APR"
            value="9.8%"
            tone="up"
            delta="realized · capital-weighted"
          />
          <KpiCard
            label="Best trade"
            value="+$1,528"
            tone="up"
            delta="#031 · calendar · 32d"
          />
          <KpiCard
            label="Worst trade"
            value="−$50"
            tone="down"
            delta="#027 · DEX-CEX · gas"
          />
        </section>

        {/* ── heatmap (60%) + funding ticker (40%) ──────────────────────── */}
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
                8 of 16 · $3,981 realized
              </span>
            </div>
            <Link
              href="#"
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
                Stacked by spread type · hover for breakdown
              </p>
            </div>
            <span className="font-mono text-[11px] text-text-tertiary">
              Jan 8 → May 16, 2026
            </span>
          </div>
          <EquityCurveChart />
        </section>

        {/* ── notes feed + strategy mix ─────────────────────────────────── */}
        <section className="mb-10 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.6fr]">
          <NotesFeed />
          <StrategyMix />
        </section>

        {/* ── footer ────────────────────────────────────────────────────── */}
        <footer className="mt-8 flex items-center justify-between border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          <span>spread journal · v0.1 · since Jan 8, 2026</span>
          <span>3 exchanges connected · 16 trades archived</span>
        </footer>
      </div>
    </div>
  );
}
