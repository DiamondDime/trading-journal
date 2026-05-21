/**
 * Unit tests for the pure reminder-input validator.
 *
 * `validateReminderInput` gates every createReminder call — title / remind_at
 * / note / activity-id shape. Locked here so the rules can't silently drift.
 */
import { describe, expect, it } from "vitest";
import {
  validateReminderInput,
  REMINDER_TITLE_MAX,
  REMINDER_NOTE_MAX,
} from "../../src/lib/reminders/validate";
import type { CreateReminderInput } from "../../src/lib/db/reminders-types";

function input(over: Partial<CreateReminderInput> = {}): CreateReminderInput {
  return {
    title: "Check the airdrop claim window",
    remindAt: "2026-06-01T12:00:00.000Z",
    ...over,
  };
}

describe("validateReminderInput — success", () => {
  it("accepts a minimal valid input and trims the title", () => {
    const r = validateReminderInput(input({ title: "  Do the thing  " }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.title).toBe("Do the thing");
  });

  it("normalizes remind_at to a UTC ISO instant", () => {
    const r = validateReminderInput(input({ remindAt: "2026-06-01T12:00:00Z" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.remindAtIso).toBe("2026-06-01T12:00:00.000Z");
  });

  it("treats a blank note as null", () => {
    const r = validateReminderInput(input({ note: "   " }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.note).toBeNull();
  });

  it("keeps a non-blank note (trimmed)", () => {
    const r = validateReminderInput(input({ note: "  extra context  " }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.note).toBe("extra context");
  });

  it("passes through a valid linked activity uuid", () => {
    const uuid = "aabbccdd-1111-2222-3333-444455556666";
    const r = validateReminderInput(input({ activityId: uuid }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.activityId).toBe(uuid);
  });

  it("treats an empty-string activityId as no link", () => {
    const r = validateReminderInput(input({ activityId: "" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.activityId).toBeNull();
  });

  it("treats a null activityId as no link", () => {
    const r = validateReminderInput(input({ activityId: null }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.activityId).toBeNull();
  });
});

describe("validateReminderInput — rejection", () => {
  it("rejects an empty title", () => {
    const r = validateReminderInput(input({ title: "   " }));
    expect(r).toEqual({ ok: false, error: "Title is required" });
  });

  it("rejects a title over the length cap", () => {
    const r = validateReminderInput(input({ title: "x".repeat(REMINDER_TITLE_MAX + 1) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/200 characters/);
  });

  it("accepts a title exactly at the length cap", () => {
    const r = validateReminderInput(input({ title: "x".repeat(REMINDER_TITLE_MAX) }));
    expect(r.ok).toBe(true);
  });

  it("rejects an unparseable remind_at", () => {
    const r = validateReminderInput(input({ remindAt: "not-a-date" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/valid remind-at/);
  });

  it("rejects an empty remind_at", () => {
    const r = validateReminderInput(input({ remindAt: "" }));
    expect(r.ok).toBe(false);
  });

  it("rejects a note over the length cap", () => {
    const r = validateReminderInput(input({ note: "x".repeat(REMINDER_NOTE_MAX + 1) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2000 characters/);
  });

  it("rejects a malformed activity id", () => {
    const r = validateReminderInput(input({ activityId: "not-a-uuid" }));
    expect(r).toEqual({ ok: false, error: "Linked activity is invalid" });
  });
});
