/**
 * Typed DB helpers for the `notes` table (1:1 with activity).
 *
 * Schema (per migration 007 + rename in 011):
 *   id              uuid pk
 *   user_id         uuid (RLS scoped)
 *   activity_id     uuid (unique — one note per activity)
 *   body            text (markdown content)
 *   entry_rationale text (nullable — reserved highlight field, v1.5)
 *   exit_conclusion text (nullable — reserved highlight field, v1.5)
 *   created_at      timestamptz
 *   updated_at      timestamptz  (bumped automatically by tg_set_updated_at trigger)
 *   deleted_at      timestamptz nullable
 *
 * The task description references `body_md`, `last_edited_at`, and `version`
 * — those names predated the actual migration. We use the on-disk column
 * names (`body`, `updated_at`) and use `updated_at` as the optimistic-
 * concurrency token (compare ISO strings for staleness).
 *
 * postgres.js camelCase transform → JS keys come back as: id, userId,
 * activityId, body, entryRationale, exitConclusion, createdAt, updatedAt,
 * deletedAt.
 */
import { sql } from '@/lib/db/client';
import type { ActivityId, NoteId, Iso8601 } from '@/types/canonical';

export interface NoteRow {
  id: NoteId;
  userId: string;
  activityId: ActivityId;
  body: string;
  entryRationale: string | null;
  exitConclusion: string | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  deletedAt: Iso8601 | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * postgres.js returns `timestamptz` columns as JS Date objects by default.
 * The rest of the app (and client components) expect ISO strings — Dates
 * crossing the RSC boundary land back on the client as Date objects which
 * blow up "Objects are not valid as React child" when rendered. Normalize
 * to ISO strings at this layer.
 */
function dateToIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function normalizeNote<T extends { createdAt: unknown; updatedAt: unknown; deletedAt: unknown }>(
  row: T,
): T {
  return {
    ...row,
    createdAt: dateToIso(row.createdAt) as Iso8601,
    updatedAt: dateToIso(row.updatedAt) as Iso8601,
    deletedAt: dateToIso(row.deletedAt),
  };
}

/**
 * Fetch the note for a given activity. Returns null if no note exists or
 * the activity isn't owned by the user (no leak of existence).
 *
 * The `user_id` filter also acts as the owner check — RLS would do this
 * automatically but the local-Postgres shim bypasses RLS, so we filter
 * explicitly to keep parity with deployed RLS behavior.
 */
export async function getNoteForActivity(
  userId: string,
  activityId: string,
): Promise<NoteRow | null> {
  if (!UUID_RE.test(activityId)) return null;
  // JOIN to activity so soft-deleted parents hide their notes — otherwise
  // the detail page for a deleted activity (which 404s via getActivity)
  // would still surface the note on any other page that loaded by activity_id.
  const rows = await sql<NoteRow[]>`
    SELECT n.id, n.user_id, n.activity_id, n.body, n.entry_rationale, n.exit_conclusion,
           n.created_at, n.updated_at, n.deleted_at
    FROM public.notes n
    JOIN public.activity a ON a.id = n.activity_id
    WHERE n.activity_id = ${activityId}::uuid
      AND n.user_id     = ${userId}::uuid
      AND n.deleted_at IS NULL
      AND a.deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? normalizeNote(rows[0]) : null;
}

/**
 * Fetch the N most recently-edited notes joined to their activity.
 * Drives the dashboard "Recent notes" feed.
 */
export interface RecentNoteRow {
  id: NoteId;
  activityId: ActivityId;
  body: string;
  updatedAt: Iso8601;
  // Joined from activity
  activityName: string;
  activityType: 'spread' | 'trade' | 'sale' | 'airdrop';
}

export async function listRecentNotes(
  userId: string,
  limit: number,
): Promise<RecentNoteRow[]> {
  const rows = await sql<RecentNoteRow[]>`
    SELECT n.id,
           n.activity_id,
           n.body,
           n.updated_at,
           a.name AS activity_name,
           a.type AS activity_type
    FROM public.notes n
    JOIN public.activity a ON a.id = n.activity_id
    WHERE n.user_id = ${userId}::uuid
      AND n.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND length(trim(n.body)) > 0
    ORDER BY n.updated_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    ...r,
    updatedAt: (dateToIso(r.updatedAt) ?? '') as Iso8601,
  }));
}

/**
 * Lookup error class returned by upsertNote when an optimistic-concurrency
 * check fails. The caller (the PATCH API route) should map this to a 409.
 */
export class NoteVersionConflict extends Error {
  constructor(
    public readonly current: NoteRow,
  ) {
    super('Note version conflict — refetch and retry');
    this.name = 'NoteVersionConflict';
  }
}

/**
 * Thrown when the activity referenced by a note write doesn't exist, isn't
 * owned by the caller, or has been soft-deleted. API route handlers catch
 * this and surface a 404 so we never leak existence of other users' rows.
 */
export class NoteOwnershipError extends Error {
  constructor(message = 'Activity not found or not owned by you') {
    super(message);
    this.name = 'NoteOwnershipError';
  }
}

/**
 * Create or update the note for an activity.
 *
 * - If no note exists → INSERT and return the new row.
 * - If a note exists and no `expectedVersion` is passed → blind UPDATE.
 * - If a note exists and `expectedVersion` is passed → UPDATE only if
 *   the current `updated_at` matches; otherwise throw `NoteVersionConflict`
 *   with the current row attached.
 *
 * The owner check is enforced by the WHERE clause on user_id; passing a
 * mismatched userId silently no-ops (the upsert path will then fail the
 * activity_id FK lookup or hit RLS in production).
 *
 * @returns the latest note row after the write.
 */
export async function upsertNote(
  userId: string,
  activityId: string,
  body: string,
  expectedVersion?: Iso8601,
): Promise<NoteRow> {
  if (!UUID_RE.test(activityId)) {
    throw new Error('activityId must be a UUID');
  }

  // Verify ownership of the activity first — otherwise a user could
  // attach a note to someone else's activity if RLS isn't enforced
  // (which is the case for local single-user, non-RLS-bypass path).
  const owner = await sql<{ id: string }[]>`
    SELECT id FROM public.activity
    WHERE id = ${activityId}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (owner.length === 0) {
    throw new NoteOwnershipError();
  }

  // Probe existing note for the activity.
  const existing = await sql<NoteRow[]>`
    SELECT id, user_id, activity_id, body, entry_rationale, exit_conclusion,
           created_at, updated_at, deleted_at
    FROM public.notes
    WHERE activity_id = ${activityId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (!existing[0]) {
    // No row yet — insert.
    const [created] = await sql<NoteRow[]>`
      INSERT INTO public.notes (user_id, activity_id, body)
      VALUES (${userId}::uuid, ${activityId}::uuid, ${body})
      RETURNING id, user_id, activity_id, body, entry_rationale, exit_conclusion,
                created_at, updated_at, deleted_at
    `;
    return normalizeNote(created);
  }

  const current = normalizeNote(existing[0]);
  if (expectedVersion !== undefined && current.updatedAt !== expectedVersion) {
    throw new NoteVersionConflict(current);
  }

  // Update body. tg_set_updated_at trigger bumps updated_at automatically.
  const [updated] = await sql<NoteRow[]>`
    UPDATE public.notes
    SET body = ${body}
    WHERE id = ${current.id}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    RETURNING id, user_id, activity_id, body, entry_rationale, exit_conclusion,
              created_at, updated_at, deleted_at
  `;
  if (!updated) {
    // Should not happen — the activity owner check above already verified.
    throw new Error('Note vanished mid-update');
  }
  return normalizeNote(updated);
}

/**
 * Hard-delete a note. Used rarely — the cascade from activity deletion
 * normally handles the cleanup automatically. Returns true if a row was
 * deleted.
 */
export async function deleteNote(
  userId: string,
  noteId: string,
): Promise<boolean> {
  if (!UUID_RE.test(noteId)) return false;
  const rows = await sql`
    DELETE FROM public.notes
    WHERE id = ${noteId}::uuid
      AND user_id = ${userId}::uuid
    RETURNING id
  `;
  return rows.length > 0;
}

// ============================================================================
// listAllNotes — second-brain feed across every activity
// ============================================================================

/**
 * Filter shape for the /notes feed. All fields optional — page passes whatever
 * the search params decoded to. ILIKE matches against the raw body for v1; the
 * column has a trigram GIN index (notes_body_trgm) so substring queries stay
 * fast up to mid-five-figure note counts. Beyond that the obvious upgrade is
 * a generated tsvector + tsquery FTS pair — the schema migration is cheap and
 * doesn't change this call signature.
 */
export interface NoteListFilters {
  activityType?: ('spread' | 'trade' | 'sale' | 'airdrop')[];
  /** Single free-form tag (from activity_tag). Multi-tag is v2. */
  tag?: string;
  /** ILIKE against notes.body. Sanitised by parameterisation — postgres.js
   *  parameter binding prevents injection regardless of input shape. */
  search?: string;
  sort?: 'newest' | 'oldest' | 'longest' | 'edited';
  limit?: number;
  offset?: number;
}

/**
 * One row of the second-brain feed: enough to render an editorial card without
 * a second round-trip. Body is the raw note text; UI handles truncation /
 * markdown / pre-wrap.
 */
export interface AllNoteRow {
  id: NoteId;
  activityId: ActivityId;
  body: string;
  bodyLength: number;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  activityType: 'spread' | 'trade' | 'sale' | 'airdrop';
  activityName: string;
  activityStatus: string;
  activitySatisfaction: boolean | null;
  /** Free-form activity_tag strings (not the M:N tags vocabulary). */
  tags: string[];
  /** primary_symbol from v_activity_feed — first asset hint for the card. */
  primarySymbol: string | null;
  netPnlUsd: string | null;
}

/**
 * List every note the user has written, joined to the parent activity so the
 * card has enough metadata to render without a fan-out fetch. Soft-deleted
 * activities (deleted_at NOT NULL) are excluded — orphaned notes shouldn't
 * surface in the feed once the activity is gone.
 *
 * Implementation notes:
 *
 *   - Empty notes (body trimmed to zero length) are filtered out so the feed
 *     reads as a journal, not as the row count of placeholder activities.
 *   - The tag filter joins to activity_tag; otherwise we skip the join to
 *     keep the unfiltered path cheap (~1 query plan, no extra hash join).
 *   - Tags are array-aggregated in a correlated subquery so the row shape
 *     stays one-row-per-note even when an activity has multiple tags.
 *   - "longest" sort = bytes of body, descending. Approximates the most-
 *     substantial postmortems without ranking on writer time.
 *   - Limits are clamped to [1, 100]; offset to >= 0. Defaults: limit=20,
 *     offset=0. Matches the "load more" pagination in the page.
 */
export async function listAllNotes(
  userId: string,
  filters: NoteListFilters = {},
): Promise<AllNoteRow[]> {
  const {
    activityType,
    tag,
    search,
    sort = 'newest',
    limit = 20,
    offset = 0,
  } = filters;

  const clampedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const clampedOffset = Math.max(0, Math.trunc(offset));

  const joinTag = typeof tag === 'string' && tag.length > 0;
  const searchPattern = typeof search === 'string' && search.length > 0
    ? `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    : null;

  // ORDER BY clause map. Hard-coded to avoid SQL injection via the sort key.
  const orderClause = {
    newest:   sql`n.updated_at DESC`,
    oldest:   sql`n.created_at ASC`,
    longest:  sql`octet_length(n.body) DESC`,
    edited:   sql`n.updated_at DESC, n.created_at ASC`,
  }[sort];

  const rows = await sql<{
    id: string;
    activityId: string;
    body: string;
    bodyLength: string;
    createdAt: unknown;
    updatedAt: unknown;
    activityType: 'spread' | 'trade' | 'sale' | 'airdrop';
    activityName: string;
    activityStatus: string;
    activitySatisfaction: boolean | null;
    tags: string[] | null;
    primarySymbol: string | null;
    netPnlUsd: string | null;
  }[]>`
    SELECT
      n.id,
      n.activity_id,
      n.body,
      octet_length(n.body)::text             AS body_length,
      n.created_at,
      n.updated_at,
      a.type                                 AS activity_type,
      a.name                                 AS activity_name,
      a.status                               AS activity_status,
      asat.satisfaction                      AS activity_satisfaction,
      (
        SELECT array_agg(t.tag ORDER BY t.tag ASC)
        FROM public.activity_tag t
        WHERE t.activity_id = a.id
      )                                      AS tags,
      f.primary_symbol,
      a.net_pnl_usd::text                    AS net_pnl_usd
    FROM public.notes n
    JOIN public.activity a            ON a.id  = n.activity_id
    LEFT JOIN public.v_activity_feed f ON f.id = a.id
    LEFT JOIN public.activity_satisfaction asat ON asat.activity_id = a.id
    ${joinTag
      ? sql`JOIN public.activity_tag tf ON tf.activity_id = a.id AND tf.tag = ${tag!}`
      : sql``}
    WHERE n.user_id = ${userId}::uuid
      AND n.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND length(trim(n.body)) > 0
      ${activityType && activityType.length > 0
        ? sql`AND a.type::text = ANY(${activityType}::text[])`
        : sql``}
      ${searchPattern
        ? sql`AND n.body ILIKE ${searchPattern} ESCAPE '\\'`
        : sql``}
    ORDER BY ${orderClause}
    LIMIT ${clampedLimit}
    OFFSET ${clampedOffset}
  `;

  return rows.map((r) => ({
    id: r.id as NoteId,
    activityId: r.activityId as ActivityId,
    body: r.body,
    bodyLength: Number(r.bodyLength ?? 0),
    createdAt: (dateToIso(r.createdAt) ?? '') as Iso8601,
    updatedAt: (dateToIso(r.updatedAt) ?? '') as Iso8601,
    activityType: r.activityType,
    activityName: r.activityName,
    activityStatus: r.activityStatus,
    activitySatisfaction: r.activitySatisfaction,
    tags: r.tags ?? [],
    primarySymbol: r.primarySymbol,
    netPnlUsd: r.netPnlUsd,
  }));
}

/**
 * Count of notes matching the same filter shape — drives the headline
 * "47 notes" amber moment on /notes. Returned separately so the page can
 * paint the headline immediately while the body list streams.
 */
export async function countAllNotes(
  userId: string,
  filters: Omit<NoteListFilters, 'sort' | 'limit' | 'offset'> = {},
): Promise<number> {
  const { activityType, tag, search } = filters;
  const joinTag = typeof tag === 'string' && tag.length > 0;
  const searchPattern = typeof search === 'string' && search.length > 0
    ? `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    : null;

  const [row] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM public.notes n
    JOIN public.activity a ON a.id = n.activity_id
    ${joinTag
      ? sql`JOIN public.activity_tag tf ON tf.activity_id = a.id AND tf.tag = ${tag!}`
      : sql``}
    WHERE n.user_id = ${userId}::uuid
      AND n.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND length(trim(n.body)) > 0
      ${activityType && activityType.length > 0
        ? sql`AND a.type::text = ANY(${activityType}::text[])`
        : sql``}
      ${searchPattern
        ? sql`AND n.body ILIKE ${searchPattern} ESCAPE '\\'`
        : sql``}
  `;
  return Number(row?.count ?? 0);
}
