/**
 * Unit tests for the pure reminder-countdown helpers.
 *
 * `daysUntilReminder` + `formatReminderCountdown` drive the watchlist
 * Reminders section's per-row countdown. The "now" reference is injected so
 * the assertions are deterministic regardless of when the suite runs.
 */
import { describe, expect, it } from "vitest";
import {
  daysUntilReminder,
  formatReminderCountdown,
  type CountdownLabels,
} from "../../src/lib/reminders/countdown";

const LABELS: CountdownLabels = {
  today: "Today",
  tomorrow: "Tomorrow",
  overdue: "Overdue",
};

describe("daysUntilReminder", () => {
  // Anchor "now" to a fixed local wall-clock instant for every case.
  const now = new Date(2026, 4, 22, 14, 30); // 2026-05-22 14:30 local

  it("returns 0 for a reminder later the same calendar day", () => {
    const remind = new Date(2026, 4, 22, 23, 59);
    expect(daysUntilReminder(remind, now)).toBe(0);
  });

  it("returns 0 for a reminder earlier the same calendar day (still today)", () => {
    const remind = new Date(2026, 4, 22, 1, 0);
    expect(daysUntilReminder(remind, now)).toBe(0);
  });

  it("returns 1 for a reminder tomorrow", () => {
    const remind = new Date(2026, 4, 23, 9, 0);
    expect(daysUntilReminder(remind, now)).toBe(1);
  });

  it("returns a positive count for a reminder several days out", () => {
    const remind = new Date(2026, 4, 29, 0, 0);
    expect(daysUntilReminder(remind, now)).toBe(7);
  });

  it("returns a negative count for an overdue reminder", () => {
    const remind = new Date(2026, 4, 19, 8, 0);
    expect(daysUntilReminder(remind, now)).toBe(-3);
  });

  it("handles a month boundary", () => {
    const remind = new Date(2026, 5, 1, 0, 0); // 2026-06-01
    expect(daysUntilReminder(remind, now)).toBe(10);
  });
});

describe("formatReminderCountdown", () => {
  it("renders today / tomorrow with their labels", () => {
    expect(formatReminderCountdown(0, LABELS)).toBe("Today");
    expect(formatReminderCountdown(1, LABELS)).toBe("Tomorrow");
  });

  it("renders a plain day count for 2+ days out", () => {
    expect(formatReminderCountdown(5, LABELS)).toBe("5d");
  });

  it("renders an overdue reminder with the absolute day count", () => {
    expect(formatReminderCountdown(-3, LABELS)).toBe("Overdue · 3d");
  });

  it("renders an em-dash for a null delta", () => {
    expect(formatReminderCountdown(null, LABELS)).toBe("—");
  });
});
