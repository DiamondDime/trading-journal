"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { updateProfile } from "./actions";
import {
  ALLOWED_CURRENCIES,
  ALLOWED_TIMEZONES,
  INITIAL_PROFILE_STATE,
  type AllowedCurrency,
  type AllowedTimezone,
  type ProfileFormState,
} from "./constants";

export interface ProfileFormProps {
  /** Pre-loaded values from the profiles row. */
  initialDisplayName: string | null;
  initialTimezone: string;
  initialBaseCurrency: string;
  /** Read-only — displayed but never submitted. */
  email: string;
}

/**
 * Editable profile form. React 19 `useActionState` carries form-result
 * state (success/error/savedAt) across the submit roundtrip without any
 * client-side fetch. The submit button uses `useFormStatus` so it shows
 * a "Saving…" label without us managing pending state manually.
 */
export function ProfileForm({
  initialDisplayName,
  initialTimezone,
  initialBaseCurrency,
  email,
}: ProfileFormProps) {
  const t = useT();
  const [state, formAction] = useActionState<ProfileFormState, FormData>(
    updateProfile,
    INITIAL_PROFILE_STATE,
  );

  // If the server returns a timezone/currency value the curated list no
  // longer contains (e.g. someone edited Postgres directly), the <select>
  // would render with a blank value and silently swap on save. Add the
  // unrecognised value as an inert option so the user has to opt in.
  const timezoneOptions: readonly string[] = ALLOWED_TIMEZONES.includes(
    initialTimezone as AllowedTimezone,
  )
    ? ALLOWED_TIMEZONES
    : [initialTimezone, ...ALLOWED_TIMEZONES];
  const currencyOptions: readonly string[] = ALLOWED_CURRENCIES.includes(
    initialBaseCurrency as AllowedCurrency,
  )
    ? ALLOWED_CURRENCIES
    : [initialBaseCurrency, ...ALLOWED_CURRENCIES];

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <div className="grid grid-cols-1 divide-y divide-border rounded-md border border-border bg-surface">
        <FieldShell label={t("settings.profile.displayName")} htmlFor="profile-display-name">
          <input
            id="profile-display-name"
            name="displayName"
            type="text"
            defaultValue={initialDisplayName ?? ""}
            maxLength={64}
            placeholder={t("settings.profile.placeholders.displayName")}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded border border-border bg-inset px-3 py-2 font-mono text-[12px] text-text placeholder:text-text-tertiary focus:border-border-strong focus:outline-none"
          />
        </FieldShell>

        <FieldShell label={t("settings.profile.email")}>
          <p className="font-mono text-[12px] text-text-secondary" data-testid="profile-email">
            {email}
          </p>
        </FieldShell>

        <FieldShell label={t("settings.profile.timezone")} htmlFor="profile-timezone">
          <select
            id="profile-timezone"
            name="timezone"
            defaultValue={initialTimezone}
            className="w-full rounded border border-border bg-inset px-3 py-2 font-mono text-[12px] text-text focus:border-border-strong focus:outline-none"
          >
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </FieldShell>

        <FieldShell label={t("settings.profile.baseCurrency")} htmlFor="profile-base-currency">
          <select
            id="profile-base-currency"
            name="baseCurrency"
            defaultValue={initialBaseCurrency}
            className="w-full rounded border border-border bg-inset px-3 py-2 font-mono text-[12px] text-text focus:border-border-strong focus:outline-none"
          >
            {currencyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FieldShell>
      </div>

      <div className="flex items-center justify-between gap-4">
        <SubmitButton />
        <FormStatusLine state={state} />
      </div>
    </form>
  );
}

function FieldShell({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 px-5 py-4 md:grid-cols-[180px_1fr] md:items-center md:gap-6">
      <label
        htmlFor={htmlFor}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary"
      >
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SubmitButton() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
        pending
          ? "cursor-not-allowed border-border bg-subtle text-text-disabled"
          : "border-text bg-text text-app hover:bg-text-secondary",
      )}
    >
      {pending ? t("settings.profile.actions.saving") : t("settings.profile.actions.save")}
    </button>
  );
}

/**
 * Inline status line under the submit button — shows a localized "Saved at
 * HH:MM:SS" stamp on success, or the appropriate validation/DB-error key on
 * failure. `aria-live` polite so screen readers pick up the change without
 * stealing focus mid-edit.
 */
function FormStatusLine({ state }: { state: ProfileFormState }) {
  const t = useT();

  if (state.status === "success" && state.savedAt) {
    const timestamp = formatLocalTime(state.savedAt);
    return (
      <p
        aria-live="polite"
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-up"
      >
        {t("settings.profile.status.saved", { time: timestamp })}
      </p>
    );
  }
  if (state.status === "error" && state.errorKey) {
    return (
      <p
        role="alert"
        aria-live="polite"
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-down"
      >
        {t(state.errorKey)}
      </p>
    );
  }
  return <span aria-hidden className="font-mono text-[10px] uppercase tracking-[0.18em] text-transparent">·</span>;
}

function formatLocalTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const d = new Date(ts);
  // 24-hour HH:MM:SS — locale-independent so EN and RU render identically.
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
