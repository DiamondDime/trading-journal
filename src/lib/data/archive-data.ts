// Fixture dataset for the closed-trade archive. Shared between the dashboard
// (Recent closes section) and /spreads/archive. Will be replaced by a DB query
// once the read paths are wired.

export type SpreadType =
  | "cash_carry"
  | "calendar"
  | "funding"
  | "cross_exchange"
  | "dex_cex";

export type Asset = "BTC" | "ETH" | "SOL" | "PEPE";

export type SpreadStatus = "closed" | "expired";

export type HeadlineUnit = "APR" | "BPS" | "BPS/D";

export interface ArchiveRow {
  serial: string;          // "#032"
  serialNum: number;       // 32
  name: string;            // "BTC cash-and-carry"
  type: SpreadType;
  variant: string;         // "Funding" | "Basis" | "Same venue" | "Sep-26 / Dec-26" ...
  asset: Asset;
  venues: string;          // "Bitmex + Coinbase"
  status: SpreadStatus;
  capital: number;
  daysHeld: number;        // numeric (fractional for sub-day trades)
  daysLabel: string;       // "73d" | "47 min" | "11h"
  closedAt: string;        // ISO date YYYY-MM-DD
  closedLabel: string;     // "Mar 28"
  headlineNum: number;     // raw value (signed) for sorting
  headlineLabel: string;   // "+14.0%" | "+152" | "−59"
  headlineUnit: HeadlineUnit;
  tone: "up" | "down";
  netPnl: number;
  note: string;            // qualitative — used as 3rd part of card summary
  href: string;
}

export const SPREAD_TYPE_LABELS: Record<SpreadType, string> = {
  cash_carry: "Cash-and-carry",
  calendar: "Calendar",
  funding: "Funding capture",
  cross_exchange: "Cross-exchange",
  dex_cex: "DEX-CEX",
};

export const STATUS_STYLES: Record<SpreadStatus, { dot: string; label: string }> = {
  closed: { dot: "bg-text-tertiary", label: "Closed" },
  expired: { dot: "bg-text-tertiary", label: "Expired" },
};

// Ordered newest-serial-first. #032 is the anchor — its detail page lives at
// /spreads/demo and matches the BTC cash-and-carry hero fixture.
export const ARCHIVE_DATA: ArchiveRow[] = [
  {
    serial: "#032",
    serialNum: 32,
    name: "BTC cash-and-carry",
    type: "cash_carry",
    variant: "Funding",
    asset: "BTC",
    venues: "Bitmex + Coinbase",
    status: "closed",
    capital: 47300,
    daysHeld: 73,
    daysLabel: "73d",
    closedAt: "2026-03-28",
    closedLabel: "Mar 28",
    headlineNum: 14.0,
    headlineLabel: "+14.0%",
    headlineUnit: "APR",
    tone: "up",
    netPnl: 1314.40,
    note: "−21% vs target",
    href: "/spreads/demo",
  },
  {
    serial: "#031",
    serialNum: 31,
    name: "BTC calendar",
    type: "calendar",
    variant: "Sep-26 / Dec-26",
    asset: "BTC",
    venues: "Deribit",
    status: "closed",
    capital: 3140,
    daysHeld: 32,
    daysLabel: "32d",
    closedAt: "2026-04-15",
    closedLabel: "Apr 15",
    headlineNum: 152,
    headlineLabel: "+152",
    headlineUnit: "BPS/D",
    tone: "up",
    netPnl: 1528.00,
    note: "contango widening",
    href: "/spreads/demo",
  },
  {
    serial: "#030",
    serialNum: 30,
    name: "ETH funding capture",
    type: "funding",
    variant: "Same venue",
    asset: "ETH",
    venues: "Bybit",
    status: "closed",
    capital: 30840,
    daysHeld: 19,
    daysLabel: "19d",
    closedAt: "2026-04-20",
    closedLabel: "Apr 20",
    headlineNum: 11.3,
    headlineLabel: "+11.3%",
    headlineUnit: "APR",
    tone: "up",
    netPnl: 181.20,
    note: "−18% vs target",
    href: "/spreads/demo",
  },
  {
    serial: "#029",
    serialNum: 29,
    name: "BTC perp arbitrage",
    type: "cross_exchange",
    variant: "Perp arb",
    asset: "BTC",
    venues: "Binance / Bybit",
    status: "closed",
    capital: 5420,
    daysHeld: 0.0326,
    daysLabel: "47 min",
    closedAt: "2026-04-25",
    closedLabel: "Apr 25",
    headlineNum: 4.3,
    headlineLabel: "+4.3",
    headlineUnit: "BPS",
    tone: "up",
    netPnl: 23.30,
    note: "clean exit",
    href: "/spreads/demo",
  },
  {
    serial: "#028",
    serialNum: 28,
    name: "BTC cash-and-carry",
    type: "cash_carry",
    variant: "Basis",
    asset: "BTC",
    venues: "Deribit Mar-26 + Bybit",
    status: "expired",
    capital: 62500,
    daysHeld: 79,
    daysLabel: "79d",
    closedAt: "2026-03-26",
    closedLabel: "Mar 26",
    headlineNum: 7.9,
    headlineLabel: "+7.9%",
    headlineUnit: "APR",
    tone: "up",
    netPnl: 1067.50,
    note: "held to expiry",
    href: "/spreads/demo",
  },
  {
    serial: "#027",
    serialNum: 27,
    name: "PEPE DEX-CEX",
    type: "dex_cex",
    variant: "DEX-CEX",
    asset: "PEPE",
    venues: "OKX DEX + OKX perp",
    status: "closed",
    capital: 8420,
    daysHeld: 0.458,
    daysLabel: "11h",
    closedAt: "2026-04-26",
    closedLabel: "Apr 26",
    headlineNum: -59,
    headlineLabel: "−59",
    headlineUnit: "BPS",
    tone: "down",
    netPnl: -49.68,
    note: "gas killed it",
    href: "/spreads/demo",
  },
  {
    serial: "#026",
    serialNum: 26,
    name: "ETH funding capture",
    type: "funding",
    variant: "Cross venue",
    asset: "ETH",
    venues: "Binance / OKX",
    status: "closed",
    capital: 22400,
    daysHeld: 14,
    daysLabel: "14d",
    closedAt: "2026-05-07",
    closedLabel: "May 7",
    headlineNum: 18.2,
    headlineLabel: "+18.2%",
    headlineUnit: "APR",
    tone: "up",
    netPnl: 156.32,
    note: "funding inversion",
    href: "/spreads/demo",
  },
  {
    serial: "#025",
    serialNum: 25,
    name: "BTC perp arbitrage",
    type: "cross_exchange",
    variant: "Perp arb",
    asset: "BTC",
    venues: "Bybit / OKX",
    status: "closed",
    capital: 4180,
    daysHeld: 0.0153,
    daysLabel: "22 min",
    closedAt: "2026-05-14",
    closedLabel: "May 14",
    headlineNum: 7.1,
    headlineLabel: "+7.1",
    headlineUnit: "BPS",
    tone: "up",
    netPnl: 29.68,
    note: "widened spread",
    href: "/spreads/demo",
  },
  {
    serial: "#024",
    serialNum: 24,
    name: "ETH cash-and-carry",
    type: "cash_carry",
    variant: "Funding",
    asset: "ETH",
    venues: "Binance + Coinbase",
    status: "closed",
    capital: 28900,
    daysHeld: 42,
    daysLabel: "42d",
    closedAt: "2026-02-18",
    closedLabel: "Feb 18",
    headlineNum: 12.6,
    headlineLabel: "+12.6%",
    headlineUnit: "APR",
    tone: "up",
    netPnl: 418.00,
    note: "regime flip exit",
    href: "/spreads/demo",
  },
  {
    serial: "#023",
    serialNum: 23,
    name: "BTC funding capture",
    type: "funding",
    variant: "Same venue",
    asset: "BTC",
    venues: "Hyperliquid",
    status: "closed",
    capital: 18500,
    daysHeld: 9,
    daysLabel: "9d",
    closedAt: "2026-02-04",
    closedLabel: "Feb 4",
    headlineNum: 8.4,
    headlineLabel: "+8.4%",
    headlineUnit: "APR",
    tone: "up",
    netPnl: 38.32,
    note: "early take",
    href: "/spreads/demo",
  },
  {
    serial: "#022",
    serialNum: 22,
    name: "BTC perp arbitrage",
    type: "cross_exchange",
    variant: "Perp arb",
    asset: "BTC",
    venues: "Binance / OKX",
    status: "closed",
    capital: 6300,
    daysHeld: 0.0514,
    daysLabel: "1h 14m",
    closedAt: "2026-01-26",
    closedLabel: "Jan 26",
    headlineNum: 9.2,
    headlineLabel: "+9.2",
    headlineUnit: "BPS",
    tone: "up",
    netPnl: 57.96,
    note: "mean-reversion",
    href: "/spreads/demo",
  },
  {
    serial: "#021",
    serialNum: 21,
    name: "SOL cash-and-carry",
    type: "cash_carry",
    variant: "Funding",
    asset: "SOL",
    venues: "Bybit + Binance",
    status: "closed",
    capital: 14200,
    daysHeld: 24,
    daysLabel: "24d",
    closedAt: "2026-02-22",
    closedLabel: "Feb 22",
    headlineNum: -2.1,
    headlineLabel: "−2.1%",
    headlineUnit: "APR",
    tone: "down",
    netPnl: -19.61,
    note: "funding inverted",
    href: "/spreads/demo",
  },
  {
    serial: "#020",
    serialNum: 20,
    name: "BTC calendar",
    type: "calendar",
    variant: "Mar-26 / Jun-26",
    asset: "BTC",
    venues: "Deribit",
    status: "closed",
    capital: 9500,
    daysHeld: 27,
    daysLabel: "27d",
    closedAt: "2026-03-02",
    closedLabel: "Mar 2",
    headlineNum: 98,
    headlineLabel: "+98",
    headlineUnit: "BPS/D",
    tone: "up",
    netPnl: 251.10,
    note: "contango softened",
    href: "/spreads/demo",
  },
  {
    serial: "#019",
    serialNum: 19,
    name: "ETH funding capture",
    type: "funding",
    variant: "Cross venue",
    asset: "ETH",
    venues: "Bybit / Binance",
    status: "closed",
    capital: 16200,
    daysHeld: 11,
    daysLabel: "11d",
    closedAt: "2026-01-28",
    closedLabel: "Jan 28",
    headlineNum: 14.8,
    headlineLabel: "+14.8%",
    headlineUnit: "APR",
    tone: "up",
    netPnl: 72.32,
    note: "cross-venue arb",
    href: "/spreads/demo",
  },
  {
    serial: "#018",
    serialNum: 18,
    name: "BTC cash-and-carry",
    type: "cash_carry",
    variant: "Funding",
    asset: "BTC",
    venues: "Bitmex + Kraken",
    status: "closed",
    capital: 35400,
    daysHeld: 21,
    daysLabel: "21d",
    closedAt: "2026-01-18",
    closedLabel: "Jan 18",
    headlineNum: 9.7,
    headlineLabel: "+9.7%",
    headlineUnit: "APR",
    tone: "up",
    netPnl: 197.50,
    note: "ETF inflow trade",
    href: "/spreads/demo",
  },
  {
    serial: "#017",
    serialNum: 17,
    name: "BTC funding capture",
    type: "funding",
    variant: "Same venue",
    asset: "BTC",
    venues: "Binance",
    status: "closed",
    capital: 12800,
    daysHeld: 8,
    daysLabel: "8d",
    closedAt: "2026-01-12",
    closedLabel: "Jan 12",
    headlineNum: 6.4,
    headlineLabel: "+6.4%",
    headlineUnit: "APR",
    tone: "up",
    netPnl: 17.95,
    note: "first trade of year",
    href: "/spreads/demo",
  },
];

// ─── Formatting helpers ────────────────────────────────────────────────────────

export function fmtUsd(n: number, signed = false, fractionDigits = 2): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

export function fmtCapital(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ─── Derived queries ───────────────────────────────────────────────────────────

export function getRecentCloses(n: number): ArchiveRow[] {
  return [...ARCHIVE_DATA]
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt))
    .slice(0, n);
}

export interface ArchiveTotals {
  count: number;
  net: number;
  winners: number;
  losers: number;
  winRate: number;
  best: ArchiveRow;
  worst: ArchiveRow;
  firstClose: string;
  lastClose: string;
}

export function getTotals(rows: ArchiveRow[] = ARCHIVE_DATA): ArchiveTotals {
  const net = rows.reduce((s, r) => s + r.netPnl, 0);
  const winners = rows.filter((r) => r.netPnl > 0).length;
  const losers = rows.filter((r) => r.netPnl < 0).length;
  const winRate = rows.length ? (winners / rows.length) * 100 : 0;
  const best = rows.reduce((b, r) => (r.netPnl > b.netPnl ? r : b), rows[0]);
  const worst = rows.reduce((w, r) => (r.netPnl < w.netPnl ? r : w), rows[0]);
  const closedDates = rows.map((r) => r.closedAt).sort();
  return {
    count: rows.length,
    net,
    winners,
    losers,
    winRate,
    best,
    worst,
    firstClose: closedDates[0] ?? "",
    lastClose: closedDates[closedDates.length - 1] ?? "",
  };
}
