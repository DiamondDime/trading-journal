/**
 * POST /api/mcp/v1/tag_glossary
 *
 * Returns every distinct tag the user has applied (across activity_tag
 * free-form + activity.regime_tags + activity.custom_tags), with usage
 * counts and an optional `description` column.
 *
 * Source-of-truth tables read:
 *   • public.activity_tag                 — free-form setup tags
 *   • public.activity                     — regime/custom tag arrays
 *   • optionally public.activity_tag.description (added by parallel agent)
 *
 * The description column is being added in parallel by another agent. If the
 * column doesn't exist yet, we return null for every description. We probe
 * the catalog at startup of each request — cheap (single query) and avoids
 * caching pitfalls during the window between deployments.
 *
 * SECURITY: explicit SELECT lists, no SELECT *, no exchange_connections.
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

const Body = z.object({}).strict().optional();

interface TagRow {
  name: string;
  count: number;
  description: string | null;
}

/**
 * Detect whether public.activity_tag has a `description` column. We avoid
 * caching the result on module scope to keep the test suite simple — the
 * cost is one tiny information_schema query per request, which is fine for
 * a local MCP API that sees at most a handful of requests per session.
 */
async function tagDescriptionAvailable(): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'activity_tag'
        AND column_name  = 'description'
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

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

  try {
    const hasDescription = await tagDescriptionAvailable();

    // We pick the most-recent non-NULL description per tag so a glossary row
    // reflects the trader's latest curated text. If the column doesn't exist
    // yet, we omit the description CTE and return NULL for every tag.
    const rows = hasDescription
      ? await sql<{ name: string; count: string; description: string | null }[]>`
          WITH all_tags AS (
            SELECT t.tag AS name, 1 AS count, t.description AS description, t.created_at AS curated_at
            FROM public.activity_tag t
            JOIN public.activity a ON a.id = t.activity_id
            WHERE t.user_id = ${userId}::uuid
              AND a.deleted_at IS NULL

            UNION ALL

            SELECT unnest(a.regime_tags) AS name, 1 AS count, NULL::text AS description, a.created_at AS curated_at
            FROM public.activity a
            WHERE a.user_id = ${userId}::uuid
              AND a.deleted_at IS NULL
              AND array_length(a.regime_tags, 1) > 0

            UNION ALL

            SELECT unnest(a.custom_tags) AS name, 1 AS count, NULL::text AS description, a.created_at AS curated_at
            FROM public.activity a
            WHERE a.user_id = ${userId}::uuid
              AND a.deleted_at IS NULL
              AND array_length(a.custom_tags, 1) > 0
          ),
          ranked AS (
            SELECT
              name,
              SUM(count)::text AS count,
              (
                ARRAY_AGG(description ORDER BY curated_at DESC NULLS LAST)
                FILTER (WHERE description IS NOT NULL)
              )[1] AS description
            FROM all_tags
            GROUP BY name
          )
          SELECT name, count, description
          FROM ranked
          ORDER BY count::int DESC, name ASC
        `
      : await sql<{ name: string; count: string; description: string | null }[]>`
          WITH all_tags AS (
            SELECT t.tag AS name
            FROM public.activity_tag t
            JOIN public.activity a ON a.id = t.activity_id
            WHERE t.user_id = ${userId}::uuid
              AND a.deleted_at IS NULL

            UNION ALL

            SELECT unnest(a.regime_tags) AS name
            FROM public.activity a
            WHERE a.user_id = ${userId}::uuid
              AND a.deleted_at IS NULL
              AND array_length(a.regime_tags, 1) > 0

            UNION ALL

            SELECT unnest(a.custom_tags) AS name
            FROM public.activity a
            WHERE a.user_id = ${userId}::uuid
              AND a.deleted_at IS NULL
              AND array_length(a.custom_tags, 1) > 0
          )
          SELECT name, count(*)::text AS count, NULL::text AS description
          FROM all_tags
          GROUP BY name
          ORDER BY count(*) DESC, name ASC
        `;

    const tags: TagRow[] = rows.map((r) => ({
      name: r.name,
      count: Number(r.count),
      description: r.description ?? null,
    }));

    if (tags.length === 0) {
      return mcpOk({
        tags: [],
        empty: true,
        hint:
          'No tags found. Tags accrue as you journal spreads — they live ' +
          'on activity.regime_tags / activity.custom_tags / activity_tag.tag.',
      });
    }

    return mcpOk({ tags });
  } catch (err) {
    console.error('[mcp] tag_glossary failed', {
      name: err instanceof Error ? err.name : 'Unknown',
      message: err instanceof Error ? err.message : String(err),
    });
    return mcpError('internal', 'tag_glossary query failed', 500);
  }
}
