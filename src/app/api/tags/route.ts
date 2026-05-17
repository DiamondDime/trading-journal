/**
 * GET /api/tags — list every distinct tag the current user has used across
 *                 all their activities, with usage counts. Drives the
 *                 autocomplete dropdown in the tag-input control.
 *
 * Soft-deleted activities are excluded — a deleted activity's tags shouldn't
 * inflate the suggestion list forever.
 *
 * Note: this endpoint reads from `activity_tag` (singular — the free-form
 * setup tags from Wave 9A), NOT from the controlled-vocabulary `tags` table
 * or the `activity_tags` M:N join.
 */
import { withAuth } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';
import { listAllTagsForUser } from '@/lib/db/satellite';

export const GET = withAuth(async (_req, { userId }) => {
  const tags = await listAllTagsForUser(userId);
  return ok({ tags });
});
