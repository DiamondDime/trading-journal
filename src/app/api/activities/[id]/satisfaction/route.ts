/**
 * GET /api/activities/[id]/satisfaction — fetch thumbs up/down + reason.
 * PUT /api/activities/[id]/satisfaction — upsert; the body's `satisfaction`
 *                                          boolean is the new value.
 *
 * One row per activity (composite PK on activity_id). 404 on miss / not-owned.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors, created } from '@/lib/api/response';
import {
  getSatisfaction,
  upsertSatisfaction,
  SatelliteOwnershipError,
} from '@/lib/db/satellite';
import { UpsertSatisfactionBody } from '@/lib/db/zod-schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const row = await getSatisfaction(userId, id);
  return ok(row);
});

export const PUT = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const body = await parseBody(req, UpsertSatisfactionBody);
  const before = await getSatisfaction(userId, id);
  try {
    const row = await upsertSatisfaction(userId, id, body.satisfaction, body.reason ?? null);
    return before ? ok(row) : created(row);
  } catch (e) {
    if (e instanceof SatelliteOwnershipError) return errors.notFound();
    throw e;
  }
});
