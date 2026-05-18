/**
 * GET /api/notifications
 *
 * Lazy-scans watchlist for new deadline events (idempotent via unique index),
 * then returns the user's recent notification history (read + unread).
 *
 * Force-dynamic: never cache — the badge count and panel must reflect the
 * current DB state on every poll.
 */
import { withAuth } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';
import { scanAndSync, listRecent } from '@/lib/db/notifications';
import type { UserId } from '@/types/canonical';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req, { userId }) => {
  await scanAndSync(userId as UserId);
  const rows = await listRecent(userId as UserId);
  return ok(rows);
});
