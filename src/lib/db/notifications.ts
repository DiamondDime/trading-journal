/**
 * Notification DB helpers.
 *
 * Lazy scanner pattern: scanAndSync() runs inside the GET /api/notifications
 * handlers. It reads watchlist items, computes notification_kind, and inserts
 * rows via INSERT … ON CONFLICT DO NOTHING so repeated calls are idempotent.
 *
 * All queries filter on user_id at the app layer. RLS provides defence-in-depth.
 */
import { sql } from '@/lib/db/client';
import { listWatchlistItems } from '@/lib/db/watchlist';
import type { ActivityId, UserId } from '@/types/canonical';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationKind =
  | 'deadline_t_minus_3'
  | 'deadline_t_minus_1'
  | 'deadline_today'
  | 'deadline_overdue'
  | 'drift_warning';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  activityId: ActivityId | null;
  href: string | null;
  createdAt: string;
  readAt: string | null;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** Unread notifications, newest first. Used by the dropdown. */
export async function listUnread(
  userId: UserId,
  limit = 20,
): Promise<NotificationRow[]> {
  const rows = await sql<NotificationRow[]>`
    select id, kind, title, body, activity_id, href, created_at, read_at
    from public.notifications
    where user_id = ${userId}::uuid
      and read_at     is null
      and dismissed_at is null
    order by created_at desc
    limit ${limit}
  `;
  return rows;
}

/** Count of unread (non-dismissed) notifications. Used for the badge. */
export async function countUnread(userId: UserId): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from public.notifications
    where user_id = ${userId}::uuid
      and read_at     is null
      and dismissed_at is null
  `;
  return parseInt(rows[0]?.count ?? '0', 10);
}

/**
 * Recent notifications (read + unread, no dismissed).
 * Used for the "full history" dropdown panel.
 */
export async function listRecent(
  userId: UserId,
  limit = 50,
): Promise<NotificationRow[]> {
  const rows = await sql<NotificationRow[]>`
    select id, kind, title, body, activity_id, href, created_at, read_at
    from public.notifications
    where user_id = ${userId}::uuid
      and dismissed_at is null
    order by created_at desc
    limit ${limit}
  `;
  return rows;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Mark a single notification as read. Noop if already read or not owned. */
export async function markRead(
  userId: UserId,
  notificationId: string,
): Promise<void> {
  await sql`
    update public.notifications
    set    read_at = now()
    where  user_id = ${userId}::uuid
      and  id      = ${notificationId}::uuid
      and  read_at is null
  `;
}

/** Mark every unread notification for the user as read. */
export async function markAllRead(userId: UserId): Promise<void> {
  await sql`
    update public.notifications
    set    read_at = now()
    where  user_id = ${userId}::uuid
      and  read_at is null
  `;
}

/** Soft-delete: sets dismissed_at so the row never resurfaces. */
export async function dismiss(
  userId: UserId,
  notificationId: string,
): Promise<void> {
  await sql`
    update public.notifications
    set    dismissed_at = now()
    where  user_id = ${userId}::uuid
      and  id      = ${notificationId}::uuid
  `;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Idempotent scanner. Reads all watchlist items for the user and inserts
 * a notification for each one that has crossed a deadline threshold.
 *
 * Uses INSERT … ON CONFLICT DO NOTHING so running this on every request is
 * safe — existing notification rows are never duplicated or overwritten.
 *
 * Returns the number of newly inserted rows (0 on a no-op run).
 */
export async function scanAndSync(
  userId: UserId,
): Promise<{ inserted: number }> {
  const items = await listWatchlistItems(userId);

  const toInsert = items.flatMap((item) => {
    const kind = kindFor(item.daysUntilDeadline);
    if (!kind) return [];

    const daysAbs =
      item.daysUntilDeadline != null
        ? Math.abs(item.daysUntilDeadline)
        : null;

    // Locale-neutral body stored in DB; UI renders kind-specific label via i18n.
    const body =
      item.deadline != null
        ? `Deadline ${item.deadline}${daysAbs != null ? ` (${daysAbs}d)` : ''}`
        : null;

    return [
      {
        userId,
        kind,
        title: item.name,
        body,
        activityId: item.id as string,
        href: item.href,
      },
    ];
  });

  if (toInsert.length === 0) return { inserted: 0 };

  // Build a multi-row insert. postgres.js flattens arrays in tagged templates
  // so we use a loop of individual inserts with ON CONFLICT DO NOTHING to
  // keep the query simple and avoid binding a large VALUES list.
  let inserted = 0;
  for (const row of toInsert) {
    const result = await sql<{ id: string }[]>`
      insert into public.notifications
        (user_id, kind, title, body, activity_id, href)
      values
        (
          ${row.userId}::uuid,
          ${row.kind}::notification_kind,
          ${row.title},
          ${row.body},
          ${row.activityId}::uuid,
          ${row.href}
        )
      on conflict (user_id, kind, activity_id)
        where activity_id is not null
      do nothing
      returning id
    `;
    inserted += result.length;
  }

  return { inserted };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function kindFor(days: number | null): NotificationKind | null {
  if (days == null) return null;
  if (days < 0) return 'deadline_overdue';
  if (days === 0) return 'deadline_today';
  if (days === 1) return 'deadline_t_minus_1';
  if (days <= 3) return 'deadline_t_minus_3';
  return null;
}
