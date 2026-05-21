/**
 * Pure reminder-countdown helpers.
 *
 * Extracted from the watchlist Reminders section so the day-delta + countdown
 * formatting can be unit-tested deterministically (the "now" reference is an
 * injectable argument).
 */

/** Localized countdown labels — supplied by the caller via i18n. */
export interface CountdownLabels {
  today: string;
  tomorrow: string;
  overdue: string;
}

/**
 * Whole-day delta from `now`'s local calendar day (midnight) to `remindAt`'s
 * local calendar day. Negative when overdue, 0 when due today, 1 = tomorrow.
 *
 * Both arguments are Date instances; the comparison is done on local calendar
 * days so a reminder later today still reads "Today", not "Tomorrow".
 */
export function daysUntilReminder(remindAt: Date, now: Date = new Date()): number {
  const startOfNow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const remindDay = new Date(
    remindAt.getFullYear(),
    remindAt.getMonth(),
    remindAt.getDate(),
  );
  return Math.round(
    (remindDay.getTime() - startOfNow.getTime()) / 86_400_000,
  );
}

/**
 * Format a whole-day delta into a short countdown string:
 *   < 0  → "Overdue · Nd"
 *   0    → "Today"
 *   1    → "Tomorrow"
 *   > 1  → "Nd"
 * `null` (e.g. an unparseable date) renders as an em-dash.
 */
export function formatReminderCountdown(
  days: number | null,
  labels: CountdownLabels,
): string {
  if (days == null) return '—';
  if (days < 0) return `${labels.overdue} · ${Math.abs(days)}d`;
  if (days === 0) return labels.today;
  if (days === 1) return labels.tomorrow;
  return `${days}d`;
}
