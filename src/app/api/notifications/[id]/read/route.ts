/**
 * POST /api/notifications/[id]/read
 *
 * Marks a single notification as read. Noop if already read or not owned.
 */
import { withAuth } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';
import { markRead } from '@/lib/db/notifications';
import type { UserId } from '@/types/canonical';

export const POST = withAuth(async (_req, { userId, params }) => {
  const { id } = await params;
  await markRead(userId as UserId, id);
  return ok({ ok: true });
});
