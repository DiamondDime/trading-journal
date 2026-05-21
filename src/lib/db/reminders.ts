/**
 * Reminder DB helpers.
 *
 * User-created manual reminders (migration v5.3). Pending reminders surface
 * through the notification bell once `remind_at` passes — the lazy scanner
 * (scanAndSync in notifications.ts) materializes a `manual_reminder`
 * notification, deduped via the partial unique index on (user_id, reminder_id).
 *
 * Every query gates strictly on `user_id` at the app layer; RLS provides
 * defence-in-depth. postgres.js is configured with `transform: postgres.camel`
 * so columns come back camelCased on read; writes still use snake_case.
 */
import { sql } from '@/lib/db/client';
import type { UserId } from '@/types/canonical';
import type { CreateReminderInput, ReminderRow } from '@/lib/db/reminders-types';
import { validateReminderInput } from '@/lib/reminders/validate';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when a reminder input fails validation. */
export class ReminderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderInputError';
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Pending reminders for the user — neither completed nor dismissed — ordered
 * by `remind_at` (soonest first). Used by the watchlist Reminders section.
 */
export async function listReminders(userId: UserId): Promise<ReminderRow[]> {
  const rows = await sql<
    {
      id: string;
      userId: string;
      activityId: string | null;
      remindAt: string;
      title: string;
      note: string | null;
      createdAt: string;
      completedAt: string | null;
      dismissedAt: string | null;
    }[]
  >`
    select
      id,
      user_id,
      activity_id,
      remind_at::text   as remind_at,
      title,
      note,
      created_at::text  as created_at,
      completed_at::text as completed_at,
      dismissed_at::text as dismissed_at
    from public.reminders
    where user_id      = ${userId}::uuid
      and completed_at is null
      and dismissed_at is null
    order by remind_at asc
  `;
  return rows.map(toReminderRow);
}

/**
 * A pending reminder enriched with its linked activity's name + detail-page
 * href (both null when the reminder is standalone). Used by the watchlist
 * Reminders section so it can render a deep-link without a second query.
 */
export interface ReminderWithActivity extends ReminderRow {
  activityHref: string | null;
  activityName: string | null;
}

/**
 * Pending reminders for the user, each joined to its linked activity (if any).
 * Same filter/ordering as listReminders. Joins `public.activity` directly with
 * `deleted_at is null` — the SAME source the scanner (scanDueReminders) and the
 * create-time ownership check use, so all three agree on what a "live linked
 * activity" is. The LEFT JOIN tolerates a soft-deleted / missing activity: the
 * reminder still surfaces, just without the deep-link.
 */
export async function listRemindersWithActivity(
  userId: UserId,
): Promise<ReminderWithActivity[]> {
  const rows = await sql<
    {
      id: string;
      userId: string;
      activityId: string | null;
      remindAt: string;
      title: string;
      note: string | null;
      createdAt: string;
      completedAt: string | null;
      dismissedAt: string | null;
      activityName: string | null;
      activityType: string | null;
    }[]
  >`
    select
      r.id,
      r.user_id,
      r.activity_id,
      r.remind_at::text    as remind_at,
      r.title,
      r.note,
      r.created_at::text   as created_at,
      r.completed_at::text as completed_at,
      r.dismissed_at::text as dismissed_at,
      a.name               as activity_name,
      a.type::text         as activity_type
    from public.reminders r
    left join public.activity a
      on a.id = r.activity_id
     and a.deleted_at is null
    where r.user_id      = ${userId}::uuid
      and r.completed_at is null
      and r.dismissed_at is null
    order by r.remind_at asc
  `;
  return rows.map((r) => ({
    ...toReminderRow(r),
    activityName: r.activityName,
    activityHref:
      r.activityId != null && r.activityType != null
        ? activityHref(r.activityId, r.activityType)
        : null,
  }));
}

/**
 * Map an activity id + type to its detail-page route. Kept local (rather than
 * imported from notifications.ts) so this module stays self-contained.
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
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a reminder. Validates the input and (when an activity is linked)
 * verifies the caller owns that activity — so a reminder can never point at
 * someone else's row. Returns the new reminder id.
 */
export async function createReminder(
  userId: UserId,
  input: CreateReminderInput,
): Promise<string> {
  // Pure validation first — title / remind_at / note / activity-id shape.
  const validation = validateReminderInput(input);
  if (!validation.ok) {
    throw new ReminderInputError(validation.error);
  }
  const { title, remindAtIso, note, activityId: linkedId } = validation.value;

  // Activity-ownership check needs a query — kept here, not in the validator.
  let activityId: string | null = null;
  if (linkedId != null) {
    const owned = await sql<{ id: string }[]>`
      select id from public.activity
      where id      = ${linkedId}::uuid
        and user_id = ${userId}::uuid
        and deleted_at is null
      limit 1
    `;
    if (owned.length === 0) {
      throw new ReminderInputError('Linked activity not found');
    }
    activityId = owned[0].id;
  }

  const rows = await sql<{ id: string }[]>`
    insert into public.reminders
      (user_id, activity_id, remind_at, title, note)
    values
      (
        ${userId}::uuid,
        ${activityId}::uuid,
        ${remindAtIso}::timestamptz,
        ${title},
        ${note}
      )
    returning id
  `;
  return rows[0].id;
}

/**
 * Mark a reminder complete. Owner-gated; no-op when the id is malformed,
 * not owned, or already terminal.
 */
export async function completeReminder(
  userId: UserId,
  reminderId: string,
): Promise<void> {
  if (!UUID_RE.test(reminderId)) return;
  await sql`
    update public.reminders
    set    completed_at = now()
    where  user_id      = ${userId}::uuid
      and  id           = ${reminderId}::uuid
      and  completed_at is null
      and  dismissed_at is null
  `;
  await dismissReminderNotification(userId, reminderId);
}

/**
 * Dismiss a reminder without completing it. Owner-gated; no-op when the id is
 * malformed, not owned, or already terminal.
 */
export async function dismissReminder(
  userId: UserId,
  reminderId: string,
): Promise<void> {
  if (!UUID_RE.test(reminderId)) return;
  await sql`
    update public.reminders
    set    dismissed_at = now()
    where  user_id      = ${userId}::uuid
      and  id           = ${reminderId}::uuid
      and  completed_at is null
      and  dismissed_at is null
  `;
  await dismissReminderNotification(userId, reminderId);
}

/**
 * Hard-delete a reminder. Owner-gated; no-op when the id is malformed or not
 * owned. The FK `notifications.reminder_id ... on delete cascade` removes any
 * materialized notification automatically.
 */
export async function deleteReminder(
  userId: UserId,
  reminderId: string,
): Promise<void> {
  if (!UUID_RE.test(reminderId)) return;
  await sql`
    delete from public.reminders
    where user_id = ${userId}::uuid
      and id      = ${reminderId}::uuid
  `;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Dismiss any bell notification the scanner already materialized for this
 * reminder. Called when a reminder goes terminal (complete / dismiss) so a
 * settled reminder stops nagging from the notification bell — otherwise a
 * `manual_reminder` row would stay unread forever, permanently inflating the
 * bell count. Idempotent: the `dismissed_at is null` guard makes a repeat call
 * a no-op, and it is owner-gated like every other query here. (A *deleted*
 * reminder needs no such call — the FK `notifications.reminder_id ... on
 * delete cascade` drops the materialized row outright.)
 */
async function dismissReminderNotification(
  userId: UserId,
  reminderId: string,
): Promise<void> {
  await sql`
    update public.notifications
    set    dismissed_at = now()
    where  user_id      = ${userId}::uuid
      and  reminder_id  = ${reminderId}::uuid
      and  dismissed_at is null
  `;
}

function toReminderRow(r: {
  id: string;
  userId: string;
  activityId: string | null;
  remindAt: string;
  title: string;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
  dismissedAt: string | null;
}): ReminderRow {
  return {
    id: r.id,
    userId: r.userId as UserId,
    activityId: (r.activityId as ReminderRow['activityId']) ?? null,
    remindAt: r.remindAt,
    title: r.title,
    note: r.note,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    dismissedAt: r.dismissedAt,
  };
}
