/**
 * Pure reminder-input validation.
 *
 * Extracted from the DB layer so it can be unit-tested without a database and
 * reused anywhere a reminder is constructed. Holds no I/O — activity-ownership
 * checks stay in the DB layer (they need a query).
 */
import type { CreateReminderInput } from '@/lib/db/reminders-types';

export const REMINDER_TITLE_MAX = 200;
export const REMINDER_NOTE_MAX = 2000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reminder input that has passed validation — fields normalized. */
export interface ValidatedReminderInput {
  /** Trimmed, non-empty, length-checked title. */
  title: string;
  /** Canonical UTC ISO 8601 instant derived from the input's remindAt. */
  remindAtIso: string;
  /** Trimmed note, or null when blank. */
  note: string | null;
  /** Validated UUID, or null when no activity is linked. */
  activityId: string | null;
}

/** Discriminated result of {@link validateReminderInput}. */
export type ReminderValidation =
  | { ok: true; value: ValidatedReminderInput }
  | { ok: false; error: string };

/**
 * Validate + normalize a create-reminder input. Pure — does NOT verify that a
 * linked activity exists or is owned (that requires a DB query). On success
 * returns the normalized fields ready to insert.
 */
export function validateReminderInput(
  input: CreateReminderInput,
): ReminderValidation {
  const title = input.title.trim();
  if (title.length === 0) {
    return { ok: false, error: 'Title is required' };
  }
  if (title.length > REMINDER_TITLE_MAX) {
    return {
      ok: false,
      error: `Title must be ${REMINDER_TITLE_MAX} characters or fewer`,
    };
  }

  // Only the SHAPE of remind_at is validated, not its direction: a past
  // timestamp is allowed on purpose — a back-dated reminder simply fires on
  // the very next scan, which is the desired "remind me now" behaviour. The
  // dialog defaults the picker ~1h out, so a past value is a deliberate choice.
  const remindAtMs = Date.parse(input.remindAt);
  if (!Number.isFinite(remindAtMs)) {
    return { ok: false, error: 'A valid remind-at date/time is required' };
  }
  const remindAtIso = new Date(remindAtMs).toISOString();

  const trimmedNote = input.note?.trim();
  const note = trimmedNote ? trimmedNote : null;
  if (note != null && note.length > REMINDER_NOTE_MAX) {
    return {
      ok: false,
      error: `Note must be ${REMINDER_NOTE_MAX} characters or fewer`,
    };
  }

  let activityId: string | null = null;
  if (input.activityId != null && input.activityId !== '') {
    if (!UUID_RE.test(input.activityId)) {
      return { ok: false, error: 'Linked activity is invalid' };
    }
    activityId = input.activityId;
  }

  return { ok: true, value: { title, remindAtIso, note, activityId } };
}
