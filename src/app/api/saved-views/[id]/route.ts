/**
 * PATCH  /api/saved-views/[id] — edit name / description / queryString.
 *                                `applied:true` bumps lastAppliedAt only.
 * DELETE /api/saved-views/[id] — hard-delete. 204 on success, 404 on miss.
 *
 * Ownership and existence are checked inside updateSavedView /
 * deleteSavedView; both return null/false on miss → 404.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors, noContent } from '@/lib/api/response';
import {
  updateSavedView,
  deleteSavedView,
  InvalidQueryStringError,
} from '@/lib/db/saved-views';
import { UpdateSavedViewBody } from '@/lib/db/zod-schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();

  const body = await parseBody(req, UpdateSavedViewBody);
  try {
    const row = await updateSavedView(userId, id, {
      name: body.name,
      description: body.description,
      queryString: body.queryString,
      bumpLastApplied: body.applied,
    });
    if (!row) return errors.notFound();
    return ok(row);
  } catch (e) {
    if (e instanceof InvalidQueryStringError) {
      return errors.badRequest('INVALID_QUERY_STRING', e.message);
    }
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code: unknown }).code === '23505'
    ) {
      return errors.conflict(
        'SAVED_VIEW_DUPLICATE',
        'A saved view with that name already exists',
      );
    }
    throw e;
  }
});

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const removed = await deleteSavedView(userId, id);
  if (!removed) return errors.notFound();
  return noContent();
});
