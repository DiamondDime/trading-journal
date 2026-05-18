/**
 * POST /api/mcp/v1/list_spreads
 *
 * Returns paginated SpreadSummary[] for the current user.
 *
 * Source-of-truth tables read:
 *   • public.activity              — supertype (status, opened/closed, tags)
 *   • public.activity_spread       — subtype (spread_type, variant, primary_base, exchanges)
 *   • public.spread_pnl (view)     — net/funding/fees P&L decomposition
 *   • public.activity_tag (aggregated subquery) — free-form setup tags
 *   • public.notes (aggregated subquery) — note presence
 *
 * SECURITY: every column in every SELECT is enumerated. We never run SELECT *
 * because joining `exchange_connections` would otherwise leak credential
 * ciphertext columns. The query below stays in the activity / spread_pnl
 * space; we do NOT join exchange_connections here.
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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Mapped sort field → SQL column reference. We never interpolate raw strings
// into ORDER BY because postgres.js identifiers go through sql() and we
// want a finite allowlist for safety + clarity.
const SORT_FIELDS = {
  openedAt: 'a.opened_at',
  closedAt: 'a.closed_at',
  netPnl: 'sp.net_pnl_quote',
} as const;

const Body = z
  .object({
    status: z.enum(['open', 'closed', 'all']).optional(),
    tags: z.array(z.string().min(1).max(100)).max(40).optional(),
    exchanges: z.array(z.string().min(1).max(60)).max(30).optional(),
    coins: z.array(z.string().min(1).max(20)).max(30).optional(),
    sides: z.array(z.enum(['long', 'short'])).optional(),
    openedAfter: z.string().datetime().optional(),
    openedBefore: z.string().datetime().optional(),
    closedAfter: z.string().datetime().optional(),
    closedBefore: z.string().datetime().optional(),
    minPnl: z.string().regex(/^-?\d+(\.\d+)?$/).optional(),
    maxPnl: z.string().regex(/^-?\d+(\.\d+)?$/).optional(),
    hasNote: z.boolean().optional(),
    sort: z.enum(['openedAt', 'closedAt', 'netPnl']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    // The schema permits ridiculous values; we cap to MAX_LIMIT below
    // regardless. The schema cap exists only to reject obvious garbage
    // (e.g. Number.MAX_SAFE_INTEGER) without exploding postgres.js.
    limit: z.number().int().positive().max(100_000).optional(),
    offset: z.number().int().nonnegative().optional(),
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

  const body = parsed.data;
  const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = body.offset ?? 0;
  const sortKey = body.sort ?? 'openedAt';
  const sortColumn = SORT_FIELDS[sortKey];
  const sortDir = body.sortDir ?? 'desc';
  // Spread status enum has many values (winding_down, orphaned, expired, ...).
  // Map the public "open"/"closed" filter to the appropriate enum set.
  const statusValues =
    body.status === 'open'
      ? ['open', 'winding_down', 'orphaned']
      : body.status === 'closed'
        ? ['closed', 'expired']
        : null;

  // Tags filter: the MCP `tags` param matches against the union of
  // regime_tags / custom_tags / free-form activity_tag.tag rows. Use ANY-of
  // match so the caller can OR multiple tags.
  const tagsFilter = body.tags && body.tags.length > 0 ? body.tags : null;

  try {
    // EXPLICIT SELECT LIST — never SELECT *. The exchange_connections table
    // is NOT touched here so we cannot leak credential columns from this
    // query, but we still list every column we want for clarity + audit.
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
        JOIN public.activity a ON a.id = t.activity_id
        WHERE t.user_id = ${userId}::uuid
          AND a.deleted_at IS NULL
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
        AND a.type    = 'spread'
        AND a.deleted_at IS NULL
        ${
          statusValues
            ? sql`AND a.status::text = ANY(${statusValues}::text[])`
            : sql``
        }
        ${
          body.exchanges && body.exchanges.length > 0
            ? sql`AND sp.exchanges && ${body.exchanges}::text[]`
            : sql``
        }
        ${
          body.coins && body.coins.length > 0
            ? sql`AND sp.primary_base = ANY(${body.coins}::text[])`
            : sql``
        }
        ${
          body.openedAfter
            ? sql`AND a.opened_at >= ${body.openedAfter}::timestamptz`
            : sql``
        }
        ${
          body.openedBefore
            ? sql`AND a.opened_at <= ${body.openedBefore}::timestamptz`
            : sql``
        }
        ${
          body.closedAfter
            ? sql`AND a.closed_at >= ${body.closedAfter}::timestamptz`
            : sql``
        }
        ${
          body.closedBefore
            ? sql`AND a.closed_at <= ${body.closedBefore}::timestamptz`
            : sql``
        }
        ${
          body.minPnl !== undefined
            ? sql`AND sp.net_pnl_quote >= ${body.minPnl}::numeric`
            : sql``
        }
        ${
          body.maxPnl !== undefined
            ? sql`AND sp.net_pnl_quote <= ${body.maxPnl}::numeric`
            : sql``
        }
        ${
          body.hasNote === true
            ? sql`AND na.has_note IS TRUE`
            : body.hasNote === false
              ? sql`AND na.has_note IS NOT TRUE`
              : sql``
        }
        ${
          tagsFilter
            ? sql`AND (
                a.regime_tags && ${tagsFilter}::text[]
                OR a.custom_tags && ${tagsFilter}::text[]
                OR EXISTS (
                  SELECT 1 FROM public.activity_tag t
                  WHERE t.activity_id = a.id
                    AND t.tag = ANY(${tagsFilter}::text[])
                )
              )`
            : sql``
        }
      ORDER BY ${sql(sortColumn)} ${sortDir === 'asc' ? sql`ASC` : sql`DESC`} NULLS LAST
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const summaries: SpreadSummary[] = pageRows.map(rowToSpreadSummary);

    // Server-side side[]-filter post-pass. inferSide() is decided in app code
    // (no DB column today) so this can't be pushed down. The filter is rarely
    // used in practice — most callers omit it.
    const filtered =
      body.sides && body.sides.length > 0
        ? summaries.filter((s) => s.side && body.sides!.includes(s.side as 'long' | 'short'))
        : summaries;

    // total = count of all spreads (not the cursor page). Cheap because the
    // user typically has <1k spreads; if that ever changes we'll memoize.
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM public.activity a
      JOIN public.activity_spread asp ON asp.activity_id = a.id
      WHERE a.user_id = ${userId}::uuid
        AND a.type = 'spread'
        AND a.deleted_at IS NULL
    `;

    if (filtered.length === 0) {
      return mcpOk({
        spreads: [],
        total: Number(count),
        has_more: false,
        empty: true,
        hint:
          'No spreads matched the filters. Try removing filters or call ' +
          'account_overview to see what data exists.',
      });
    }

    return mcpOk({
      spreads: filtered,
      total: Number(count),
      has_more: hasMore,
    });
  } catch (err) {
    // Log only the safe fields; postgres.js errors include the parameter
    // values in .message, which we don't want in server logs.
    console.error('[mcp] list_spreads failed', {
      name: err instanceof Error ? err.name : 'Unknown',
      message: err instanceof Error ? err.message : String(err),
    });
    return mcpError('internal', 'list_spreads query failed', 500);
  }
}
