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
  | 'drift_warning'
  | 'manual_reminder';

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
  const watchlistInserted = await scanWatchlist(userId);
  const reminderInserted = await scanDueReminders(userId);
  return { inserted: watchlistInserted + reminderInserted };
}

/**
 * Watchlist deadline scan — the original scanAndSync body. Reads every
 * watchlist item and inserts a deadline notification for each one past a
 * threshold. Idempotent via the (user_id, kind, activity_id) partial index.
 */
async function scanWatchlist(userId: UserId): Promise<number> {
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

  if (toInsert.length === 0) return 0;

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

  return inserted;
}

/**
 * Due-reminder scan. Picks up every reminder whose `remind_at` has passed and
 * which is still pending (not completed, not dismissed), and materializes a
 * `manual_reminder` notification for each.
 *
 * Idempotent via the partial unique index on (user_id, reminder_id): the
 * `ON CONFLICT … DO NOTHING` means a reminder produces at most one
 * notification, no matter how many times the scanner runs.
 *
 * Lifecycle note: once a reminder is completed/dismissed it stops being
 * "due", so no new notification is created — and completeReminder /
 * dismissReminder also stamp `dismissed_at` on any already-materialized
 * notification, so a settled reminder never lingers in the bell.
 */
async function scanDueReminders(userId: UserId): Promise<number> {
  const due = await sql<
    {
      id: string;
      title: string;
      note: string | null;
      remindAt: string;
      activityId: string | null;
      activityType: string | null;
    }[]
  >`
    select
      r.id,
      r.title,
      r.note,
      r.remind_at::text as remind_at,
      r.activity_id     as activity_id,
      a.type::text      as activity_type
    from public.reminders r
    left join public.activity a
      on a.id = r.activity_id
     and a.deleted_at is null
    where r.user_id      = ${userId}::uuid
      and r.remind_at    <= now()
      and r.completed_at is null
      and r.dismissed_at is null
  `;

  if (due.length === 0) return 0;

  let inserted = 0;
  for (const r of due) {
    // Locale-neutral body — the note if present, else the due date. The UI
    // renders the kind label via i18n; only the free-text body is stored.
    const body = r.note ?? `Due ${r.remindAt.slice(0, 10)}`;
    // A linked activity is "live" only when the LEFT JOIN resolved its type
    // (i.e. it exists and isn't soft-deleted). If it's gone, drop both the
    // activity_id and the deep-link so the notification stays consistent —
    // it just routes to the watchlist instead of a dead activity page.
    const linkLive = r.activityId != null && r.activityType != null;
    const linkedActivityId = linkLive ? r.activityId : null;
    const href = linkLive
      ? activityHref(r.activityId as string, r.activityType as string)
      : '/watchlist';

    const result = await sql<{ id: string }[]>`
      insert into public.notifications
        (user_id, kind, reminder_id, title, body, activity_id, href)
      values
        (
          ${userId}::uuid,
          'manual_reminder'::notification_kind,
          ${r.id}::uuid,
          ${r.title},
          ${body},
          ${linkedActivityId}::uuid,
          ${href}
        )
      on conflict (user_id, reminder_id)
        where reminder_id is not null
      do nothing
      returning id
    `;
    inserted += result.length;
  }

  return inserted;
}

/**
 * Map an activity id + type to its detail-page route. Mirrors the href
 * conventions used by the calendar chips and the watchlist. Unknown types
 * fall back to the watchlist so the notification still has a valid target.
 */
function activityHref(id: string, type: string): string {
  switch (type) {
    case 'spread':
      return `/spreads/${id}`;
    case 'trade':
      return `/trades/${id}`;
    case 'sale':
      return `/sales/${id}`;
    case 'airdrop':
      return `/airdrops/${id}`;
    case 'yield_position':
      return `/yield-positions/${id}`;
    case 'option':
      return `/options/${id}`;
    default:
      return '/watchlist';
  }
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
