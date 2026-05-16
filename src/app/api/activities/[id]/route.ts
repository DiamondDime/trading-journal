/**
 * GET    /api/activities/[id]  — polymorphic detail (supertype + subtype)
 * PATCH  /api/activities/[id]  — edit common fields (name, status, tags)
 * DELETE /api/activities/[id]  — soft-delete (deleted_at = now)
 *
 * 404 is returned both for missing rows AND rows owned by other users — never
 * leak existence to non-owners. Subtype-specific edits land in Wave 6 alongside
 * the notes editor.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors, noContent } from '@/lib/api/response';
import {
  getActivity,
  updateActivity,
  deleteActivity,
} from '@/lib/db/activity';
import { UpdateActivityBody } from '@/lib/db/zod-schemas';

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  const row = await getActivity(userId, id);
  if (!row) return errors.notFound();
  return ok(row);
});

export const PATCH = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  const body = await parseBody(req, UpdateActivityBody);
  const ok_ = await updateActivity(userId, id, {
    name: body.name,
    status: body.status,
    regimeTags: body.regime_tags,
    customTags: body.custom_tags,
  });
  if (!ok_) return errors.notFound();
  const row = await getActivity(userId, id);
  return ok(row);
});

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  const ok_ = await deleteActivity(userId, id);
  if (!ok_) return errors.notFound();
  return noContent();
});
