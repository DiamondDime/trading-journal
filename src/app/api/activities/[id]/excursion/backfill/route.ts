/**
 * POST /api/activities/[id]/excursion/backfill
 *
 * Trigger a kline-backfill for the activity's MAE/MFE excursion data.
 *
 * v1 behaviour — honest accounting:
 *
 *   The Python worker (Wave 10-1) owns the actual fetch_klines + MAE/MFE
 *   computation. For v1 there is no in-process job queue: the worker runs
 *   on a schedule, or manually via `pnpm worker:backfill-excursions
 *   --activity-id <id>`. This endpoint exists purely as a UX affordance —
 *   it returns 202 with a flash message and the manual-trigger command so
 *   the trader knows how to push the work through.
 *
 *   When a job table lands in Wave 11+, this route will insert a row in
 *   `excursion_backfill_jobs` and the worker will pick it up. Until then
 *   it's a no-op-with-feedback.
 *
 * Ownership: we still check the activity is owned by the caller so that
 * the 202 response can't be used to enumerate activity ids. A miss → 404.
 */
import { withAuth } from '@/lib/api/handler';
import { errors } from '@/lib/api/response';
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();

  // Verify ownership BEFORE returning 202 — otherwise the endpoint leaks the
  // existence of any activity id (timing + status code) to any authed user.
  const owned = await sql<{ id: string }[]>`
    SELECT id FROM public.activity
    WHERE id = ${id}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (owned.length === 0) return errors.notFound();

  // v1 — no queue. Return the manual-trigger instructions in the body so the
  // dev tools / a future toast surface can show the trader what to run.
  // Status 202 = "accepted but not processed yet". Honest copy.
  return NextResponse.json(
    {
      data: {
        queued: false,
        message:
          'Backfill runs on a schedule. Manually trigger with: ' +
          `pnpm worker:backfill-excursions --activity-id ${id}`,
        activityId: id,
      },
    },
    { status: 202 },
  );
});
