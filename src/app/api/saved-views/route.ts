/**
 * GET  /api/saved-views      — list every saved view for the user.
 * POST /api/saved-views      — create a new bookmark. Returns 201.
 *
 * Edits + deletes live at /api/saved-views/[id].
 *
 * Errors:
 *   400 VALIDATION             — Zod body/query failure.
 *   400 INVALID_QUERY_STRING   — URL is malformed or outside the allowlist.
 *   409 SAVED_VIEW_DUPLICATE   — unique (user_id, scope, name) collision.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import {
  listSavedViews,
  createSavedView,
  InvalidQueryStringError,
} from '@/lib/db/saved-views';
import { CreateSavedViewBody } from '@/lib/db/zod-schemas';

export const GET = withAuth(async (_req, { userId }) => {
  const views = await listSavedViews(userId);
  return ok(views);
});

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateSavedViewBody);
  try {
    const row = await createSavedView(userId, body);
    return created(row);
  } catch (e) {
    if (e instanceof InvalidQueryStringError) {
      return errors.badRequest('INVALID_QUERY_STRING', e.message);
    }
    // postgres.js exposes the SQLSTATE on the error object.
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
