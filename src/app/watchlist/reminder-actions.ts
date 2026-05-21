'use server';

/**
 * Server actions for manual reminders — create / complete / dismiss / delete.
 *
 * A `"use server"` file may export ONLY async functions. Shared types live in
 * `@/lib/db/reminders-types`; re-exporting them here would crash at runtime.
 *
 * Each mutation revalidates the surfaces a reminder can appear on:
 *   • /watchlist — the Reminders section
 *   • /calendar  — forward-looking deadline badges include reminders
 */
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import {
  createReminder,
  completeReminder,
  dismissReminder,
  deleteReminder,
  ReminderInputError,
} from '@/lib/db/reminders';
import type {
  CreateReminderInput,
  ReminderActionResult,
} from '@/lib/db/reminders-types';

/** Paths whose server-rendered content depends on the reminder set. */
function revalidateReminderSurfaces(): void {
  revalidatePath('/watchlist');
  revalidatePath('/calendar');
}

/** Create a reminder for the current user. */
export async function createReminderAction(
  input: CreateReminderInput,
): Promise<ReminderActionResult> {
  try {
    const { id: userId } = await requireUser();
    await createReminder(userId, input);
    revalidateReminderSurfaces();
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Mark a reminder complete. */
export async function completeReminderAction(
  reminderId: string,
): Promise<ReminderActionResult> {
  try {
    const { id: userId } = await requireUser();
    await completeReminder(userId, reminderId);
    revalidateReminderSurfaces();
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Dismiss a reminder without completing it. */
export async function dismissReminderAction(
  reminderId: string,
): Promise<ReminderActionResult> {
  try {
    const { id: userId } = await requireUser();
    await dismissReminder(userId, reminderId);
    revalidateReminderSurfaces();
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Delete a reminder. The FK cascade removes any materialized notification.
 */
export async function deleteReminderAction(
  reminderId: string,
): Promise<ReminderActionResult> {
  try {
    const { id: userId } = await requireUser();
    await deleteReminder(userId, reminderId);
    revalidateReminderSurfaces();
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Normalize an error into a result envelope — surfaces input errors verbatim. */
function toResult(e: unknown): ReminderActionResult {
  if (e instanceof ReminderInputError) {
    return { ok: false, error: e.message };
  }
  return {
    ok: false,
    error: e instanceof Error ? e.message : String(e),
  };
}
