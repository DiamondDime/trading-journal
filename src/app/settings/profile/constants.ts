/**
 * Profile-form constants and state types.
 *
 * These live OUTSIDE `actions.ts` because Next.js + React 19's `"use server"`
 * directive forbids non-async-function exports. Bundling these alongside
 * `updateProfile` caused `INITIAL_PROFILE_STATE` to resolve as `undefined`
 * at runtime — `useActionState(updateProfile, undefined)` then crashed the
 * `/settings/profile` page on first render.
 */

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

/**
 * Server action state shape — what `useActionState` carries between the
 * form's previous render and the next.
 */
export interface ProfileFormState {
  status: "idle" | "success" | "error";
  errorKey?:
    | "settings.profile.validation.displayNameTooLong"
    | "settings.profile.validation.invalidTimezone"
    | "settings.profile.validation.invalidCurrency"
    | "settings.profile.status.error";
  savedAt?: string;
}

export const INITIAL_PROFILE_STATE: ProfileFormState = { status: "idle" };

export const MAX_DISPLAY_NAME_LEN = 64;
