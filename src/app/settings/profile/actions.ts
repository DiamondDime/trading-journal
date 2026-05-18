"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db/client";
import {
  ALLOWED_CURRENCIES,
  ALLOWED_TIMEZONES,
  MAX_DISPLAY_NAME_LEN,
  type AllowedCurrency,
  type AllowedTimezone,
  type ProfileFormState,
} from "./constants";

function isAllowedTimezone(value: unknown): value is AllowedTimezone {
  return typeof value === "string" && (ALLOWED_TIMEZONES as readonly string[]).includes(value);
}

function isAllowedCurrency(value: unknown): value is AllowedCurrency {
  return typeof value === "string" && (ALLOWED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Update the single-user profile row. Called from the /settings/profile
 * form via `useActionState`.
 */
export async function updateProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const rawDisplayName = formData.get("displayName");
  const rawTimezone = formData.get("timezone");
  const rawCurrency = formData.get("baseCurrency");

  const trimmed = typeof rawDisplayName === "string" ? rawDisplayName.trim() : "";
  if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
    return { status: "error", errorKey: "settings.profile.validation.displayNameTooLong" };
  }
  const displayName: string | null = trimmed.length > 0 ? trimmed : null;

  if (!isAllowedTimezone(rawTimezone)) {
    return { status: "error", errorKey: "settings.profile.validation.invalidTimezone" };
  }
  if (!isAllowedCurrency(rawCurrency)) {
    return { status: "error", errorKey: "settings.profile.validation.invalidCurrency" };
  }

  try {
    const { id: userId } = await requireUser();
    await sql`
      UPDATE public.profiles
      SET
        display_name  = ${displayName},
        timezone      = ${rawTimezone},
        base_currency = ${rawCurrency},
        updated_at    = NOW()
      WHERE id = ${userId}::uuid
    `;
  } catch {
    return { status: "error", errorKey: "settings.profile.status.error" };
  }

  revalidatePath("/settings/profile");
  revalidatePath("/", "layout");

  return { status: "success", savedAt: new Date().toISOString() };
}
