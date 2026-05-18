/**
 * POST /api/notifications/read-all
 *
 * Marks all unread notifications for the current user as read.
 */
import { withAuth } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';
import { markAllRead } from '@/lib/db/notifications';
import type { UserId } from '@/types/canonical';

export const POST = withAuth(async (_req, { userId }) => {
  await markAllRead(userId as UserId);
  return ok({ ok: true });
});
