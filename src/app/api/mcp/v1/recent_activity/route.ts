/**
 * POST /api/mcp/v1/recent_activity
 *
 * Returns counts of opened/closed spreads in the last N days plus the actual
 * SpreadSummary rows for context.
 *
 * Source-of-truth tables read:
 *   • public.activity              — supertype
 *   • public.activity_spread       — subtype
 *   • public.spread_pnl (view)     — P&L decomposition
 *
 * SECURITY: explicit SELECT lists, no SELECT *, no exchange_connections join.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db/client';
import {
  mcpError,
  mcpOk,
  readMcpUserId,
  verifyMcpRequest,
} from '@/lib/mcp/auth';
import {
  rowToSpreadSummary,
  type SpreadRowForSummary,
} from '@/lib/mcp/serialize';
import type { SpreadSummary } from '@/lib/mcp/types';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 365;
const RECENT_LIMIT = 25;

const Body = z
  .object({
    days: z.number().int().positive().max(MAX_DAYS * 4).optional(),
  })
  .strict();

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

  // Even if the client asks for 4000 days, cap server-side. Postgres handles
  // it fine but the intent is "recent" not "lifetime".
  const days = Math.min(parsed.data.days ?? DEFAULT_DAYS, MAX_DAYS);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Count of opened-since: rows whose opened_at >= since. Closed counterpart
    // uses closed_at >= since. We run them as two queries (cheap aggregates)
    // and concatenate the row lists into one SpreadSummary feed sorted by
    // recency.
    const [openedCountRows, closedCountRows] = await Promise.all([
      sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM public.activity a
        WHERE a.user_id = ${userId}::uuid
          AND a.type = 'spread'
          AND a.deleted_at IS NULL
          AND a.opened_at >= ${since}::timestamptz
      `,
      sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM public.activity a
        WHERE a.user_id = ${userId}::uuid
          AND a.type = 'spread'
          AND a.deleted_at IS NULL
          AND a.closed_at >= ${since}::timestamptz
      `,
    ]);

    const opened = Number(openedCountRows[0]?.count ?? '0');
    const closed = Number(closedCountRows[0]?.count ?? '0');

    // EXPLICIT SELECT — same join chain as list_spreads. We sort by the
    // "most recent event" timestamp (greatest of opened_at, closed_at)
    // so a spread that opened 10 days ago but closed today shows up first
    // in a "recent" feed.
    const rows = await sql<SpreadRowForSummary[]>`
      WITH note_agg AS (
        SELECT n.activity_id, true AS has_note
        FROM public.notes n
        WHERE n.user_id = ${userId}::uuid
          AND n.deleted_at IS NULL
      ),
      tag_agg AS (
        SELECT t.activity_id, string_agg(t.tag, E'\x1f') AS free_form_tags
        FROM public.activity_tag t
        WHERE t.user_id = ${userId}::uuid
        GROUP BY t.activity_id
      )
      SELECT
        sp.spread_id                AS spread_id,
        a.status::text              AS status,
        sp.spread_type              AS spread_type,
        sp.primary_base             AS primary_base,
        a.name                      AS name,
        a.opened_at                 AS opened_at,
        a.closed_at                 AS closed_at,
        sp.net_pnl_quote            AS net_pnl_quote,
        sp.fees_quote               AS fees_quote,
        sp.funding_received_quote   AS funding_received_quote,
        sp.exchanges                AS exchanges,
        a.regime_tags               AS regime_tags,
        a.custom_tags               AS custom_tags,
        COALESCE(na.has_note, false) AS has_note,
        ta.free_form_tags           AS free_form_tags
      FROM public.activity a
      JOIN public.activity_spread asp ON asp.activity_id = a.id
      JOIN public.spread_pnl sp       ON sp.spread_id = a.id
      LEFT JOIN note_agg na ON na.activity_id = a.id
      LEFT JOIN tag_agg  ta ON ta.activity_id = a.id
      WHERE a.user_id = ${userId}::uuid
        AND a.type = 'spread'
        AND a.deleted_at IS NULL
        AND (
          a.opened_at >= ${since}::timestamptz
          OR a.closed_at >= ${since}::timestamptz
        )
      ORDER BY GREATEST(
        COALESCE(a.closed_at, a.opened_at, a.created_at),
        COALESCE(a.opened_at, a.created_at)
      ) DESC NULLS LAST
      LIMIT ${RECENT_LIMIT}
    `;

    const recent: SpreadSummary[] = rows.map(rowToSpreadSummary);

    if (opened === 0 && closed === 0) {
      return mcpOk({
        opened: 0,
        closed: 0,
        recent: [],
        empty: true,
        hint: `No spreads opened or closed in the last ${days} days. Try a larger window via { "days": 30 } or call account_overview for context.`,
      });
    }

    return mcpOk({ opened, closed, recent });
  } catch (err) {
    console.error('[mcp] recent_activity failed', {
      name: err instanceof Error ? err.name : 'Unknown',
      message: err instanceof Error ? err.message : String(err),
    });
    return mcpError('internal', 'recent_activity query failed', 500);
  }
}
