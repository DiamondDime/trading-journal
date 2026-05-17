/**
 * Typed DB helpers for the four v3 satellite tables (per migration 013):
 *
 *   - activity_tag           — free-form string tags
 *   - activity_excursion     — MAE/MFE/stop-loss
 *   - activity_screenshot    — annotated chart screenshots (file path metadata)
 *   - activity_satisfaction  — thumbs up/down execution rating
 *
 * Patterns mirror src/lib/db/notes.ts:
 *   • Every input UUID guarded by UUID_RE — non-UUID → null / no-op.
 *   • Every mutation re-checks activity ownership; we throw
 *     SatelliteOwnershipError so the route handler can map to 404 without
 *     leaking existence.
 *   • Date / jsonb shapes are normalised to ISO strings on the read path.
 *
 * postgres.js is configured with transform: postgres.camel — columns come back
 * camelCased on read. Column writes still use snake_case in template literals.
 */
import { sql } from '@/lib/db/client';
import type { ActivityId, Decimal, Iso8601 } from '@/types/canonical';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when activity ownership check fails. Route handlers map to 404. */
export class SatelliteOwnershipError extends Error {
  constructor(message = 'Activity not found or not owned by you') {
    super(message);
    this.name = 'SatelliteOwnershipError';
  }
}

/**
 * Verify the caller owns the activity AND it isn't soft-deleted. Pattern
 * borrowed from notes.upsertNote — never leak existence to non-owners.
 *
 * Throws SatelliteOwnershipError on miss; returns activity.id on hit.
 */
async function assertActivityOwner(
  userId: string,
  activityId: string,
  /** Re-usable in tx scopes — pass tx; otherwise defaults to the global sql. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any = sql,
): Promise<string> {
  if (!UUID_RE.test(activityId)) throw new SatelliteOwnershipError();
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM public.activity
    WHERE id = ${activityId}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (rows.length === 0) throw new SatelliteOwnershipError();
  return rows[0].id;
}

function dateToIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ============================================================================
// activity_tag — free-form setup tags
// ============================================================================

export interface ActivityTagRow {
  id: string;
  userId: string;
  activityId: ActivityId;
  tag: string;
  createdAt: Iso8601;
}

/**
 * List tags attached to an activity. Returns tags only (the bare strings) —
 * callers typically render chip badges and don't need the surrounding row
 * metadata. Returns an empty array if the activity doesn't exist or isn't
 * owned (no leak via row count).
 */
export async function listTagsForActivity(
  userId: string,
  activityId: string,
): Promise<string[]> {
  if (!UUID_RE.test(activityId)) return [];
  const rows = await sql<{ tag: string }[]>`
    SELECT t.tag
    FROM public.activity_tag t
    JOIN public.activity a ON a.id = t.activity_id
    WHERE t.activity_id = ${activityId}::uuid
      AND t.user_id     = ${userId}::uuid
      AND a.deleted_at IS NULL
    ORDER BY t.tag ASC
  `;
  return rows.map((r) => r.tag);
}

/**
 * Replace ALL tags on an activity (set-semantics). Tags are normalised: empty
 * strings dropped, whitespace trimmed, > 60 chars rejected by the column check
 * constraint, duplicates de-duped (case-insensitive on the JS side, exact on
 * the DB side).
 *
 * Runs in a single transaction so listTagsForActivity always sees a coherent
 * state. Explicitly bumps activity.updated_at because the bump trigger only
 * fires on INSERT/UPDATE — wholesale tag deletion (going from N → 0 tags)
 * otherwise wouldn't move the parent timestamp.
 */
export async function setTagsForActivity(
  userId: string,
  activityId: string,
  tags: readonly string[],
): Promise<string[]> {
  if (!UUID_RE.test(activityId)) throw new SatelliteOwnershipError();

  // Normalise: trim, drop empties, de-dupe by lowercase but preserve the
  // first-seen casing. 60-char cap mirrors the DB check constraint so we
  // surface a clean error instead of a Postgres-level 23514.
  const seen = new Set<string>();
  const normalised: string[] = [];
  for (const raw of tags) {
    const t = (raw ?? '').trim();
    if (!t) continue;
    if (t.length > 60) throw new Error(`tag too long (max 60 chars): ${t.slice(0, 60)}…`);
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalised.push(t);
  }

  return sql.begin(async (tx) => {
    await assertActivityOwner(userId, activityId, tx);

    // Wipe + re-insert. Simpler than a diff-based upsert for the small N here
    // (a typical activity has < 10 tags). The bump trigger fires on each insert
    // so the parent's updated_at advances naturally; if the new set is empty
    // (pure delete), we still bump explicitly below.
    await tx`
      DELETE FROM public.activity_tag
      WHERE activity_id = ${activityId}::uuid
        AND user_id     = ${userId}::uuid
    `;

    if (normalised.length > 0) {
      const rows = normalised.map((tag) => ({
        user_id: userId,
        activity_id: activityId,
        tag,
      }));
      await tx`
        INSERT INTO public.activity_tag ${tx(rows, 'user_id', 'activity_id', 'tag')}
        ON CONFLICT (activity_id, tag) DO NOTHING
      `;
    } else {
      // Pure delete path — bump the parent explicitly so cache invalidation
      // sees the change.
      await tx`
        UPDATE public.activity
        SET updated_at = now()
        WHERE id = ${activityId}::uuid
          AND user_id = ${userId}::uuid
      `;
    }

    // Read-back so callers get the canonical, sorted list.
    const out = await tx<{ tag: string }[]>`
      SELECT tag FROM public.activity_tag
      WHERE activity_id = ${activityId}::uuid
        AND user_id     = ${userId}::uuid
      ORDER BY tag ASC
    `;
    return out.map((r) => r.tag);
  });
}

export interface UserTagCount {
  tag: string;
  count: number;
}

/**
 * List every distinct tag the user has applied to any activity, with usage
 * counts. Drives the autocomplete dropdown in the tag-input control.
 *
 * Soft-deleted activities are excluded so a deleted activity's tags don't
 * inflate the autocomplete forever.
 */
export async function listAllTagsForUser(userId: string): Promise<UserTagCount[]> {
  const rows = await sql<{ tag: string; count: string }[]>`
    SELECT t.tag, count(*)::text AS count
    FROM public.activity_tag t
    JOIN public.activity a ON a.id = t.activity_id
    WHERE t.user_id    = ${userId}::uuid
      AND a.deleted_at IS NULL
    GROUP BY t.tag
    ORDER BY count(*) DESC, t.tag ASC
  `;
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

// ============================================================================
// getTagAggregations — per-tag performance metrics for the dashboard
// ============================================================================

export interface TagAggregation {
  tag: string;
  count: number;
  /** Fraction in [0, 1]. Activities with netPnl > 0 / activities with non-null netPnl. */
  winRate: number;
  /** Mean netPnlUsd (USD) over tagged activities with non-null netPnl. */
  avgPnl: number;
  /** Gross wins / |gross losses|. null when there are no losses (would be ∞). */
  profitFactor: number | null;
  /** Sum of netPnlUsd (USD). */
  totalPnl: number;
}

/**
 * Per-tag performance aggregations for the dashboard "Performance by tag"
 * table.
 *
 * Subtle correctness notes:
 *
 *   1. An activity with N tags contributes to N rows in this output. That's
 *      intentional — "trades tagged breakout" and "trades tagged london" can
 *      overlap. The same is true for the count column: if a single trade is
 *      tagged both, it counts as 1 toward each.
 *
 *   2. Activities with NULL net_pnl_usd (still open) are excluded by the
 *      `net_pnl_usd IS NOT NULL` filter — including them would skew the
 *      averages and is meaningless for "performance".
 *
 *   3. profitFactor uses FILTER (WHERE …) aggregates rather than CASE
 *      expressions so the SUM hits exactly the rows that need it. When
 *      there are no losses at all, dividing zero by zero produces NULL in
 *      SQL — we coerce that to JS null on the read side rather than 0 so
 *      the UI can render "—" / "∞" rather than misleading the trader.
 *
 *   4. winRate's denominator is rows with non-null net_pnl_usd. Sorting by
 *      count desc then tag asc gives a stable display order across renders.
 *
 *   5. Soft-deleted activities (deleted_at IS NOT NULL) are excluded via
 *      the JOIN. The CASCADE FK on activity_tag → activity won't fire for
 *      soft-deletes since the row stays; the filter is what enforces
 *      consistency.
 */
export async function getTagAggregations(
  userId: string,
): Promise<TagAggregation[]> {
  const rows = await sql<{
    tag: string;
    count: string;
    winCount: string;
    lossCount: string;
    pnlCount: string;
    grossWins: string | null;
    grossLosses: string | null; // accumulator stores positive sum of |losses|
    totalPnl: string | null;
  }[]>`
    SELECT
      t.tag                                                          AS tag,
      count(*)::text                                                 AS count,
      -- Activities (with non-null net_pnl_usd) tagged with this tag.
      count(*) FILTER (
        WHERE a.net_pnl_usd IS NOT NULL AND a.net_pnl_usd > 0
      )::text                                                        AS win_count,
      count(*) FILTER (
        WHERE a.net_pnl_usd IS NOT NULL AND a.net_pnl_usd < 0
      )::text                                                        AS loss_count,
      count(*) FILTER (WHERE a.net_pnl_usd IS NOT NULL)::text        AS pnl_count,
      sum(a.net_pnl_usd) FILTER (
        WHERE a.net_pnl_usd > 0
      )::text                                                        AS gross_wins,
      -- ABS so the accumulator is positive — matches computeMoreMetrics.
      sum(abs(a.net_pnl_usd)) FILTER (
        WHERE a.net_pnl_usd < 0
      )::text                                                        AS gross_losses,
      sum(a.net_pnl_usd) FILTER (
        WHERE a.net_pnl_usd IS NOT NULL
      )::text                                                        AS total_pnl
    FROM public.activity_tag t
    JOIN public.activity a ON a.id = t.activity_id
    WHERE t.user_id      = ${userId}::uuid
      AND a.deleted_at IS NULL
    GROUP BY t.tag
    ORDER BY count(*) DESC, t.tag ASC
  `;

  return rows.map((r) => {
    const count = Number(r.count);
    const pnlCount = Number(r.pnlCount);
    const winCount = Number(r.winCount);
    const lossCount = Number(r.lossCount);
    const grossWins = r.grossWins == null ? 0 : Number(r.grossWins);
    const grossLosses = r.grossLosses == null ? 0 : Number(r.grossLosses);
    const totalPnl = r.totalPnl == null ? 0 : Number(r.totalPnl);
    return {
      tag: r.tag,
      count,
      // winRate's denominator is rows with a known outcome (non-null
      // net_pnl_usd). For tag rows where every activity is open / null pnl,
      // winRate degrades to 0 — keep the column populated so the UI doesn't
      // get a NaN.
      winRate: pnlCount > 0 ? winCount / pnlCount : 0,
      avgPnl: pnlCount > 0 ? totalPnl / pnlCount : 0,
      profitFactor: lossCount > 0 ? grossWins / grossLosses : null,
      totalPnl,
      // winCount / lossCount intentionally not exported — the table only
      // needs count + winRate. If a future caller needs them, expose then.
    } satisfies TagAggregation;
  });
}

// ============================================================================
// activity_excursion — MAE/MFE/stop-loss
// ============================================================================

export type ExcursionSource = 'manual' | 'kline_backfill';

export interface ExcursionRow {
  id: string;
  userId: string;
  activityId: ActivityId;
  stopLossPrice: Decimal | null;
  maePrice: Decimal | null;
  mfePrice: Decimal | null;
  maeAt: Iso8601 | null;
  mfeAt: Iso8601 | null;
  source: ExcursionSource;
  backfilledAt: Iso8601 | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

export interface ExcursionPatch {
  stopLossPrice?: string | null;
  maePrice?: string | null;
  mfePrice?: string | null;
  maeAt?: string | null;
  mfeAt?: string | null;
  source?: ExcursionSource;
  backfilledAt?: string | null;
}

function normaliseExcursion(row: ExcursionRow): ExcursionRow {
  return {
    ...row,
    maeAt: dateToIso(row.maeAt),
    mfeAt: dateToIso(row.mfeAt),
    backfilledAt: dateToIso(row.backfilledAt),
    createdAt: (dateToIso(row.createdAt) ?? '') as Iso8601,
    updatedAt: (dateToIso(row.updatedAt) ?? '') as Iso8601,
  };
}

export async function getExcursionForActivity(
  userId: string,
  activityId: string,
): Promise<ExcursionRow | null> {
  if (!UUID_RE.test(activityId)) return null;
  const rows = await sql<ExcursionRow[]>`
    SELECT e.id, e.user_id, e.activity_id, e.stop_loss_price, e.mae_price, e.mfe_price,
           e.mae_at, e.mfe_at, e.source, e.backfilled_at, e.created_at, e.updated_at
    FROM public.activity_excursion e
    JOIN public.activity a ON a.id = e.activity_id
    WHERE e.activity_id = ${activityId}::uuid
      AND e.user_id     = ${userId}::uuid
      AND a.deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? normaliseExcursion(rows[0]) : null;
}

/**
 * Upsert (one-per-activity). The route layer treats this as PUT — any subset of
 * fields may be passed; omitted fields keep their current value on update or
 * default to NULL on insert.
 *
 * Returns the canonical post-write row.
 */
export async function upsertExcursion(
  userId: string,
  activityId: string,
  patch: ExcursionPatch,
): Promise<ExcursionRow> {
  return sql.begin(async (tx) => {
    await assertActivityOwner(userId, activityId, tx);

    const existing = await tx<{ id: string }[]>`
      SELECT id FROM public.activity_excursion
      WHERE activity_id = ${activityId}::uuid
        AND user_id     = ${userId}::uuid
      LIMIT 1
    `;

    if (existing.length === 0) {
      // Insert path — apply patch wholesale, NULLs for omitted columns.
      const [row] = await tx<ExcursionRow[]>`
        INSERT INTO public.activity_excursion (
          user_id, activity_id,
          stop_loss_price, mae_price, mfe_price, mae_at, mfe_at,
          source, backfilled_at
        ) VALUES (
          ${userId}::uuid, ${activityId}::uuid,
          ${patch.stopLossPrice ?? null}, ${patch.maePrice ?? null}, ${patch.mfePrice ?? null},
          ${patch.maeAt ?? null}, ${patch.mfeAt ?? null},
          ${patch.source ?? 'manual'},
          ${patch.backfilledAt ?? null}
        )
        RETURNING id, user_id, activity_id, stop_loss_price, mae_price, mfe_price,
                  mae_at, mfe_at, source, backfilled_at, created_at, updated_at
      `;
      return normaliseExcursion(row);
    }

    // Update path — only patch the columns the caller passed (undefined ≠ null).
    const patches: Record<string, unknown> = {};
    if (patch.stopLossPrice !== undefined) patches.stop_loss_price = patch.stopLossPrice;
    if (patch.maePrice !== undefined)      patches.mae_price       = patch.maePrice;
    if (patch.mfePrice !== undefined)      patches.mfe_price       = patch.mfePrice;
    if (patch.maeAt !== undefined)         patches.mae_at          = patch.maeAt;
    if (patch.mfeAt !== undefined)         patches.mfe_at          = patch.mfeAt;
    if (patch.source !== undefined)        patches.source          = patch.source;
    if (patch.backfilledAt !== undefined)  patches.backfilled_at   = patch.backfilledAt;

    if (Object.keys(patches).length === 0) {
      // No-op patch — return the current row.
      const [row] = await tx<ExcursionRow[]>`
        SELECT id, user_id, activity_id, stop_loss_price, mae_price, mfe_price,
               mae_at, mfe_at, source, backfilled_at, created_at, updated_at
        FROM public.activity_excursion
        WHERE activity_id = ${activityId}::uuid
          AND user_id     = ${userId}::uuid
        LIMIT 1
      `;
      return normaliseExcursion(row);
    }

    const [row] = await tx<ExcursionRow[]>`
      UPDATE public.activity_excursion
      SET ${tx(patches)}
      WHERE activity_id = ${activityId}::uuid
        AND user_id     = ${userId}::uuid
      RETURNING id, user_id, activity_id, stop_loss_price, mae_price, mfe_price,
                mae_at, mfe_at, source, backfilled_at, created_at, updated_at
    `;
    return normaliseExcursion(row);
  });
}

export async function deleteExcursion(
  userId: string,
  activityId: string,
): Promise<boolean> {
  if (!UUID_RE.test(activityId)) return false;
  const rows = await sql`
    DELETE FROM public.activity_excursion
    WHERE activity_id = ${activityId}::uuid
      AND user_id     = ${userId}::uuid
    RETURNING activity_id
  `;
  return rows.length > 0;
}

// ============================================================================
// activity_screenshot — chart screenshot metadata
// ============================================================================

export type ScreenshotSide = 'entry' | 'exit' | 'context';

export interface ScreenshotRow {
  id: string;
  userId: string;
  activityId: ActivityId;
  side: ScreenshotSide;
  storageKey: string;
  originalWidth: number | null;
  originalHeight: number | null;
  annotationState: unknown | null;
  caption: string | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

export interface CreateScreenshotInput {
  side: ScreenshotSide;
  storageKey: string;
  originalWidth: number | null;
  originalHeight: number | null;
  caption?: string | null;
}

function normaliseScreenshot(row: ScreenshotRow): ScreenshotRow {
  return {
    ...row,
    createdAt: (dateToIso(row.createdAt) ?? '') as Iso8601,
    updatedAt: (dateToIso(row.updatedAt) ?? '') as Iso8601,
  };
}

export async function listScreenshotsForActivity(
  userId: string,
  activityId: string,
): Promise<ScreenshotRow[]> {
  if (!UUID_RE.test(activityId)) return [];
  const rows = await sql<ScreenshotRow[]>`
    SELECT s.id, s.user_id, s.activity_id, s.side, s.storage_key,
           s.original_width, s.original_height,
           s.annotation_state, s.caption, s.created_at, s.updated_at
    FROM public.activity_screenshot s
    JOIN public.activity a ON a.id = s.activity_id
    WHERE s.activity_id = ${activityId}::uuid
      AND s.user_id     = ${userId}::uuid
      AND a.deleted_at IS NULL
    ORDER BY s.created_at ASC
  `;
  return rows.map(normaliseScreenshot);
}

export async function createScreenshot(
  userId: string,
  activityId: string,
  input: CreateScreenshotInput,
): Promise<ScreenshotRow> {
  return sql.begin(async (tx) => {
    await assertActivityOwner(userId, activityId, tx);
    const [row] = await tx<ScreenshotRow[]>`
      INSERT INTO public.activity_screenshot (
        user_id, activity_id, side, storage_key,
        original_width, original_height, caption
      ) VALUES (
        ${userId}::uuid, ${activityId}::uuid, ${input.side}, ${input.storageKey},
        ${input.originalWidth}, ${input.originalHeight}, ${input.caption ?? null}
      )
      RETURNING id, user_id, activity_id, side, storage_key,
                original_width, original_height, annotation_state, caption,
                created_at, updated_at
    `;
    return normaliseScreenshot(row);
  });
}

/**
 * Fetch one screenshot by id, enforcing ownership. Used by the file-serve
 * route and the annotation editor.
 */
export async function getScreenshot(
  userId: string,
  screenshotId: string,
): Promise<ScreenshotRow | null> {
  if (!UUID_RE.test(screenshotId)) return null;
  const rows = await sql<ScreenshotRow[]>`
    SELECT s.id, s.user_id, s.activity_id, s.side, s.storage_key,
           s.original_width, s.original_height,
           s.annotation_state, s.caption, s.created_at, s.updated_at
    FROM public.activity_screenshot s
    JOIN public.activity a ON a.id = s.activity_id
    WHERE s.id      = ${screenshotId}::uuid
      AND s.user_id = ${userId}::uuid
      AND a.deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? normaliseScreenshot(rows[0]) : null;
}

export async function updateScreenshotAnnotation(
  userId: string,
  screenshotId: string,
  annotationState: unknown,
  caption?: string | null,
): Promise<ScreenshotRow | null> {
  if (!UUID_RE.test(screenshotId)) return null;
  return sql.begin(async (tx) => {
    // Update returns null if not owned — caller maps to 404.
    const captionPatch = caption === undefined ? sql`` : sql`, caption = ${caption}`;
    // tx.json(undefined) blows up; we map undefined and null both to a JSON
    // NULL since this is a PATCH-style helper where "clear annotations" is
    // the only non-set semantic that matters.
    const annotationParam =
      annotationState === null || annotationState === undefined
        ? null
        : tx.json(annotationState as Parameters<typeof tx.json>[0]);
    const rows = await tx<ScreenshotRow[]>`
      UPDATE public.activity_screenshot
      SET annotation_state = ${annotationParam}
          ${captionPatch}
      WHERE id      = ${screenshotId}::uuid
        AND user_id = ${userId}::uuid
      RETURNING id, user_id, activity_id, side, storage_key,
                original_width, original_height, annotation_state, caption,
                created_at, updated_at
    `;
    return rows[0] ? normaliseScreenshot(rows[0]) : null;
  });
}

/**
 * Delete by screenshot id. Returns the storage_key (so the route handler can
 * unlink the file from disk) or null on miss. The DB delete happens first;
 * if the file unlink fails later the row stays gone — that's acceptable
 * because list endpoints filter by row existence and orphan files are
 * cleaned up by the housekeeping cron.
 */
export async function deleteScreenshot(
  userId: string,
  screenshotId: string,
): Promise<{ storageKey: string } | null> {
  if (!UUID_RE.test(screenshotId)) return null;
  const rows = await sql<{ storageKey: string }[]>`
    DELETE FROM public.activity_screenshot
    WHERE id      = ${screenshotId}::uuid
      AND user_id = ${userId}::uuid
    RETURNING storage_key
  `;
  return rows[0] ?? null;
}

// ============================================================================
// activity_satisfaction — thumbs up/down
// ============================================================================

export interface SatisfactionRow {
  activityId: ActivityId;
  userId: string;
  satisfaction: boolean;
  reason: string | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

function normaliseSatisfaction(row: SatisfactionRow): SatisfactionRow {
  return {
    ...row,
    createdAt: (dateToIso(row.createdAt) ?? '') as Iso8601,
    updatedAt: (dateToIso(row.updatedAt) ?? '') as Iso8601,
  };
}

export async function getSatisfaction(
  userId: string,
  activityId: string,
): Promise<SatisfactionRow | null> {
  if (!UUID_RE.test(activityId)) return null;
  const rows = await sql<SatisfactionRow[]>`
    SELECT s.activity_id, s.user_id, s.satisfaction, s.reason,
           s.created_at, s.updated_at
    FROM public.activity_satisfaction s
    JOIN public.activity a ON a.id = s.activity_id
    WHERE s.activity_id = ${activityId}::uuid
      AND s.user_id     = ${userId}::uuid
      AND a.deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? normaliseSatisfaction(rows[0]) : null;
}

/**
 * Upsert the satisfaction row. Composite PK is just activity_id so the ON
 * CONFLICT clause keys on the id and overwrites the rating + reason.
 */
export async function upsertSatisfaction(
  userId: string,
  activityId: string,
  satisfaction: boolean,
  reason?: string | null,
): Promise<SatisfactionRow> {
  return sql.begin(async (tx) => {
    await assertActivityOwner(userId, activityId, tx);
    const [row] = await tx<SatisfactionRow[]>`
      INSERT INTO public.activity_satisfaction (
        activity_id, user_id, satisfaction, reason
      ) VALUES (
        ${activityId}::uuid, ${userId}::uuid, ${satisfaction}, ${reason ?? null}
      )
      ON CONFLICT (activity_id) DO UPDATE
      SET satisfaction = EXCLUDED.satisfaction,
          reason       = EXCLUDED.reason,
          updated_at   = now()
      RETURNING activity_id, user_id, satisfaction, reason, created_at, updated_at
    `;
    return normaliseSatisfaction(row);
  });
}
