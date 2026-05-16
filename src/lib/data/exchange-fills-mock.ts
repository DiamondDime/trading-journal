// Mock dataset of "imported fills" that the trade picker shows when the user
// chooses the "from connected exchange" branch. Replaced by a real query
// against the `position` table once the Phase 5 ingestion worker is wired.
//
// Each row is shaped like a one-venue Position (a Trade is a journaled
// Position), so the picker can pre-fill the next step's form.

export type ImportedTradeFill = {
  /** Stable mock id. */
  id: string;
  exchange: "Binance" | "Bybit" | "Hyperliquid" | "Coinbase" | "OKX";
  symbol: string;
  instrument: "perp" | "spot" | "future";
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  exitPrice: number;
  capital: number;
  fees: number;
  netPnl: number;
  openedAt: string;  // YYYY-MM-DDTHH:mm  — datetime-local compatible
  closedAt: string;
  daysHeld: number;
  daysLabel: string;
  closedLabel: string;
  tone: "up" | "down";
};

export const IMPORTED_FILLS: ImportedTradeFill[] = [
  {
    id: "fill-bn-001",
    exchange: "Binance",
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
];

export function getImportedFillById(
  id: string
): ImportedTradeFill | undefined {
  return IMPORTED_FILLS.find((f) => f.id === id);
}
