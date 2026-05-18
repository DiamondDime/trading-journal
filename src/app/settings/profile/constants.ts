/**
 * Profile-form constants and state types.
 *
 * Lives outside `actions.ts` because Next.js + React 19's `"use server"`
 * directive only permits async-function exports. Bundling non-function
 * exports alongside the server action makes them resolve to `undefined`
 * at runtime and crashes the consumer.
 */

/**
 * One row in the timezone selector. The user sees the UTC-offset label
 * (e.g. "UTC+05:30 (India)"); the database stores the underlying IANA
 * timezone string so `Intl.DateTimeFormat({ timeZone })` keeps working.
 *
 * For integer offsets we use `Etc/GMT±N` zones (which never observe DST,
 * matching the user's intuition that "UTC+1 means UTC+1, always"). The
 * POSIX sign convention is inverted relative to ISO — "UTC+1" maps to
 * `Etc/GMT-1`. Read carefully when editing this table.
 *
 * For fractional offsets we use specific IANA cities that currently
 * observe a stable non-DST offset (India, Nepal, Kabul, etc.).
 */
export interface TimezoneOption {
  /** What the user sees in the dropdown. */
  readonly label: string;
  /** What we write to `profiles.timezone` and pass to Intl APIs. */
  readonly value: string;
  /** Used for sort + lookup. */
  readonly offsetMinutes: number;
}

export const TIMEZONE_OPTIONS: readonly TimezoneOption[] = [
  { label: "UTC−12:00", value: "Etc/GMT+12", offsetMinutes: -720 },
  { label: "UTC−11:00", value: "Etc/GMT+11", offsetMinutes: -660 },
  { label: "UTC−10:00", value: "Etc/GMT+10", offsetMinutes: -600 },
  { label: "UTC−09:00", value: "Etc/GMT+9", offsetMinutes: -540 },
  { label: "UTC−08:00", value: "Etc/GMT+8", offsetMinutes: -480 },
  { label: "UTC−07:00", value: "Etc/GMT+7", offsetMinutes: -420 },
  { label: "UTC−06:00", value: "Etc/GMT+6", offsetMinutes: -360 },
  { label: "UTC−05:00", value: "Etc/GMT+5", offsetMinutes: -300 },
  { label: "UTC−04:00", value: "Etc/GMT+4", offsetMinutes: -240 },
  { label: "UTC−03:00", value: "Etc/GMT+3", offsetMinutes: -180 },
  { label: "UTC−02:00", value: "Etc/GMT+2", offsetMinutes: -120 },
  { label: "UTC−01:00", value: "Etc/GMT+1", offsetMinutes: -60 },
  { label: "UTC±00:00", value: "Etc/UTC", offsetMinutes: 0 },
  { label: "UTC+01:00", value: "Etc/GMT-1", offsetMinutes: 60 },
  { label: "UTC+02:00", value: "Etc/GMT-2", offsetMinutes: 120 },
  { label: "UTC+03:00", value: "Etc/GMT-3", offsetMinutes: 180 },
  { label: "UTC+03:30 (Iran)", value: "Asia/Tehran", offsetMinutes: 210 },
  { label: "UTC+04:00", value: "Etc/GMT-4", offsetMinutes: 240 },
  { label: "UTC+04:30 (Afghanistan)", value: "Asia/Kabul", offsetMinutes: 270 },
  { label: "UTC+05:00", value: "Etc/GMT-5", offsetMinutes: 300 },
  { label: "UTC+05:30 (India / Sri Lanka)", value: "Asia/Kolkata", offsetMinutes: 330 },
  { label: "UTC+05:45 (Nepal)", value: "Asia/Kathmandu", offsetMinutes: 345 },
  { label: "UTC+06:00", value: "Etc/GMT-6", offsetMinutes: 360 },
  { label: "UTC+06:30 (Myanmar)", value: "Asia/Yangon", offsetMinutes: 390 },
  { label: "UTC+07:00", value: "Etc/GMT-7", offsetMinutes: 420 },
  { label: "UTC+08:00", value: "Etc/GMT-8", offsetMinutes: 480 },
  { label: "UTC+09:00", value: "Etc/GMT-9", offsetMinutes: 540 },
  { label: "UTC+09:30 (Darwin)", value: "Australia/Darwin", offsetMinutes: 570 },
  { label: "UTC+10:00", value: "Etc/GMT-10", offsetMinutes: 600 },
  { label: "UTC+11:00", value: "Etc/GMT-11", offsetMinutes: 660 },
  { label: "UTC+12:00", value: "Etc/GMT-12", offsetMinutes: 720 },
  { label: "UTC+13:00", value: "Etc/GMT-13", offsetMinutes: 780 },
  { label: "UTC+14:00", value: "Etc/GMT-14", offsetMinutes: 840 },
];

export const ALLOWED_TIMEZONE_VALUES: readonly string[] =
  TIMEZONE_OPTIONS.map((o) => o.value);

/**
 * Normalize a raw `profiles.timezone` cell into a value that exists in
 * `TIMEZONE_OPTIONS`. Older seed rows used bare strings like `"UTC"` that
 * fail validation; this maps them to the canonical form so the form
 * doesn't show a phantom selection that vanishes on save.
 */
export function normalizeStoredTimezone(raw: string | null | undefined): string {
  if (!raw) return "Etc/UTC";
  if (ALLOWED_TIMEZONE_VALUES.includes(raw)) return raw;
  const aliases: Record<string, string> = {
    UTC: "Etc/UTC",
    GMT: "Etc/UTC",
    "Etc/GMT": "Etc/UTC",
    "Etc/GMT+0": "Etc/UTC",
    "Etc/GMT-0": "Etc/UTC",
  };
  return aliases[raw] ?? "Etc/UTC";
}

/**
 * Server action state shape — what `useActionState` carries between the
 * form's previous render and the next.
 */
export interface ProfileFormState {
  status: "idle" | "success" | "error";
  errorKey?:
    | "settings.profile.validation.displayNameTooLong"
    | "settings.profile.validation.invalidTimezone"
    | "settings.profile.status.error";
  savedAt?: string;
}

export const INITIAL_PROFILE_STATE: ProfileFormState = { status: "idle" };

export const MAX_DISPLAY_NAME_LEN = 64;
