/**
 * Global activity search.
 *
 * Queries `v_activity_feed` across name / primary_symbol / card_subtitle /
 * strategy_tag, plus subquery-joins `activity_tag.tag` and `notes.body` so a
 * user can find a row by any natural identifier (token ticker, strategy name,
 * a phrase from the journal note, or a custom setup tag).
 *
 * v1 ranking is simple: substring ILIKE with a UNION-DISTINCT shape. We score
 * results by a coarse `match_rank` (1 = name/symbol hit, 2 = card/strategy
 * hit, 3 = tag, 4 = note body) so the API can sort highest-confidence first
 * without dragging in `ts_rank_cd` complexity for v1.
 *
 * The view is already user-filtered downstream by the WHERE clause; the
 * joined satellite tables (`activity_tag`, `notes`) each carry their own
 * `user_id` so we narrow on both sides for defense-in-depth.
 *
 * NOTE: keep this file boundary-free of NextResponse / Request types. It is
 * called from both the API route and the dedicated `/search` server page.
 */
import { sql } from '@/lib/db/client';
import type { SearchResultItem } from '@/lib/search/types';
import type {
  ActivityId,
  ActivityType,
  ActivityStatus,
  HeadlineKind,
  HeadlineFormat,
  Decimal,
  Iso8601,
} from '@/types/canonical';

/** Maximum results we'll return even if the caller asks for more. */
export const SEARCH_MAX_LIMIT = 50;

/**
 * One row of search output. Flat shape — no nested subtype — because the
 * search UI only renders summary lines + a link to the per-type detail page.
 *
 * `kind` is a synonym of `type` kept around for client-side disambiguation
 * (e.g. grouping headers). Mirrors what the spec asked for.
 */
// Re-export from the client-safe location so existing server-side imports
// of `@/lib/db/search` keep working after the type was extracted.
export { searchHrefFor } from '@/lib/search/types';
export type { SearchResultItem } from '@/lib/search/types';

/**
 * v_activity_feed row shape returned by the postgres.js camel transform plus
 * our two custom search-only columns. Kept local to this file — the public
 * boundary is `SearchResultItem`.
 */
interface SearchRowDb {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  name: string;
  cardSubtitle: string | null;
  primarySymbol: string | null;
  openedAt: Date | string | null;
  headlineValue: Decimal | null;
  headlineKind: HeadlineKind;
  headlineFormat: HeadlineFormat;
  matchRank: number;
}

/**
 * Search activities for the given user across name / symbol / subtitle /
 * strategy / tags / notes. Returns a deduplicated, ranked list capped at
 * `limit` (clamped to [1, SEARCH_MAX_LIMIT]).
 *
 * Empty / whitespace-only queries return `[]` without hitting the DB.
 */
export async function searchActivities(
  userId: string,
  q: string,
  limit = 20,
): Promise<SearchResultItem[]> {
  const query = q.trim();
  if (query.length === 0) return [];

  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), SEARCH_MAX_LIMIT);
  // ILIKE escape: %, _ are wildcards in LIKE/ILIKE. Backslash is the escape
  // char by default. Escape the trio so a user typing "10%" doesn't drag in
  // half the journal. Order matters — escape backslash first.
  const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const pattern = `%${escaped}%`;

  const rows = await sql<SearchRowDb[]>`
    WITH ranked AS (
      -- Tier 1: direct hits on name / primary_symbol (highest confidence).
      SELECT
        f.id, f.type, f.status, f.name, f.card_subtitle, f.primary_symbol,
        f.opened_at, f.headline_value, f.headline_kind, f.headline_format,
        1::int AS match_rank
      FROM public.v_activity_feed f
      WHERE f.user_id = ${userId}::uuid
        AND (
          f.name           ILIKE ${pattern}
          OR f.primary_symbol ILIKE ${pattern}
        )

      UNION ALL

      -- Tier 2: card subtitle (spread_type, exchange · instrument, …) or
      -- strategy_tag — these are the "what kind of trade" filters.
      SELECT
        f.id, f.type, f.status, f.name, f.card_subtitle, f.primary_symbol,
        f.opened_at, f.headline_value, f.headline_kind, f.headline_format,
        2::int AS match_rank
      FROM public.v_activity_feed f
      WHERE f.user_id = ${userId}::uuid
        AND (
          f.card_subtitle ILIKE ${pattern}
          OR f.strategy_tag ILIKE ${pattern}
        )

      UNION ALL

      -- Tier 3: free-form setup tags (activity_tag.tag). One result per
      -- (activity, tag) row would explode the count; DISTINCT on id below
      -- collapses duplicates while keeping the best (lowest) rank.
      SELECT
        f.id, f.type, f.status, f.name, f.card_subtitle, f.primary_symbol,
        f.opened_at, f.headline_value, f.headline_kind, f.headline_format,
        3::int AS match_rank
      FROM public.v_activity_feed f
      JOIN public.activity_tag at
        ON at.activity_id = f.id
       AND at.user_id     = f.user_id
      WHERE f.user_id = ${userId}::uuid
        AND at.tag ILIKE ${pattern}

      UNION ALL

      -- Tier 4: note body / structured fields. notes_body_trgm GIN index
      -- accelerates ILIKE on body once query is >= 3 chars; below that
      -- Postgres falls back to seq scan, which is fine for <1k notes.
      SELECT
        f.id, f.type, f.status, f.name, f.card_subtitle, f.primary_symbol,
        f.opened_at, f.headline_value, f.headline_kind, f.headline_format,
        4::int AS match_rank
      FROM public.v_activity_feed f
      JOIN public.notes n
        ON n.activity_id = f.id
       AND n.user_id     = f.user_id
       AND n.deleted_at IS NULL
      WHERE f.user_id = ${userId}::uuid
        AND (
          n.body            ILIKE ${pattern}
          OR n.entry_rationale ILIKE ${pattern}
          OR n.exit_conclusion ILIKE ${pattern}
        )
    )
    SELECT DISTINCT ON (id)
      id, type, status, name, card_subtitle, primary_symbol,
      opened_at, headline_value, headline_kind, headline_format,
      match_rank
    FROM ranked
    ORDER BY id, match_rank ASC, opened_at DESC NULLS LAST
    LIMIT ${safeLimit}
  `;

  // The DISTINCT ON gives us one row per activity but in (id, rank) order.
  // Re-sort to global (rank, openedAt DESC) so the highest-confidence hits
  // float to the top regardless of UUID lexicographic order.
  rows.sort((a, b) => {
    if (a.matchRank !== b.matchRank) return a.matchRank - b.matchRank;
    const aT = a.openedAt instanceof Date ? a.openedAt.getTime() : a.openedAt ? Date.parse(a.openedAt) : 0;
    const bT = b.openedAt instanceof Date ? b.openedAt.getTime() : b.openedAt ? Date.parse(b.openedAt) : 0;
    return bT - aT;
  });

  return rows.map((r) => ({
    id: r.id as ActivityId,
    type: r.type,
    kind: r.type,
    title: r.name,
    subtitle: r.cardSubtitle,
    status: r.status,
    primarySymbol: r.primarySymbol,
    openedAt: toIso(r.openedAt),
    headlineValue: r.headlineValue,
    headlineKind: r.headlineKind,
    headlineFormat: r.headlineFormat,
    matchRank: clampRank(r.matchRank),
  }));
}

// searchHrefFor + SearchResultItem live in @/lib/search/types (client-safe).
// They are re-exported at the top of this file for backwards compatibility.

// ─── internals ────────────────────────────────────────────────────────────

function toIso(v: Date | string | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
  return v;
}

function clampRank(n: number): 1 | 2 | 3 | 4 {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}
