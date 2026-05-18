/**
 * Balance tracker types — TS mirror of `worker/csj_worker/types.py` +
 * the `exchange_balances` / `portfolio_snapshots` schemas (migration v6).
 *
 * All quantity / USD values are strings. The DB returns NUMERIC as a string
 * via postgres.js; we keep them strings end-to-end to dodge float coercion.
 * The UI converts at render-time via `decimal.js` or the formatter helpers
 * in `src/lib/data/archive-data.ts`.
 *
 * Wave: v6 (2026-05-18).
 */
import type {
  Iso8601,
  Decimal as DecimalStr,
  UserId,
  ConnectionId,
} from "@/types/canonical";

/**
 * Wallet bucket on a venue. Worker emits these canonical values; new venue
 * quirks (Binance Earn-Flexible, etc.) get mapped to one of these in the
 * adapter layer. Stored as `text` in Postgres — see migration v6.
 */
export const WalletType = {
  SPOT:             "spot",
  MARGIN:           "margin",
  CROSS_MARGIN:     "cross_margin",
  ISOLATED_MARGIN:  "isolated_margin",
  FUTURES:          "futures",
  EARN:             "earn",
  FUNDING:          "funding",
} as const;
export type WalletType = typeof WalletType[keyof typeof WalletType];

/**
 * Source tag on a balance row. `worker` = auto-fetched; `manual` = the user
 * overrode the value via the UI. The worker preserves `manual` rows on its
 * next pass — that's the contract the v6 migration encodes in the UPSERT.
 */
export const BalanceSource = {
  WORKER: "worker",
  MANUAL: "manual",
} as const;
export type BalanceSource = typeof BalanceSource[keyof typeof BalanceSource];

/**
 * Source tag on a portfolio snapshot row. Lets the dashboard differentiate
 * the hourly cron (`scheduled`), a refresh-button click (`manual_refresh`),
 * and the post-sync auto-snapshot (`event_driven`) when the user inspects
 * the history.
 */
export const SnapshotSource = {
  SCHEDULED:      "scheduled",
  MANUAL_REFRESH: "manual_refresh",
  EVENT_DRIVEN:   "event_driven",
} as const;
export type SnapshotSource = typeof SnapshotSource[keyof typeof SnapshotSource];

/**
 * One row from `public.exchange_balances`. Mirrors the table 1:1 (camelCase
 * via the postgres.js transform).
 */
export interface ExchangeBalance {
  id: string;
  userId: UserId;
  exchangeConnectionId: ConnectionId;
  walletType: WalletType;
  asset: string;        // uppercase canonical code (BTC, USDT, ...)
  chain: string | null; // ERC20 / BSC / TRC20 / null for unified
  total: DecimalStr;
  available: DecimalStr;
  locked: DecimalStr;
  borrowed: DecimalStr;
  usdPrice: DecimalStr | null;
  usdValue: DecimalStr | null;
  snapshotAt: Iso8601;
  source: BalanceSource;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

/**
 * One row from `public.portfolio_snapshots`. Decimals inside `byExchange` /
 * `byAsset` / `byChain` are STRING values inside the jsonb blob — see the
 * migration's column comment for the rationale. The TS layer treats them as
 * `Record<string, DecimalStr>`.
 */
export interface PortfolioSnapshot {
  id: string;
  userId: UserId;
  snapshotAt: Iso8601;
  totalUsd: DecimalStr;
  totalStableUsd: DecimalStr;
  totalVolatileUsd: DecimalStr;
  byExchange: Record<string, DecimalStr>;
  byAsset: Record<string, DecimalStr>;
  byChain: Record<string, DecimalStr> | null;
  driftFromFillsUsd: DecimalStr | null;
  source: SnapshotSource;
  createdAt: Iso8601;
}

/**
 * Shape of `GET /api/balances`. The dashboard page consumes this and renders
 * the hero / per-asset table / per-exchange cards directly off it — no
 * post-fetch shaping in the components.
 */
export interface BalancesResponse {
  totalUsd: DecimalStr;
  stableUsd: DecimalStr;
  volatileUsd: DecimalStr;
  /** Per-exchange rollup — one row per connected venue. */
  byExchange: BalanceByExchange[];
  /** Per-asset rollup — sorted desc by usdValue at the API edge. */
  byAsset: BalanceByAsset[];
  /** Newest snapshot timestamp across all balance rows. ISO-8601. */
  snapshotAt: Iso8601 | null;
  /** 24-hour delta in USD (positive = up). Null when no prior snapshot exists. */
  delta24hUsd: DecimalStr | null;
  /** 7-day delta in USD. Null when there's no snapshot ≥7d old. */
  delta7dUsd: DecimalStr | null;
  /** Per-asset drift flags so the dashboard can render the warning banner. */
  drift: DriftHint[];
}

export interface BalanceByExchange {
  exchange: string;          // display name ("Binance")
  exchangeCode: string;      // catalog code ("binance")
  connectionId: ConnectionId;
  label: string;             // user-chosen label
  totalUsd: DecimalStr;
  walletCount: number;       // distinct wallet_type rows for this connection
  assetCount: number;        // distinct assets for this connection
}

export interface BalanceByAsset {
  asset: string;
  totalQty: DecimalStr;
  totalUsd: DecimalStr | null;
  usdPrice: DecimalStr | null;
  /** Per-exchange breakdown for the asset (used for tooltips). */
  exchanges: { exchangeCode: string; exchange: string; qty: DecimalStr; usdValue: DecimalStr | null }[];
  /** Is this asset in the stablecoin allow-list (kept in sync with prices.py)? */
  isStable: boolean;
}

export interface DriftHint {
  asset: string;
  reportedQty: DecimalStr;
  expectedQty: DecimalStr;
  driftQty: DecimalStr;
  /** Drift as a fraction of reported (e.g. 0.012 = 1.2%). Always positive. */
  driftPct: number;
  /** Approximate USD value of the drift, using the most recent USD price. */
  driftUsd: DecimalStr | null;
}

/**
 * Shape of `GET /api/balances/snapshot?range=...`. Time series for the
 * portfolio-history chart.
 */
export interface SnapshotSeriesResponse {
  points: SnapshotPoint[];
}

export interface SnapshotPoint {
  snapshotAt: Iso8601;
  totalUsd: DecimalStr;
  stableUsd: DecimalStr;
  volatileUsd: DecimalStr;
  source: SnapshotSource;
}

/**
 * Body the `POST /api/balances/refresh` endpoint returns. Mirrors the
 * worker HTTP server's `RefreshBalancesResponse` 1:1 plus an optional
 * `requestedAt` field stamped by the Next.js handler.
 */
export interface RefreshBalancesResponse {
  ok: boolean;
  connections: number;
  upserted: number;
  reaped: number;
  snapshots: number;
  errors: number;
  message?: string | null;
  requestedAt: Iso8601;
}

/**
 * Stablecoin allow-list — MUST stay byte-for-byte in sync with
 * `STABLECOINS` in `worker/csj_worker/prices.py`. Used by the UI to decide
 * styling (stables get the muted "neutral" tone, volatiles get the
 * signature amber on positive delta).
 */
export const STABLECOINS: ReadonlySet<string> = new Set([
  "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "USD",
  "USDD", "UST",
]);

/**
 * Pure helper — does this asset belong in the stablecoin pool? Used by
 * the dashboard for the stable / volatile split and the drift banner.
 */
export function isStableAsset(asset: string): boolean {
  return STABLECOINS.has(asset.toUpperCase());
}

