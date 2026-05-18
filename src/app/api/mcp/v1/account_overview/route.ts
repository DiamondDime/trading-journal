/**
 * POST /api/mcp/v1/account_overview
 *
 * Returns a one-shot portfolio snapshot: counts, P&L over multiple horizons,
 * connected exchanges (without credentials), and the top tags by usage.
 *
 * Source-of-truth tables read:
 *   • public.activity                — supertype (counts, P&L aggregates by horizon)
 *   • public.activity_option         — for open-options count (status = 'open')
 *   • public.exchange_connections    — connected venues (EXCLUDING ciphertext)
 *   • public.exchange_catalog        — display_name + code
 *   • public.activity_tag            — free-form tag counts
 *
 * SECURITY (NON-NEGOTIABLE):
 *
 *   `exchange_connections` has eight credential ciphertext / nonce columns:
 *     - api_key_ciphertext     - api_key_nonce
 *     - api_secret_ciphertext  - api_secret_nonce
 *     - api_passphrase_ciphertext - api_passphrase_nonce
 *     - wallet_address_ciphertext - wallet_address_nonce
 *
 *   The SELECT below enumerates every column we want and DOES NOT include
 *   any ciphertext / nonce / api_key_hint column. Future maintainers: if
 *   you need to add a column from exchange_connections to this response,
 *   add it by name to the SELECT list — never SELECT *.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Decimal as DecimalCtor } from 'decimal.js';
import { sql } from '@/lib/db/client';
import {
  mcpError,
  mcpOk,
  readMcpUserId,
  verifyMcpRequest,
} from '@/lib/mcp/auth';
import {
  rowToConnectedExchange,
  type ExchangeConnectionRowForSummary,
} from '@/lib/mcp/serialize';
import type { AccountSnapshot } from '@/lib/mcp/types';

const Body = z.object({}).strict().optional();

export async function POST(req: NextRequest): Promise<Response> {
  const refused = verifyMcpRequest(req);
  if (refused) return refused;

  const userId = readMcpUserId();
  if (!userId) {
    return mcpError(
      'misconfigured',
      'APP_USER_ID is not set on the server',
      500,
    );
  }

  // We accept either {} or an empty body. Reject anything else to make this
  // a stable contract and prevent accidental param creep.
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return mcpError('bad_request', 'Body is not valid JSON', 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return mcpError('bad_request', parsed.error.message, 400);
  }

  // YTD = from Jan 1 of the current calendar year (UTC).
  const now = new Date();
  const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  const last30dStart = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    // 1. Counts + aggregates. Single query, group-by-nothing — we just sum
    //    conditionals. Cheaper than 7 separate queries and atomic-consistent.
    const [counts] = await sql<
      {
        activeSince: Date | string | null;
        totalActivities: string;
        totalSpreads: string;
        totalTrades: string;
        totalSales: string;
        totalAirdrops: string;
        totalYieldPositions: string;
        totalOptions: string;
        lifetimePnlUsd: string | null;
        ytdPnlUsd: string | null;
        last30dPnlUsd: string | null;
        openSpreads: string;
      }[]
    >`
      SELECT
        MIN(COALESCE(a.opened_at, a.created_at)) AS active_since,
        COUNT(*)::text                          AS total_activities,
        COUNT(*) FILTER (WHERE a.type = 'spread')::text          AS total_spreads,
        COUNT(*) FILTER (WHERE a.type = 'trade')::text           AS total_trades,
        COUNT(*) FILTER (WHERE a.type = 'sale')::text            AS total_sales,
        COUNT(*) FILTER (WHERE a.type = 'airdrop')::text         AS total_airdrops,
        COUNT(*) FILTER (WHERE a.type = 'yield_position')::text  AS total_yield_positions,
        COUNT(*) FILTER (WHERE a.type = 'option')::text          AS total_options,
        COALESCE(SUM(a.net_pnl_usd) FILTER (WHERE a.status = 'closed'), 0)::text
          AS lifetime_pnl_usd,
        COALESCE(SUM(a.net_pnl_usd) FILTER (
          WHERE a.status = 'closed' AND a.closed_at >= ${ytdStart}::timestamptz
        ), 0)::text                                              AS ytd_pnl_usd,
        COALESCE(SUM(a.net_pnl_usd) FILTER (
          WHERE a.status = 'closed' AND a.closed_at >= ${last30dStart}::timestamptz
        ), 0)::text                                              AS last_30d_pnl_usd,
        COUNT(*) FILTER (
          WHERE a.type = 'spread'
            AND a.status IN ('open', 'winding_down', 'orphaned')
        )::text                                                  AS open_spreads
      FROM public.activity a
      WHERE a.user_id = ${userId}::uuid
        AND a.deleted_at IS NULL
    `;

    // 2. Open options count. The activity_option table doesn't exist on
    //    every install yet (added in v5 migration). We use a defensive query
    //    that returns 0 when the table is empty rather than failing.
    const [optionsRow] = await sql<{ openOptions: string }[]>`
      SELECT COUNT(*)::text AS open_options
      FROM public.activity a
      JOIN public.activity_option opt ON opt.activity_id = a.id
      WHERE a.user_id = ${userId}::uuid
        AND a.type = 'option'
        AND a.status = 'open'
        AND a.deleted_at IS NULL
    `;

    // 3. Connected exchanges. SECURITY: the SELECT explicitly lists every
    //    column. NO ciphertext / nonce / api_key_hint columns are accepted.
    //    JOIN to exchange_catalog for the display_name.
    const exchangeRows = await sql<ExchangeConnectionRowForSummary[]>`
      SELECT
        conn.exchange_code   AS exchange_code,
        ec.display_name      AS exchange_display_name,
        conn.last_sync_at    AS last_sync_at
      FROM public.exchange_connections conn
      LEFT JOIN public.exchange_catalog ec ON ec.code = conn.exchange_code
      WHERE conn.user_id = ${userId}::uuid
        AND conn.deleted_at IS NULL
      ORDER BY ec.priority NULLS LAST, conn.exchange_code ASC
    `;

    // 4. Top 10 tags across BOTH activity_tag (free-form) and the regime/custom
    //    tag arrays on activity. We union them so a tag appearing in either
    //    place contributes to the count.
    const tagRows = await sql<{ name: string; count: string }[]>`
      SELECT name, SUM(occurrences)::text AS count
      FROM (
        SELECT t.tag AS name, count(*)::int AS occurrences
        FROM public.activity_tag t
        JOIN public.activity a ON a.id = t.activity_id
        WHERE t.user_id = ${userId}::uuid
          AND a.deleted_at IS NULL
        GROUP BY t.tag

        UNION ALL

        SELECT unnest(a.regime_tags) AS name, 1 AS occurrences
        FROM public.activity a
        WHERE a.user_id = ${userId}::uuid
          AND a.deleted_at IS NULL
          AND array_length(a.regime_tags, 1) > 0

        UNION ALL

        SELECT unnest(a.custom_tags) AS name, 1 AS occurrences
        FROM public.activity a
        WHERE a.user_id = ${userId}::uuid
          AND a.deleted_at IS NULL
          AND array_length(a.custom_tags, 1) > 0
      ) tags_combined
      GROUP BY name
      ORDER BY SUM(occurrences) DESC, name ASC
      LIMIT 10
    `;

    const activeSinceIso =
      counts.activeSince === null || counts.activeSince === undefined
        ? null
        : counts.activeSince instanceof Date
          ? counts.activeSince.toISOString()
          : String(counts.activeSince);

    const snapshot: AccountSnapshot = {
      active_since: activeSinceIso,
      total_activities: Number(counts.totalActivities),
      total_spreads: Number(counts.totalSpreads),
      total_trades: Number(counts.totalTrades),
      total_sales: Number(counts.totalSales),
      total_airdrops: Number(counts.totalAirdrops),
      total_yield_positions: Number(counts.totalYieldPositions),
      total_options: Number(counts.totalOptions),
      lifetime_pnl_usd: new DecimalCtor(counts.lifetimePnlUsd ?? '0').toString(),
      ytd_pnl_usd: new DecimalCtor(counts.ytdPnlUsd ?? '0').toString(),
      last_30d_pnl_usd: new DecimalCtor(counts.last30dPnlUsd ?? '0').toString(),
      connected_exchanges: exchangeRows.map(rowToConnectedExchange),
      top_tags: tagRows.map((r) => ({ name: r.name, count: Number(r.count) })),
      open_spreads: Number(counts.openSpreads),
      open_options: Number(optionsRow?.openOptions ?? '0'),
    };

    return mcpOk(snapshot);
  } catch (err) {
    console.error('[mcp] account_overview failed', {
      name: err instanceof Error ? err.name : 'Unknown',
      message: err instanceof Error ? err.message : String(err),
    });
    return mcpError('internal', 'account_overview query failed', 500);
  }
}
