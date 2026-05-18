/**
 * GET /api/notifications/count
 *
 * Runs the lazy scanner then returns the unread count. Polled by the bell
 * every 60 s while the tab is visible.
 */
import { withAuth } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';
import { scanAndSync, countUnread } from '@/lib/db/notifications';
import type { UserId } from '@/types/canonical';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req, { userId }) => {
  await scanAndSync(userId as UserId);
  const count = await countUnread(userId as UserId);
  return ok({ count });
});
