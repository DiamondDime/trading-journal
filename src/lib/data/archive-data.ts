// Fixture dataset for the journal's closed-activity feed. Covers all four
// activity types (spread / trade / sale / airdrop) the v1 product ships with.
// Replaced by a `v_activity_feed` DB query once Phase 5/8 read paths land.

export type ActivityType = "spread" | "trade" | "sale" | "airdrop";

export type SpreadType =
  | "cash_carry"
  | "calendar"
  | "funding"
  | "cross_exchange"
  | "dex_cex";

export type Asset = "BTC" | "ETH" | "SOL" | "PEPE" | "EIGEN" | "W" | "ZETA" | "JUP" | "ARB" | "PYTH";

// Status union covers every activity type's terminal states. Open/pending
// states aren't in the closed-activity feed (the matcher pipeline tracks
// those separately).
export type ActivityStatus = "closed" | "expired" | "claimed" | "vested";

// Headline units: spread/trade headline a realized APR; sale/airdrop a
// mark-to-market multiplier (current_value / cost_basis).
export type HeadlineKind = "APR" | "BPS" | "BPS/D" | "MTM";

export interface BaseActivity {
  id: string;              // stable key
  type: ActivityType;
  serial: string;          // "#032"
  serialNum: number;
  name: string;
  status: ActivityStatus;
  capital: number;
  daysHeld: number;
  daysLabel: string;
  closedAt: string;        // YYYY-MM-DD
  closedLabel: string;
  netPnl: number;
  headlineKind: HeadlineKind;
  headlineNum: number;
  headlineLabel: string;
  tone: "up" | "down";
  regimeTags: string[];
  note: string;
  href: string;
}

export interface SpreadRow extends BaseActivity {
  type: "spread";
  spreadType: SpreadType;
  variant: string;
  asset: Asset;
  venues: string;
}

export interface TradeRow extends BaseActivity {
  type: "trade";
  symbol: string;          // "BTC-PERP"
  exchange: string;        // "Binance"
  side: "long" | "short";
  instrument: "perp" | "spot" | "future";
  asset: Asset;
}

export interface SaleRow extends BaseActivity {
  type: "sale";
  asset: Asset;            // token symbol
  saleKind: "ido" | "launchpad" | "premarket" | "otc";
  venue: string;           // launchpad name / OTC desk
  multiplier: number;      // mtm × (e.g. 3.8)
}

export interface AirdropRow extends BaseActivity {
  type: "airdrop";
  asset: Asset;
  protocol: string;
  multiplier: number;      // mtm × at current price (vs value at receipt)
}

export type Activity = SpreadRow | TradeRow | SaleRow | AirdropRow;

// Back-compat aliases so existing archive UI keeps compiling while we widen
// the dataset. New callers should prefer Activity / ActivityStatus.
export type SpreadStatus = ActivityStatus;
export type ArchiveRow = Activity;
export type HeadlineUnit = HeadlineKind;

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  spread: "Spread",
  trade: "Trade",
  sale: "Sale",
  airdrop: "Airdrop",
};

export const SPREAD_TYPE_LABELS: Record<SpreadType, string> = {
  cash_carry: "Cash-and-carry",
  calendar: "Calendar",
  funding: "Funding capture",
  cross_exchange: "Cross-exchange",
  dex_cex: "DEX-CEX",
};

export const STATUS_STYLES: Record<ActivityStatus, { dot: string; label: string }> = {
  closed: { dot: "bg-text-tertiary", label: "Closed" },
  expired: { dot: "bg-text-tertiary", label: "Expired" },
  claimed: { dot: "bg-text-tertiary", label: "Claimed" },
  vested: { dot: "bg-text-tertiary", label: "Vested" },
};

// ─── Spreads (16, unchanged from prior fixture beyond `type` + `id` fields) ─────
const SPREADS: SpreadRow[] = [
  {
    id: "sp-032",
    type: "spread",
    serial: "#032",
    serialNum: 32,
    name: "BTC cash-and-carry",
    spreadType: "cash_carry",
    variant: "Funding",
    asset: "BTC",
    venues: "Bitmex + Coinbase",
    status: "closed",
    capital: 47300,
    daysHeld: 73,
    daysLabel: "73d",
    closedAt: "2026-03-28",
    closedLabel: "Mar 28",
    headlineKind: "APR",
    headlineNum: 14.0,
    headlineLabel: "+14.0%",
    tone: "up",
    netPnl: 1314.40,
    regimeTags: ["funding-positive"],
    note: "−21% vs target",
    href: "/spreads/demo",
  },
  {
    id: "sp-031",
    type: "spread",
    serial: "#031",
    serialNum: 31,
    name: "BTC calendar",
    spreadType: "calendar",
    variant: "Sep-26 / Dec-26",
    asset: "BTC",
    venues: "Deribit",
    status: "closed",
    capital: 3140,
    daysHeld: 32,
    daysLabel: "32d",
    closedAt: "2026-04-15",
    closedLabel: "Apr 15",
    headlineKind: "BPS/D",
    headlineNum: 152,
    headlineLabel: "+152",
    tone: "up",
    netPnl: 1528.00,
    regimeTags: ["contango"],
    note: "contango widening",
    href: "/spreads/demo",
  },
  {
    id: "sp-030",
    type: "spread",
    serial: "#030",
    serialNum: 30,
    name: "ETH funding capture",
    spreadType: "funding",
    variant: "Same venue",
    asset: "ETH",
    venues: "Bybit",
    status: "closed",
    capital: 30840,
    daysHeld: 19,
    daysLabel: "19d",
    closedAt: "2026-04-20",
    closedLabel: "Apr 20",
    headlineKind: "APR",
    headlineNum: 11.3,
    headlineLabel: "+11.3%",
    tone: "up",
    netPnl: 181.20,
    regimeTags: ["funding-positive"],
    note: "−18% vs target",
    href: "/spreads/demo",
  },
  {
    id: "sp-029",
    type: "spread",
    serial: "#029",
    serialNum: 29,
    name: "BTC perp arbitrage",
    spreadType: "cross_exchange",
    variant: "Perp arb",
    asset: "BTC",
    venues: "Binance / Bybit",
    status: "closed",
    capital: 5420,
    daysHeld: 0.0326,
    daysLabel: "47 min",
    closedAt: "2026-04-25",
    closedLabel: "Apr 25",
    headlineKind: "BPS",
    headlineNum: 4.3,
    headlineLabel: "+4.3",
    tone: "up",
    netPnl: 23.30,
    regimeTags: [],
    note: "clean exit",
    href: "/spreads/demo",
  },
  {
    id: "sp-028",
    type: "spread",
    serial: "#028",
    serialNum: 28,
    name: "BTC cash-and-carry",
    spreadType: "cash_carry",
    variant: "Basis",
    asset: "BTC",
    venues: "Deribit Mar-26 + Bybit",
    status: "expired",
    capital: 62500,
    daysHeld: 79,
    daysLabel: "79d",
    closedAt: "2026-03-26",
    closedLabel: "Mar 26",
    headlineKind: "APR",
    headlineNum: 7.9,
    headlineLabel: "+7.9%",
    tone: "up",
    netPnl: 1067.50,
    regimeTags: ["contango"],
    note: "held to expiry",
    href: "/spreads/demo",
  },
  {
    id: "sp-027",
    type: "spread",
    serial: "#027",
    serialNum: 27,
    name: "PEPE DEX-CEX",
    spreadType: "dex_cex",
    variant: "DEX-CEX",
    asset: "PEPE",
    venues: "OKX DEX + OKX perp",
    status: "closed",
    capital: 8420,
    daysHeld: 0.458,
    daysLabel: "11h",
    closedAt: "2026-04-26",
    closedLabel: "Apr 26",
    headlineKind: "BPS",
    headlineNum: -59,
    headlineLabel: "−59",
    tone: "down",
    netPnl: -49.68,
    regimeTags: [],
    note: "gas killed it",
    href: "/spreads/demo",
  },
  {
    id: "sp-026",
    type: "spread",
    serial: "#026",
    serialNum: 26,
    name: "ETH funding capture",
    spreadType: "funding",
    variant: "Cross venue",
    asset: "ETH",
    venues: "Binance / OKX",
    status: "closed",
    capital: 22400,
    daysHeld: 14,
    daysLabel: "14d",
    closedAt: "2026-05-07",
    closedLabel: "May 7",
    headlineKind: "APR",
    headlineNum: 18.2,
    headlineLabel: "+18.2%",
    tone: "up",
    netPnl: 156.32,
    regimeTags: ["funding-positive"],
    note: "funding inversion",
    href: "/spreads/demo",
  },
  {
    id: "sp-025",
    type: "spread",
    serial: "#025",
    serialNum: 25,
    name: "BTC perp arbitrage",
    spreadType: "cross_exchange",
    variant: "Perp arb",
    asset: "BTC",
    venues: "Bybit / OKX",
    status: "closed",
    capital: 4180,
    daysHeld: 0.0153,
    daysLabel: "22 min",
    closedAt: "2026-05-14",
    closedLabel: "May 14",
    headlineKind: "BPS",
    headlineNum: 7.1,
    headlineLabel: "+7.1",
    tone: "up",
    netPnl: 29.68,
    regimeTags: [],
    note: "widened spread",
    href: "/spreads/demo",
  },
  {
    id: "sp-024",
    type: "spread",
    serial: "#024",
    serialNum: 24,
    name: "ETH cash-and-carry",
    spreadType: "cash_carry",
    variant: "Funding",
    asset: "ETH",
    venues: "Binance + Coinbase",
    status: "closed",
    capital: 28900,
    daysHeld: 42,
    daysLabel: "42d",
    closedAt: "2026-02-18",
    closedLabel: "Feb 18",
    headlineKind: "APR",
    headlineNum: 12.6,
    headlineLabel: "+12.6%",
    tone: "up",
    netPnl: 418.00,
    regimeTags: ["funding-positive"],
    note: "regime flip exit",
    href: "/spreads/demo",
  },
  {
    id: "sp-023",
    type: "spread",
    serial: "#023",
    serialNum: 23,
    name: "BTC funding capture",
    spreadType: "funding",
    variant: "Same venue",
    asset: "BTC",
    venues: "Hyperliquid",
    status: "closed",
    capital: 18500,
    daysHeld: 9,
    daysLabel: "9d",
    closedAt: "2026-02-04",
    closedLabel: "Feb 4",
    headlineKind: "APR",
    headlineNum: 8.4,
    headlineLabel: "+8.4%",
    tone: "up",
    netPnl: 38.32,
    regimeTags: ["funding-positive"],
    note: "early take",
    href: "/spreads/demo",
  },
  {
    id: "sp-022",
    type: "spread",
    serial: "#022",
    serialNum: 22,
    name: "BTC perp arbitrage",
    spreadType: "cross_exchange",
    variant: "Perp arb",
    asset: "BTC",
    venues: "Binance / OKX",
    status: "closed",
    capital: 6300,
    daysHeld: 0.0514,
    daysLabel: "1h 14m",
    closedAt: "2026-01-26",
    closedLabel: "Jan 26",
    headlineKind: "BPS",
    headlineNum: 9.2,
    headlineLabel: "+9.2",
    tone: "up",
    netPnl: 57.96,
    regimeTags: [],
    note: "mean-reversion",
    href: "/spreads/demo",
  },
  {
    id: "sp-021",
    type: "spread",
    serial: "#021",
    serialNum: 21,
    name: "SOL cash-and-carry",
    spreadType: "cash_carry",
    variant: "Funding",
    asset: "SOL",
    venues: "Bybit + Binance",
    status: "closed",
    capital: 14200,
    daysHeld: 24,
    daysLabel: "24d",
    closedAt: "2026-02-22",
    closedLabel: "Feb 22",
    headlineKind: "APR",
    headlineNum: -2.1,
    headlineLabel: "−2.1%",
    tone: "down",
    netPnl: -19.61,
    regimeTags: ["funding-negative"],
    note: "funding inverted",
    href: "/spreads/demo",
  },
  {
    id: "sp-020",
    type: "spread",
    serial: "#020",
    serialNum: 20,
    name: "BTC calendar",
    spreadType: "calendar",
    variant: "Mar-26 / Jun-26",
    asset: "BTC",
    venues: "Deribit",
    status: "closed",
    capital: 9500,
    daysHeld: 27,
    daysLabel: "27d",
    closedAt: "2026-03-02",
    closedLabel: "Mar 2",
    headlineKind: "BPS/D",
    headlineNum: 98,
    headlineLabel: "+98",
    tone: "up",
    netPnl: 251.10,
    regimeTags: ["contango"],
    note: "contango softened",
    href: "/spreads/demo",
  },
  {
    id: "sp-019",
    type: "spread",
    serial: "#019",
    serialNum: 19,
    name: "ETH funding capture",
    spreadType: "funding",
    variant: "Cross venue",
    asset: "ETH",
    venues: "Bybit / Binance",
    status: "closed",
    capital: 16200,
    daysHeld: 11,
    daysLabel: "11d",
    closedAt: "2026-01-28",
    closedLabel: "Jan 28",
    headlineKind: "APR",
    headlineNum: 14.8,
    headlineLabel: "+14.8%",
    tone: "up",
    netPnl: 72.32,
    regimeTags: ["funding-positive"],
    note: "cross-venue arb",
    href: "/spreads/demo",
  },
  {
    id: "sp-018",
    type: "spread",
    serial: "#018",
    serialNum: 18,
    name: "BTC cash-and-carry",
    spreadType: "cash_carry",
    variant: "Funding",
    asset: "BTC",
    venues: "Bitmex + Kraken",
    status: "closed",
    capital: 35400,
    daysHeld: 21,
    daysLabel: "21d",
    closedAt: "2026-01-18",
    closedLabel: "Jan 18",
    headlineKind: "APR",
    headlineNum: 9.7,
    headlineLabel: "+9.7%",
    tone: "up",
    netPnl: 197.50,
    regimeTags: ["funding-positive"],
    note: "ETF inflow trade",
    href: "/spreads/demo",
  },
  {
    id: "sp-017",
    type: "spread",
    serial: "#017",
    serialNum: 17,
    name: "BTC funding capture",
    spreadType: "funding",
    variant: "Same venue",
    asset: "BTC",
    venues: "Binance",
    status: "closed",
    capital: 12800,
    daysHeld: 8,
    daysLabel: "8d",
    closedAt: "2026-01-12",
    closedLabel: "Jan 12",
    headlineKind: "APR",
    headlineNum: 6.4,
    headlineLabel: "+6.4%",
    tone: "up",
    netPnl: 17.95,
    regimeTags: ["funding-positive"],
    note: "first trade of year",
    href: "/spreads/demo",
  },
];

// ─── Trades (5) ─────────────────────────────────────────────────────────────────
const TRADES: TradeRow[] = [
  {
    id: "tr-005",
    type: "trade",
    serial: "T#005",
    serialNum: 105,
    name: "BTC long · swing",
    symbol: "BTC-PERP",
    exchange: "Binance",
    side: "long",
    instrument: "perp",
    asset: "BTC",
    status: "closed",
    capital: 24800,
    daysHeld: 11,
    daysLabel: "11d",
    closedAt: "2026-05-09",
    closedLabel: "May 9",
    headlineKind: "APR",
    headlineNum: 38.4,
    headlineLabel: "+38.4%",
    tone: "up",
    netPnl: 824.10,
    regimeTags: ["risk-on"],
    note: "ETF inflow continuation",
    href: "/spreads/demo",
  },
  {
    id: "tr-004",
    type: "trade",
    serial: "T#004",
    serialNum: 104,
    name: "ETH momentum",
    symbol: "ETH-PERP",
    exchange: "Bybit",
    side: "long",
    instrument: "perp",
    asset: "ETH",
    status: "closed",
    capital: 14200,
    daysHeld: 4,
    daysLabel: "4d",
    closedAt: "2026-04-28",
    closedLabel: "Apr 28",
    headlineKind: "APR",
    headlineNum: 92.1,
    headlineLabel: "+92.1%",
    tone: "up",
    netPnl: 442.30,
    regimeTags: ["risk-on"],
    note: "Pectra catalyst",
    href: "/spreads/demo",
  },
  {
    id: "tr-003",
    type: "trade",
    serial: "T#003",
    serialNum: 103,
    name: "SOL breakout",
    symbol: "SOL-PERP",
    exchange: "Hyperliquid",
    side: "long",
    instrument: "perp",
    asset: "SOL",
    status: "closed",
    capital: 8600,
    daysHeld: 2,
    daysLabel: "2d",
    closedAt: "2026-04-12",
    closedLabel: "Apr 12",
    headlineKind: "APR",
    headlineNum: 156.0,
    headlineLabel: "+156.0%",
    tone: "up",
    netPnl: 318.40,
    regimeTags: ["risk-on"],
    note: "$190 resistance break",
    href: "/spreads/demo",
  },
  {
    id: "tr-002",
    type: "trade",
    serial: "T#002",
    serialNum: 102,
    name: "BTC short · failed",
    symbol: "BTC-PERP",
    exchange: "Bybit",
    side: "short",
    instrument: "perp",
    asset: "BTC",
    status: "closed",
    capital: 11400,
    daysHeld: 1.5,
    daysLabel: "1d 12h",
    closedAt: "2026-03-15",
    closedLabel: "Mar 15",
    headlineKind: "APR",
    headlineNum: -84.2,
    headlineLabel: "−84.2%",
    tone: "down",
    netPnl: -312.20,
    regimeTags: ["short-squeeze"],
    note: "stop hit on squeeze",
    href: "/spreads/demo",
  },
  {
    id: "tr-001",
    type: "trade",
    serial: "T#001",
    serialNum: 101,
    name: "ETH leverage scalp",
    symbol: "ETH-PERP",
    exchange: "Binance",
    side: "long",
    instrument: "perp",
    asset: "ETH",
    status: "closed",
    capital: 3200,
    daysHeld: 0.014,
    daysLabel: "20 min",
    closedAt: "2026-02-28",
    closedLabel: "Feb 28",
    headlineKind: "APR",
    headlineNum: 11.4,
    headlineLabel: "+11.4%",
    tone: "up",
    netPnl: 28.50,
    regimeTags: [],
    note: "session high reject",
    href: "/spreads/demo",
  },
];

// ─── Sales (3) ──────────────────────────────────────────────────────────────────
const SALES: SaleRow[] = [
  {
    id: "sa-003",
    type: "sale",
    serial: "S#003",
    serialNum: 203,
    name: "EigenLayer launchpad",
    asset: "EIGEN",
    saleKind: "launchpad",
    venue: "Binance Launchpool",
    status: "vested",
    capital: 5000,
    daysHeld: 124,
    daysLabel: "124d",
    closedAt: "2026-05-12",
    closedLabel: "May 12",
    headlineKind: "MTM",
    multiplier: 3.8,
    headlineNum: 3.8,
    headlineLabel: "3.8×",
    tone: "up",
    netPnl: 14000.00,
    regimeTags: ["restaking-narrative"],
    note: "TGE pop held",
    href: "/spreads/demo",
  },
  {
    id: "sa-002",
    type: "sale",
    serial: "S#002",
    serialNum: 202,
    name: "Wormhole IDO",
    asset: "W",
    saleKind: "ido",
    venue: "CoinList",
    status: "vested",
    capital: 2500,
    daysHeld: 89,
    daysLabel: "89d",
    closedAt: "2026-04-18",
    closedLabel: "Apr 18",
    headlineKind: "MTM",
    multiplier: 1.2,
    headlineNum: 1.2,
    headlineLabel: "1.2×",
    tone: "up",
    netPnl: 500.00,
    regimeTags: ["interop-narrative"],
    note: "cliff bled most upside",
    href: "/spreads/demo",
  },
  {
    id: "sa-001",
    type: "sale",
    serial: "S#001",
    serialNum: 201,
    name: "ZetaChain premarket",
    asset: "ZETA",
    saleKind: "premarket",
    venue: "Whales Market",
    status: "vested",
    capital: 1800,
    daysHeld: 52,
    daysLabel: "52d",
    closedAt: "2026-03-22",
    closedLabel: "Mar 22",
    headlineKind: "MTM",
    multiplier: 0.6,
    headlineNum: 0.6,
    headlineLabel: "0.6×",
    tone: "down",
    netPnl: -720.00,
    regimeTags: ["risk-off"],
    note: "TGE dump below entry",
    href: "/spreads/demo",
  },
];

// ─── Airdrops (3) ───────────────────────────────────────────────────────────────
const AIRDROPS: AirdropRow[] = [
  {
    id: "ad-003",
    type: "airdrop",
    serial: "A#003",
    serialNum: 303,
    name: "Pyth retro drop",
    asset: "PYTH",
    protocol: "Pyth Network",
    status: "claimed",
    capital: 0,
    daysHeld: 218,
    daysLabel: "218d",
    closedAt: "2026-05-05",
    closedLabel: "May 5",
    headlineKind: "MTM",
    multiplier: 2.1,
    headlineNum: 2.1,
    headlineLabel: "2.1×",
    tone: "up",
    netPnl: 4620.00,
    regimeTags: ["oracle-narrative"],
    note: "claim-and-hold",
    href: "/spreads/demo",
  },
  {
    id: "ad-002",
    type: "airdrop",
    serial: "A#002",
    serialNum: 302,
    name: "Jupiter retro drop",
    asset: "JUP",
    protocol: "Jupiter",
    status: "claimed",
    capital: 0,
    daysHeld: 162,
    daysLabel: "162d",
    closedAt: "2026-03-08",
    closedLabel: "Mar 8",
    headlineKind: "MTM",
    multiplier: 1.4,
    headlineNum: 1.4,
    headlineLabel: "1.4×",
    tone: "up",
    netPnl: 1680.00,
    regimeTags: ["solana-narrative"],
    note: "claimed at peak +40%",
    href: "/spreads/demo",
  },
  {
    id: "ad-001",
    type: "airdrop",
    serial: "A#001",
    serialNum: 301,
    name: "Arbitrum delayed drop",
    asset: "ARB",
    protocol: "Arbitrum",
    status: "claimed",
    capital: 0,
    daysHeld: 305,
    daysLabel: "305d",
    closedAt: "2026-02-10",
    closedLabel: "Feb 10",
    headlineKind: "MTM",
    multiplier: 0.9,
    headlineNum: 0.9,
    headlineLabel: "0.9×",
    tone: "down",
    netPnl: -240.00,
    regimeTags: ["L2-narrative"],
    note: "drifted under entry",
    href: "/spreads/demo",
  },
];

// Compute the destination route per activity type. Each row's stored `href`
// is patched through this so detail-page routing is the single source of truth.
// Spreads still point at the editorial demo template until their own dynamic
// route lands in a later chunk.
export function getActivityHref(a: Activity): string {
  switch (a.type) {
    case "trade":
      return `/trades/${a.id}`;
    case "spread":
      return `/spreads/${a.id}`;
    case "sale":
      return `/sales/${a.id}`;
    case "airdrop":
      return `/airdrops/${a.id}`;
  }
}

export const ARCHIVE_DATA: Activity[] = [
  ...SPREADS,
  ...TRADES,
  ...SALES,
  ...AIRDROPS,
].map((a) => ({ ...a, href: getActivityHref(a) } as Activity));

export function getActivityById(id: string): Activity | undefined {
  return ARCHIVE_DATA.find((a) => a.id === id);
}

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

export function getRecentCloses(n: number): Activity[] {
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
  best: Activity;
  worst: Activity;
  firstClose: string;
  lastClose: string;
  capital: number;
  weightedReturnPct: number;
}

// A "winner" for MTM-headlined activities (sales/airdrops) means
// multiplier > 1.0 — net_pnl already encodes the same notion, so a single
// `netPnl > 0` test covers all four types.
export function getTotals(rows: Activity[] = ARCHIVE_DATA): ArchiveTotals {
  const net = rows.reduce((s, r) => s + r.netPnl, 0);
  const winners = rows.filter((r) => r.netPnl > 0).length;
  const losers = rows.filter((r) => r.netPnl < 0).length;
  const winRate = rows.length ? (winners / rows.length) * 100 : 0;
  const best = rows.reduce((b, r) => (r.netPnl > b.netPnl ? r : b), rows[0]);
  const worst = rows.reduce((w, r) => (r.netPnl < w.netPnl ? r : w), rows[0]);
  const closedDates = rows.map((r) => r.closedAt).sort();
  const capital = rows.reduce((s, r) => s + r.capital, 0);
  // Capital-weighted realized return — airdrops (capital=0) contribute only
  // through `net`. The denominator excludes them so the metric is a clean
  // dollar-yield-per-dollar-deployed for paid activities.
  const paidCapital = rows
    .filter((r) => r.capital > 0)
    .reduce((s, r) => s + r.capital, 0);
  const paidNet = rows
    .filter((r) => r.capital > 0)
    .reduce((s, r) => s + r.netPnl, 0);
  const weightedReturnPct = paidCapital > 0 ? (paidNet / paidCapital) * 100 : 0;
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
    capital,
    weightedReturnPct,
  };
}

export function getActivityTypeCounts(rows: Activity[] = ARCHIVE_DATA): Record<ActivityType, number> {
  const counts: Record<ActivityType, number> = { spread: 0, trade: 0, sale: 0, airdrop: 0 };
  rows.forEach((r) => { counts[r.type] += 1; });
  return counts;
}

export function getActivityTypeNetPnl(rows: Activity[] = ARCHIVE_DATA): Record<ActivityType, number> {
  const net: Record<ActivityType, number> = { spread: 0, trade: 0, sale: 0, airdrop: 0 };
  rows.forEach((r) => { net[r.type] += r.netPnl; });
  return net;
}
