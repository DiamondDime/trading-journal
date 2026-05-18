"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db/client";

/**
 * Allowed time zone IDs for the profile form. A short curated list keeps
 * v1 simple — no autocomplete, no full IANA picker. If users want something
 * exotic they can update the row in psql directly until v2.
 */
export const ALLOWED_TIMEZONES = [
  "Etc/UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Dubai",
  "Australia/Sydney",
] as const;

export type AllowedTimezone = (typeof ALLOWED_TIMEZONES)[number];

/**
 * Allowed base currency codes — major fiats only for v1. Adding crypto
 * (BTC, ETH) requires every pricing report to handle non-fiat denomination,
 * which is out of scope today.
 */
export const ALLOWED_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD"] as const;

export type AllowedCurrency = (typeof ALLOWED_CURRENCIES)[number];

const MAX_DISPLAY_NAME_LEN = 64;

/**
 * Server action state shape — what `useActionState` carries between the
 * form's previous render and the next. Mirrors what the client UI needs:
 * a translation key for the inline message + an optional ISO timestamp
 * for the "Saved at …" indicator.
 */
export interface ProfileFormState {
  /**
   * - `idle`: initial / never submitted.
   * - `success`: last submit wrote successfully; `savedAt` is set.
   * - `error`: last submit failed validation or hit a DB error.
   */
  status: "idle" | "success" | "error";
  /**
   * i18n key to render under the form. Server returns a key (not a
   * pre-translated string) so the form stays correct when the locale
   * cookie changes between submits without a full reload.
   */
  errorKey?:
    | "settings.profile.validation.displayNameTooLong"
    | "settings.profile.validation.invalidTimezone"
    | "settings.profile.validation.invalidCurrency"
    | "settings.profile.status.error";
  /** ISO 8601 timestamp of the successful write — formatted by the client. */
  savedAt?: string;
}

export const INITIAL_PROFILE_STATE: ProfileFormState = { status: "idle" };

function isAllowedTimezone(value: unknown): value is AllowedTimezone {
  return typeof value === "string" && (ALLOWED_TIMEZONES as readonly string[]).includes(value);
}

function isAllowedCurrency(value: unknown): value is AllowedCurrency {
  return typeof value === "string" && (ALLOWED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Update the single-user profile row. Called from the /settings/profile
 * form via `useActionState`.
 *
 * Validation:
 *   - displayName ≤ 64 chars (or null/empty → stored as NULL).
 *   - timezone   ∈ ALLOWED_TIMEZONES.
 *   - baseCurrency ∈ ALLOWED_CURRENCIES.
 *
 * On success: writes to `public.profiles`, revalidates `/settings/profile`
 * + the root layout (so the sidebar avatar re-renders), returns
 * `{ status: 'success', savedAt: <iso> }` for the client banner.
 */
export async function updateProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const rawDisplayName = formData.get("displayName");
  const rawTimezone = formData.get("timezone");
  const rawCurrency = formData.get("baseCurrency");

  // Normalise the display name. Empty / whitespace-only string is stored as
  // NULL so the sidebar falls back to the email-based initials.
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

  // Refresh the profile page itself + the root layout so every page that
  // mounts the <Sidebar /> server component picks up the new display name
  // and recomputed initials on the very next navigation.
  revalidatePath("/settings/profile");
  revalidatePath("/", "layout");

  return { status: "success", savedAt: new Date().toISOString() };
}
