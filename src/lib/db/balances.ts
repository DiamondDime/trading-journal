/**
 * Balance tracker DB reads — Wave v6.
 *
 * Pure SELECTs. Writes are owned by the Python worker (`csj_worker.balances`)
 * which UPSERTs into `exchange_balances` + INSERTs into `portfolio_snapshots`.
 * The Next.js side never writes balance rows directly; the only mutating
 * surface from TS is the `POST /api/balances/refresh` route, which forwards
 * to the worker HTTP server.
 *
 * Reads here drive:
 *   - `/api/balances` (current state — hero, asset table, exchange cards)
 *   - `/api/balances/snapshot?range=...` (time series)
 *   - The 24h / 7d delta calculations (compare current totalUsd vs the
 *     snapshot closest to N hours ago)
 *
 * Everything is scoped to a `userId: UserId`. Local Postgres is configured
 * without RLS enforcement for the local-superuser connection (see
 * `src/lib/db/client.ts`), so we add the user_id filter explicitly here —
 * never trust a caller to pass the right user.
 *
 * Decimal handling: postgres.js returns NUMERIC as strings. We keep them as
 * strings end-to-end. The dashboard uses `decimal.js` for math at render time.
 */
import Decimal from "decimal.js";

import { sql } from "@/lib/db/client";
import type { UserId } from "@/types/canonical";
import {
  isStableAsset,
  type BalanceByAsset,
  type BalanceByExchange,
  type BalancesResponse,
  type DriftHint,
  type SnapshotPoint,
  type SnapshotSeriesResponse,
  type WalletType,
} from "@/types/balances";

// ============================================================================
// Internal row shapes (postgres.js camelCase transform)
// ============================================================================

interface LiveBalanceRow {
  asset: string;
  walletType: WalletType;
  chain: string | null;
  total: string;
  usdValue: string | null;
  usdPrice: string | null;
  snapshotAt: Date | string;
  exchangeConnectionId: string;
  exchangeCode: string;
  exchangeName: string;
  label: string;
}

interface SnapshotPointRow {
  snapshotAt: Date | string;
  totalUsd: string;
  totalStableUsd: string;
  totalVolatileUsd: string;
  source: string;
}

// Helper: postgres.js's camelCase transform returns timestamptz columns as
// `Date` instances. The API contract emits ISO strings, so we coerce at this
// boundary — every consumer above this file gets strings.
function toIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  // Already a string (shouldn't happen with postgres.js but defensive).
  return v;
}

// ============================================================================
// Live balances → BalancesResponse
// ============================================================================

/**
 * Fetch the live state for the balances dashboard. One query joins
 * exchange_balances against exchange_connections + exchange_catalog to get
 * everything needed for the hero + asset table + exchange cards in a single
 * pass. We do the aggregation in JS because the relevant decimals are
 * already strings and decimal.js handles arbitrary precision.
 *
 * Computes delta24h / delta7d from `portfolio_snapshots` — one extra query
 * to look up the snapshot rows closest to `now - {24h, 7d}`.
 *
 * Drift hints come from a final query against the fills aggregate; we only
 * compute drift for non-stable assets because a stable's "drift" is dominated
 * by transfer-in/out noise and isn't actionable.
 */
export async function getBalancesResponse(userId: UserId): Promise<BalancesResponse> {
  // 1. Live rows — joined with exchange metadata.
  const liveRows = await sql<LiveBalanceRow[]>`
    SELECT
      eb.asset                       AS asset,
      eb.wallet_type                 AS wallet_type,
      eb.chain                       AS chain,
      eb.total                       AS total,
      eb.usd_value                   AS usd_value,
      eb.usd_price                   AS usd_price,
      eb.snapshot_at                 AS snapshot_at,
      eb.exchange_connection_id::text AS exchange_connection_id,
      ec.exchange_code               AS exchange_code,
      cat.display_name               AS exchange_name,
      ec.label                       AS label
    FROM public.exchange_balances eb
    JOIN public.exchange_connections ec
      ON ec.id = eb.exchange_connection_id
    LEFT JOIN public.exchange_catalog cat
      ON cat.code = ec.exchange_code
    WHERE eb.user_id = ${userId}::uuid
      AND eb.total > 0
  `;

  // 2. Aggregate — across (asset) and (connection).
  const totals = new Decimal(0);
  const stable = new Decimal(0);
  const volatile = new Decimal(0);

  const byAssetMap = new Map<string, BalanceByAsset>();
  const byExchangeMap = new Map<string, BalanceByExchange>();
  let latestSnapshot: string | null = null;

  for (const row of liveRows) {
    const usdValue = row.usdValue != null ? new Decimal(row.usdValue) : null;
    const total = new Decimal(row.total);

    // Track latest snapshot timestamp.
    const snapIso = toIso(row.snapshotAt);
    if (latestSnapshot == null || snapIso > latestSnapshot) {
      latestSnapshot = snapIso;
    }

    // Hero accumulators (only count rows we could price).
    if (usdValue != null) {
      totals.add(0); // no-op for Decimal pattern; placeholder for the in-place style
      // Decimal.js is immutable — we re-bind below.
    }

    // ── byAsset rollup ──
    let assetEntry = byAssetMap.get(row.asset);
    if (assetEntry == null) {
      assetEntry = {
        asset: row.asset,
        totalQty: "0",
        totalUsd: usdValue != null ? "0" : null,
        usdPrice: row.usdPrice,
        exchanges: [],
        isStable: isStableAsset(row.asset),
      };
      byAssetMap.set(row.asset, assetEntry);
    }
    assetEntry.totalQty = new Decimal(assetEntry.totalQty).plus(total).toString();
    if (usdValue != null) {
      assetEntry.totalUsd =
        assetEntry.totalUsd != null
          ? new Decimal(assetEntry.totalUsd).plus(usdValue).toString()
          : usdValue.toString();
    }
    assetEntry.exchanges.push({
      exchangeCode: row.exchangeCode,
      exchange: row.exchangeName,
      qty: total.toString(),
      usdValue: usdValue != null ? usdValue.toString() : null,
    });

    // ── byExchange rollup ──
    let connEntry = byExchangeMap.get(row.exchangeConnectionId);
    if (connEntry == null) {
      connEntry = {
        exchange: row.exchangeName,
        exchangeCode: row.exchangeCode,
        connectionId: row.exchangeConnectionId as ConnectionIdBranded,
        label: row.label,
        totalUsd: "0",
        walletCount: 0,
        assetCount: 0,
      };
      byExchangeMap.set(row.exchangeConnectionId, connEntry);
    }
    if (usdValue != null) {
      connEntry.totalUsd = new Decimal(connEntry.totalUsd).plus(usdValue).toString();
    }
  }

  // Per-connection wallet/asset distinctness pass — done after the row loop
  // because we need to count distinct (wallet_type) and (asset) keys.
  const perConnWallets = new Map<string, Set<string>>();
  const perConnAssets = new Map<string, Set<string>>();
  for (const row of liveRows) {
    if (!perConnWallets.has(row.exchangeConnectionId)) {
      perConnWallets.set(row.exchangeConnectionId, new Set());
      perConnAssets.set(row.exchangeConnectionId, new Set());
    }
    perConnWallets.get(row.exchangeConnectionId)!.add(row.walletType);
    perConnAssets.get(row.exchangeConnectionId)!.add(row.asset);
  }
  for (const conn of byExchangeMap.values()) {
    conn.walletCount = perConnWallets.get(conn.connectionId)?.size ?? 0;
    conn.assetCount = perConnAssets.get(conn.connectionId)?.size ?? 0;
  }

  // Cross-sum for hero / stable / volatile — single pass over byAsset.
  let heroTotal = new Decimal(0);
  let heroStable = new Decimal(0);
  let heroVolatile = new Decimal(0);
  for (const a of byAssetMap.values()) {
    if (a.totalUsd == null) continue;
    const usd = new Decimal(a.totalUsd);
    heroTotal = heroTotal.plus(usd);
    if (a.isStable) heroStable = heroStable.plus(usd);
    else heroVolatile = heroVolatile.plus(usd);
  }
  // Silence unused vars from the immutable-Decimal pattern above.
  void totals;
  void stable;
  void volatile;

  // Sort byAsset desc by usdValue.
  const byAsset = [...byAssetMap.values()].sort((a, b) => {
    const av = a.totalUsd != null ? Number(a.totalUsd) : -1;
    const bv = b.totalUsd != null ? Number(b.totalUsd) : -1;
    return bv - av;
  });

  const byExchange = [...byExchangeMap.values()].sort(
    (a, b) => Number(b.totalUsd) - Number(a.totalUsd),
  );

  // 3. Deltas — find the snapshot closest to (now - 24h) and (now - 7d).
  const [delta24hUsd, delta7dUsd] = await Promise.all([
    computeDelta(userId, heroTotal, 24),
    computeDelta(userId, heroTotal, 24 * 7),
  ]);

  // 4. Drift hints — pulls per-asset drift from the same helper the worker
  // uses for snapshots. Threshold of 0.5% so we don't flag tiny rounding.
  const drift = await getDriftHints(userId, byAsset, 0.005);

  return {
    totalUsd: heroTotal.toString(),
    stableUsd: heroStable.toString(),
    volatileUsd: heroVolatile.toString(),
    byExchange,
    byAsset,
    snapshotAt: latestSnapshot,
    delta24hUsd,
    delta7dUsd,
    drift,
  };
}

// Local brand alias — typed string for connection id, kept loose for the
// row-shape lift here.
type ConnectionIdBranded = string & { readonly __brand: "ConnectionId" };

/**
 * Compute portfolio delta over a window. Returns the difference between
 * the current totalUsd and the totalUsd of the snapshot closest to
 * `now - hoursAgo` hours. Returns null when there's no snapshot in the
 * window (e.g. user just started, no history yet).
 */
async function computeDelta(
  userId: UserId,
  current: Decimal,
  hoursAgo: number,
): Promise<string | null> {
  const rows = await sql<{ totalUsd: string }[]>`
    SELECT total_usd::text AS total_usd
      FROM public.portfolio_snapshots
     WHERE user_id = ${userId}::uuid
       AND snapshot_at <= now() - (${hoursAgo}::int || ' hours')::interval
     ORDER BY snapshot_at DESC
     LIMIT 1
  `;
  if (rows.length === 0) return null;
  const prior = new Decimal(rows[0].totalUsd);
  return current.minus(prior).toString();
}

/**
 * Per-asset drift hints — compares the live `exchange_balances.total` per
 * asset to the fills-derived qty (BUY minus SELL on spot). Above-threshold
 * deltas are surfaced to the dashboard's banner.
 *
 * Threshold default: 0.5% of reported. We don't flag stables because
 * stablecoin drift is dominated by transfer activity that's not yet in the
 * journal — not actionable from the UI.
 */
async function getDriftHints(
  userId: UserId,
  byAsset: BalanceByAsset[],
  thresholdPct: number,
): Promise<DriftHint[]> {
  const reported = new Map<string, Decimal>();
  for (const a of byAsset) {
    if (a.isStable) continue;
    reported.set(a.asset, new Decimal(a.totalQty));
  }
  if (reported.size === 0) return [];

  // Pull aggregate buys/sells per base asset, spot only.
  const fillRows = await sql<{ asset: string; net: string }[]>`
    SELECT
      UPPER(split_part(split_part(instrument, ':', 1), '/', 1)) AS asset,
      SUM(CASE WHEN side = 'buy' THEN qty ELSE -qty END)::text  AS net
    FROM public.fills
    WHERE user_id = ${userId}::uuid
      AND instrument_type = 'spot'
    GROUP BY 1
  `;
  const expected = new Map<string, Decimal>(
    fillRows.map((r) => [r.asset, new Decimal(r.net)]),
  );

  const out: DriftHint[] = [];
  for (const [asset, rep] of reported.entries()) {
    const exp = expected.get(asset);
    if (exp == null) continue; // no fills history → drift undefined
    const drift = rep.minus(exp);
    const absDrift = drift.abs();
    if (rep.lte(0)) continue;
    const pct = absDrift.div(rep).toNumber();
    if (pct < thresholdPct) continue;

    // Find the asset's most recent USD price for the dollar conversion.
    const usdPrice = byAsset.find((a) => a.asset === asset)?.usdPrice;
    const driftUsd =
      usdPrice != null ? drift.times(new Decimal(usdPrice)).toString() : null;

    out.push({
      asset,
      reportedQty: rep.toString(),
      expectedQty: exp.toString(),
      driftQty: drift.toString(),
      driftPct: pct,
      driftUsd,
    });
  }
  // Sort by absolute USD drift desc so the most material ones surface first.
  out.sort((a, b) => {
    const av = a.driftUsd != null ? Math.abs(Number(a.driftUsd)) : 0;
    const bv = b.driftUsd != null ? Math.abs(Number(b.driftUsd)) : 0;
    return bv - av;
  });
  return out;
}

// ============================================================================
// Snapshot time series
// ============================================================================

const RANGE_HOURS: Record<string, number | null> = {
  "24h": 24,
  "7d":  24 * 7,
  "30d": 24 * 30,
  "90d": 24 * 90,
  all:   null,
};

/**
 * Read portfolio_snapshots for the chart. Each `range` keyword maps to a
 * `now - X` lower bound; `all` returns the full history.
 *
 * We don't downsample — at most this is one row per hour, so a 90d window
 * is ~2160 points. The SVG chart can handle that without breaking a sweat.
 * If a user accumulates 5+ years of history we'll add a per-day rollup
 * view; not worth it today.
 */
export async function getSnapshotSeries(
  userId: UserId,
  range: keyof typeof RANGE_HOURS,
): Promise<SnapshotSeriesResponse> {
  const hours = RANGE_HOURS[range];
  const rows =
    hours == null
      ? await sql<SnapshotPointRow[]>`
          SELECT snapshot_at, total_usd::text         AS total_usd,
                 total_stable_usd::text               AS total_stable_usd,
                 total_volatile_usd::text             AS total_volatile_usd,
                 source
            FROM public.portfolio_snapshots
           WHERE user_id = ${userId}::uuid
        ORDER BY snapshot_at ASC
        `
      : await sql<SnapshotPointRow[]>`
          SELECT snapshot_at, total_usd::text         AS total_usd,
                 total_stable_usd::text               AS total_stable_usd,
                 total_volatile_usd::text             AS total_volatile_usd,
                 source
            FROM public.portfolio_snapshots
           WHERE user_id = ${userId}::uuid
             AND snapshot_at >= now() - (${hours}::int || ' hours')::interval
        ORDER BY snapshot_at ASC
        `;

  const points: SnapshotPoint[] = rows.map((r) => ({
    snapshotAt: toIso(r.snapshotAt),
    totalUsd: r.totalUsd,
    stableUsd: r.totalStableUsd,
    volatileUsd: r.totalVolatileUsd,
    source: r.source as SnapshotPoint["source"],
  }));
  return { points };
}

// ============================================================================
// Single-exchange drill-down
// ============================================================================

export interface ExchangeBalanceDetail {
  exchange: string;
  exchangeCode: string;
  connectionId: string;
  label: string;
  totalUsd: string;
  wallets: Array<{
    walletType: WalletType;
    totalUsd: string;
    rows: Array<{
      asset: string;
      chain: string | null;
      total: string;
      available: string;
      locked: string;
      usdPrice: string | null;
      usdValue: string | null;
    }>;
  }>;
}

/**
 * Per-exchange drill-down — `/balances/[exchange]` page. Returns every
 * wallet bucket with its constituent asset rows, sorted by USD desc.
 *
 * `exchangeCode` is the catalog code; one user may have multiple
 * connections per exchange (sub-accounts, label-distinguished), so we
 * return all of them under a single page.
 */
export async function getExchangeBalanceDetail(
  userId: UserId,
  exchangeCode: string,
): Promise<ExchangeBalanceDetail[]> {
  interface DetailRow {
    connectionId: string;
    label: string;
    exchangeName: string;
    walletType: WalletType;
    asset: string;
    chain: string | null;
    total: string;
    available: string;
    locked: string;
    usdPrice: string | null;
    usdValue: string | null;
  }

  const rows = await sql<DetailRow[]>`
    SELECT
      eb.exchange_connection_id::text AS connection_id,
      ec.label                        AS label,
      cat.display_name                AS exchange_name,
      eb.wallet_type                  AS wallet_type,
      eb.asset                        AS asset,
      eb.chain                        AS chain,
      eb.total::text                  AS total,
      eb.available::text              AS available,
      eb.locked::text                 AS locked,
      eb.usd_price::text              AS usd_price,
      eb.usd_value::text              AS usd_value
    FROM public.exchange_balances eb
    JOIN public.exchange_connections ec
      ON ec.id = eb.exchange_connection_id
    LEFT JOIN public.exchange_catalog cat
      ON cat.code = ec.exchange_code
    WHERE eb.user_id = ${userId}::uuid
      AND ec.exchange_code = ${exchangeCode}
      AND eb.total > 0
  `;

  // Group: connection → wallet → assets.
  const byConn = new Map<string, ExchangeBalanceDetail>();
  for (const r of rows) {
    let conn = byConn.get(r.connectionId);
    if (conn == null) {
      conn = {
        exchange: r.exchangeName,
        exchangeCode,
        connectionId: r.connectionId,
        label: r.label,
        totalUsd: "0",
        wallets: [],
      };
      byConn.set(r.connectionId, conn);
    }
    let wallet = conn.wallets.find((w) => w.walletType === r.walletType);
    if (wallet == null) {
      wallet = { walletType: r.walletType, totalUsd: "0", rows: [] };
      conn.wallets.push(wallet);
    }
    wallet.rows.push({
      asset: r.asset,
      chain: r.chain,
      total: r.total,
      available: r.available,
      locked: r.locked,
      usdPrice: r.usdPrice,
      usdValue: r.usdValue,
    });
    if (r.usdValue != null) {
      wallet.totalUsd = new Decimal(wallet.totalUsd).plus(r.usdValue).toString();
      conn.totalUsd = new Decimal(conn.totalUsd).plus(r.usdValue).toString();
    }
  }

  // Sort wallets within each connection by USD desc; rows within by USD desc.
  for (const conn of byConn.values()) {
    for (const w of conn.wallets) {
      w.rows.sort((a, b) => {
        const av = a.usdValue != null ? Number(a.usdValue) : -1;
        const bv = b.usdValue != null ? Number(b.usdValue) : -1;
        return bv - av;
      });
    }
    conn.wallets.sort((a, b) => Number(b.totalUsd) - Number(a.totalUsd));
  }

  return [...byConn.values()].sort(
    (a, b) => Number(b.totalUsd) - Number(a.totalUsd),
  );
}
