// Mock dataset of "imported fills" that the trade picker shows when the user
// chooses the "from connected exchange" branch. Replaced by a real query
// against the `position` table once the Phase 5 ingestion worker is wired.
//
// Each row is shaped like a one-venue Position (a Trade is a journaled
// Position), so the picker can pre-fill the next step's form.
//
// The Spread wizard's unified picker also reads this list — the matcher
// (`src/lib/matcher/spread-matcher.ts`) groups these fills into suggested
// multi-leg spreads. To exercise every matcher rule on demo data, this
// fixture is intentionally seeded with:
//   • a BTC perp short on Binance + BTC spot long on Coinbase (cash-and-carry)
//   • a BTC perp long on Binance vs BTC perp short on Bybit (cross-exchange)
//   • an ETH spot long + ETH perp short on Bybit (same-venue funding capture)
//   • two BTC dated futures on Deribit with different expiries (calendar)
//   • a SOL spot long on Coinbase + SOL perp short on Hyperliquid DEX (dex-cex)
//
// Real production data will come from `position`/`fill` tables once Phase 5
// (ingestion worker) is wired up.

export type ImportedTradeFill = {
  /** Stable mock id. */
  id: string;
  exchange:
    | "Binance"
    | "Bybit"
    | "Hyperliquid"
    | "Coinbase"
    | "OKX"
    | "Deribit";
  /** Distinguishes centralised venues (Binance, Bybit, Coinbase, OKX, Deribit)
   *  from on-chain venues (Hyperliquid). The DEX-CEX matcher rule relies on
   *  this — Hyperliquid is the only DEX in v1's connected-exchange set. */
  venueKind: "cex" | "dex";
  /** Base asset symbol (e.g. "BTC", "ETH"). Derived for the matcher so we
   *  don't have to parse "BTC-PERP" → "BTC" everywhere. */
  asset: string;
  symbol: string;
  instrument: "perp" | "spot" | "future";
  /** Expiry date (YYYY-MM-DD) for `instrument === "future"`. Only set on
   *  dated futures — the calendar matcher rule uses this to detect two
   *  futures with different expiries on the same venue. */
  expiry?: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  exitPrice: number;
  capital: number;
  fees: number;
  netPnl: number;
  openedAt: string; // YYYY-MM-DDTHH:mm  — datetime-local compatible
  closedAt: string;
  daysHeld: number;
  daysLabel: string;
  closedLabel: string;
  tone: "up" | "down";
};

export const IMPORTED_FILLS: ImportedTradeFill[] = [
  // ── Trade-pick fixtures (kept stable so /add/trade/pick deeplinks still
  // resolve). Original 8 rows from the Chunk 3 fixture. ───────────────────────
  {
    id: "fill-bn-001",
    exchange: "Binance",
    venueKind: "cex",
    asset: "BTC",
    symbol: "BTC-PERP",
    instrument: "perp",
    side: "long",
    qty: 0.42,
    entryPrice: 64200,
    exitPrice: 66380,
    capital: 27000,
    fees: 12.5,
    netPnl: 902.30,
    openedAt: "2026-05-08T14:20",
    closedAt: "2026-05-11T09:45",
    daysHeld: 2.8,
    daysLabel: "2d 19h",
    closedLabel: "May 11",
    tone: "up",
  },
  {
    id: "fill-by-002",
    exchange: "Bybit",
    venueKind: "cex",
    asset: "ETH",
    symbol: "ETH-PERP",
    instrument: "perp",
    side: "long",
    qty: 6.0,
    entryPrice: 3120,
    exitPrice: 3274,
    capital: 18700,
    fees: 9.2,
    netPnl: 915.40,
    openedAt: "2026-05-02T11:00",
    closedAt: "2026-05-06T20:15",
    daysHeld: 4.4,
    daysLabel: "4d 9h",
    closedLabel: "May 6",
    tone: "up",
  },
  {
    id: "fill-hl-003",
    exchange: "Hyperliquid",
    venueKind: "dex",
    asset: "SOL",
    symbol: "SOL-PERP",
    instrument: "perp",
    side: "long",
    qty: 38,
    entryPrice: 178.4,
    exitPrice: 196.2,
    capital: 6780,
    fees: 3.4,
    netPnl: 673.20,
    openedAt: "2026-04-29T17:30",
    closedAt: "2026-04-30T22:10",
    daysHeld: 1.2,
    daysLabel: "1d 5h",
    closedLabel: "Apr 30",
    tone: "up",
  },
  {
    id: "fill-bn-004",
    exchange: "Binance",
    venueKind: "cex",
    asset: "BTC",
    symbol: "BTC-PERP",
    instrument: "perp",
    side: "short",
    qty: 0.18,
    entryPrice: 67400,
    exitPrice: 68820,
    capital: 12200,
    fees: 6.1,
    netPnl: -262.40,
    openedAt: "2026-04-22T08:00",
    closedAt: "2026-04-23T16:45",
    daysHeld: 1.4,
    daysLabel: "1d 9h",
    closedLabel: "Apr 23",
    tone: "down",
  },
  {
    id: "fill-by-005",
    exchange: "Bybit",
    venueKind: "cex",
    asset: "PEPE",
    symbol: "PEPE-PERP",
    instrument: "perp",
    side: "long",
    qty: 14_000_000,
    entryPrice: 0.0000142,
    exitPrice: 0.0000159,
    capital: 199,
    fees: 0.6,
    netPnl: 23.20,
    openedAt: "2026-04-19T03:00",
    closedAt: "2026-04-19T15:20",
    daysHeld: 0.5,
    daysLabel: "12h",
    closedLabel: "Apr 19",
    tone: "up",
  },
  {
    id: "fill-hl-006",
    exchange: "Hyperliquid",
    venueKind: "dex",
    asset: "ETH",
    symbol: "ETH-PERP",
    instrument: "perp",
    side: "short",
    qty: 2.4,
    entryPrice: 3340,
    exitPrice: 3245,
    capital: 8000,
    fees: 4.0,
    netPnl: 224.10,
    openedAt: "2026-04-14T12:00",
    closedAt: "2026-04-16T09:30",
    daysHeld: 1.9,
    daysLabel: "1d 21h",
    closedLabel: "Apr 16",
    tone: "up",
  },
  {
    id: "fill-cb-007",
    exchange: "Coinbase",
    venueKind: "cex",
    asset: "BTC",
    symbol: "BTC-USD",
    instrument: "spot",
    side: "long",
    qty: 0.08,
    entryPrice: 62800,
    exitPrice: 67100,
    capital: 5024,
    fees: 18.4,
    netPnl: 326.20,
    openedAt: "2026-04-05T10:00",
    closedAt: "2026-04-21T14:15",
    daysHeld: 16.2,
    daysLabel: "16d",
    closedLabel: "Apr 21",
    tone: "up",
  },
  {
    id: "fill-ok-008",
    exchange: "OKX",
    venueKind: "cex",
    asset: "ARB",
    symbol: "ARB-PERP",
    instrument: "perp",
    side: "long",
    qty: 4_200,
    entryPrice: 0.84,
    exitPrice: 0.79,
    capital: 3528,
    fees: 1.8,
    netPnl: -211.80,
    openedAt: "2026-03-31T18:00",
    closedAt: "2026-04-02T11:30",
    daysHeld: 1.7,
    daysLabel: "1d 17h",
    closedLabel: "Apr 2",
    tone: "down",
  },

  // ── Spread-matcher fixtures (added in Chunk 5). Each pair is engineered to
  // trigger exactly one matcher rule. ─────────────────────────────────────────

  // Cash-and-carry pair #1 — BTC perp short on Binance + BTC spot long on
  // Coinbase, both closing Mar 28 within a 6h window.
  {
    id: "fill-bn-009",
    exchange: "Binance",
    venueKind: "cex",
    asset: "BTC",
    symbol: "BTC-PERP",
    instrument: "perp",
    side: "short",
    qty: 1.0,
    entryPrice: 47320,
    exitPrice: 50161,
    capital: 47324,
    fees: 18.4,
    netPnl: -2883.0,
    openedAt: "2026-01-14T09:00",
    closedAt: "2026-03-28T00:30",
    daysHeld: 73,
    daysLabel: "73d",
    closedLabel: "Mar 28",
    tone: "down",
  },
  {
    id: "fill-cb-010",
    exchange: "Coinbase",
    venueKind: "cex",
    asset: "BTC",
    symbol: "BTC-USD",
    instrument: "spot",
    side: "long",
    qty: 1.0,
    entryPrice: 47300,
    exitPrice: 50140,
    capital: 47300,
    fees: 13.6,
    netPnl: 2840.0,
    openedAt: "2026-01-14T09:04",
    closedAt: "2026-03-28T00:34",
    daysHeld: 73,
    daysLabel: "73d",
    closedLabel: "Mar 28",
    tone: "up",
  },

  // Cross-exchange pair — BTC perp long on Binance vs BTC perp short on
  // Bybit. Same asset, opposite sides, different venues, closed within
  // ~45min. The qty also matches within tolerance.
  {
    id: "fill-bn-011",
    exchange: "Binance",
    venueKind: "cex",
    asset: "BTC",
    symbol: "BTC-PERP",
    instrument: "perp",
    side: "long",
    qty: 0.08,
    entryPrice: 65120,
    exitPrice: 65148,
    capital: 5210,
    fees: 2.1,
    netPnl: 0.14,
    openedAt: "2026-04-25T14:00",
    closedAt: "2026-04-25T14:47",
    daysHeld: 0.033,
    daysLabel: "47 min",
    closedLabel: "Apr 25",
    tone: "up",
  },
  {
    id: "fill-by-012",
    exchange: "Bybit",
    venueKind: "cex",
    asset: "BTC",
    symbol: "BTC-PERP",
    instrument: "perp",
    side: "short",
    qty: 0.08,
    entryPrice: 65148,
    exitPrice: 65122,
    capital: 5212,
    fees: 2.1,
    netPnl: 23.16,
    openedAt: "2026-04-25T14:00",
    closedAt: "2026-04-25T14:47",
    daysHeld: 0.033,
    daysLabel: "47 min",
    closedLabel: "Apr 25",
    tone: "up",
  },

  // Same-venue funding capture pair — ETH spot long + ETH perp short, both
  // opened on the same day on Bybit. (Note: Bybit doesn't run a spot book
  // for v1, but their adapter abstracts both; treat as a unified venue.)
  {
    id: "fill-by-013",
    exchange: "Bybit",
    venueKind: "cex",
    asset: "ETH",
    symbol: "ETH-USDT",
    instrument: "spot",
    side: "long",
    qty: 10.0,
    entryPrice: 3210,
    exitPrice: 3274,
    capital: 32100,
    fees: 14.0,
    netPnl: 626.0,
    openedAt: "2026-04-01T08:00",
    closedAt: "2026-04-20T16:00",
    daysHeld: 19,
    daysLabel: "19d",
    closedLabel: "Apr 20",
    tone: "up",
  },
  {
    id: "fill-by-014",
    exchange: "Bybit",
    venueKind: "cex",
    asset: "ETH",
    symbol: "ETH-PERP",
    instrument: "perp",
    side: "short",
    qty: 10.0,
    entryPrice: 3208,
    exitPrice: 3270,
    capital: 32080,
    fees: 14.2,
    netPnl: -634.2,
    openedAt: "2026-04-01T08:12",
    closedAt: "2026-04-20T16:00",
    daysHeld: 19,
    daysLabel: "19d",
    closedLabel: "Apr 20",
    tone: "down",
  },

  // Calendar spread — two BTC dated futures on Deribit, near + far expiry.
  // Distinguished by the `expiry` field.
  {
    id: "fill-dr-015",
    exchange: "Deribit",
    venueKind: "cex",
    asset: "BTC",
    symbol: "BTC-26SEP26",
    instrument: "future",
    expiry: "2026-09-26",
    side: "long",
    qty: 0.10,
    entryPrice: 64800,
    exitPrice: 66120,
    capital: 6480,
    fees: 4.2,
    netPnl: 127.8,
    openedAt: "2026-02-01T10:00",
    closedAt: "2026-03-02T15:00",
    daysHeld: 30,
    daysLabel: "30d",
    closedLabel: "Mar 2",
    tone: "up",
  },
  {
    id: "fill-dr-016",
    exchange: "Deribit",
    venueKind: "cex",
    asset: "BTC",
    symbol: "BTC-26DEC26",
    instrument: "future",
    expiry: "2026-12-26",
    side: "short",
    qty: 0.10,
    entryPrice: 65900,
    exitPrice: 67020,
    capital: 6590,
    fees: 4.2,
    netPnl: -116.2,
    openedAt: "2026-02-01T10:02",
    closedAt: "2026-03-02T15:00",
    daysHeld: 30,
    daysLabel: "30d",
    closedLabel: "Mar 2",
    tone: "down",
  },

  // DEX-CEX pair — SOL spot long on Coinbase (CEX) + SOL perp short on
  // Hyperliquid (DEX). Same asset, opposite sides, one CEX + one DEX.
  {
    id: "fill-cb-017",
    exchange: "Coinbase",
    venueKind: "cex",
    asset: "SOL",
    symbol: "SOL-USD",
    instrument: "spot",
    side: "long",
    qty: 40,
    entryPrice: 178.0,
    exitPrice: 192.4,
    capital: 7120,
    fees: 24.0,
    netPnl: 552.0,
    openedAt: "2026-04-29T17:25",
    closedAt: "2026-04-30T22:08",
    daysHeld: 1.2,
    daysLabel: "1d 5h",
    closedLabel: "Apr 30",
    tone: "up",
  },
  {
    id: "fill-hl-018",
    exchange: "Hyperliquid",
    venueKind: "dex",
    asset: "SOL",
    symbol: "SOL-PERP",
    instrument: "perp",
    side: "short",
    qty: 40,
    entryPrice: 178.4,
    exitPrice: 192.6,
    capital: 7136,
    fees: 4.0,
    netPnl: -572.0,
    openedAt: "2026-04-29T17:30",
    closedAt: "2026-04-30T22:10",
    daysHeld: 1.2,
    daysLabel: "1d 5h",
    closedLabel: "Apr 30",
    tone: "down",
  },
];

export function getImportedFillById(
  id: string
): ImportedTradeFill | undefined {
  return IMPORTED_FILLS.find((f) => f.id === id);
}
