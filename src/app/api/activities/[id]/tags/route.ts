/**
 * GET /api/activities/[id]/tags  — list all free-form tags on the activity.
 * PUT /api/activities/[id]/tags  — replace the full set of tags (set-semantics).
 *
 * Tags are free-form strings (NOT FK'd to public.tags vocabulary). The PUT
 * body is a list; the helper de-dupes, trims, and rejects oversized entries.
 *
 * 404 on miss / not-owned to avoid leaking activity existence to other users.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors } from '@/lib/api/response';
import {
  listTagsForActivity,
  setTagsForActivity,
  SatelliteOwnershipError,
} from '@/lib/db/satellite';
import { SetTagsBody } from '@/lib/db/zod-schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const tags = await listTagsForActivity(userId, id);
  return ok({ tags });
});

export const PUT = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const body = await parseBody(req, SetTagsBody);
  try {
    const tags = await setTagsForActivity(userId, id, body.tags);
    return ok({ tags });
  } catch (e) {
    if (e instanceof SatelliteOwnershipError) return errors.notFound();
    throw e;
  }
});
