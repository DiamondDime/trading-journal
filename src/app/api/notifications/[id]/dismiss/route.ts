/**
 * POST /api/notifications/[id]/dismiss
 *
 * Soft-deletes a notification by setting dismissed_at. The row is excluded
 * from all future queries.
 */
import { withAuth } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';
import { dismiss } from '@/lib/db/notifications';
import type { UserId } from '@/types/canonical';

export const POST = withAuth(async (_req, { userId, params }) => {
  const { id } = await params;
  await dismiss(userId as UserId, id);
  return ok({ ok: true });
});
