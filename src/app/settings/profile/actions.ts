"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db/client";
import {
  ALLOWED_TIMEZONE_VALUES,
  MAX_DISPLAY_NAME_LEN,
  type ProfileFormState,
} from "./constants";

function isAllowedTimezone(value: unknown): value is string {
  return typeof value === "string" && ALLOWED_TIMEZONE_VALUES.includes(value);
}

/**
 * Update the single-user profile row from the /settings/profile form.
 *
 * Fields written: display_name + timezone. Email is not editable (it's
 * the identity); base_currency is no longer exposed in the UI and stays
 * at whatever it was set to (defaults to 'USD' for analytics that still
 * read it).
 */
export async function updateProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const rawDisplayName = formData.get("displayName");
  const rawTimezone = formData.get("timezone");

  const trimmed = typeof rawDisplayName === "string" ? rawDisplayName.trim() : "";
  if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
    return { status: "error", errorKey: "settings.profile.validation.displayNameTooLong" };
  }
  const displayName: string | null = trimmed.length > 0 ? trimmed : null;

  if (!isAllowedTimezone(rawTimezone)) {
    return { status: "error", errorKey: "settings.profile.validation.invalidTimezone" };
  }

  try {
    const { id: userId } = await requireUser();
    await sql`
      UPDATE public.profiles
      SET
        display_name = ${displayName},
        timezone     = ${rawTimezone},
        updated_at   = NOW()
      WHERE id = ${userId}::uuid
    `;
  } catch {
    return { status: "error", errorKey: "settings.profile.status.error" };
  }

  revalidatePath("/settings/profile");
  revalidatePath("/", "layout");

  return { status: "success", savedAt: new Date().toISOString() };
}
