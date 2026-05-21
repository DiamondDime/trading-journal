/**
 * Shared reminder types.
 *
 * Lives in a plain (non-`"use server"`) module so it can be imported by both
 * the DB layer and the server-actions file. A `"use server"` file may export
 * ONLY async functions — re-exporting a type/interface from it triggers a
 * runtime ReferenceError. Keep all shared reminder types here.
 */
import type { ActivityId, Iso8601, UserId } from '@/types/canonical';

/** A reminder row as surfaced to the UI. */
export interface ReminderRow {
  id: string;
  userId: UserId;
  /** Linked activity, or null for a standalone reminder. */
  activityId: ActivityId | null;
  /** When the reminder is due — ISO 8601 timestamp. */
  remindAt: Iso8601;
  title: string;
  note: string | null;
  createdAt: Iso8601;
  completedAt: Iso8601 | null;
  dismissedAt: Iso8601 | null;
}

/** Input shape for createReminder. Money/quantity-free, so plain strings. */
export interface CreateReminderInput {
  /** ISO 8601 timestamp (e.g. from a datetime-local input, converted to UTC). */
  remindAt: string;
  title: string;
  /** Optional free-text note. */
  note?: string | null;
  /** Optional activity to link the reminder to. */
  activityId?: string | null;
}

/** Result envelope returned by every reminder server action. */
export type ReminderActionResult =
  | { ok: true }
  | { ok: false; error: string };
