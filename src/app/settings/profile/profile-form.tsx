"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { updateProfile } from "./actions";
import {
  INITIAL_PROFILE_STATE,
  TIMEZONE_OPTIONS,
  normalizeStoredTimezone,
  type ProfileFormState,
} from "./constants";

export interface ProfileFormProps {
  /** Pre-loaded values from the profiles row. */
  initialDisplayName: string | null;
  initialTimezone: string;
}

/**
 * Editable profile form. Two fields only: display name + timezone (UTC
 * offset). Email isn't editable (it's the identity), and base currency
 * was removed from v1 because the journal only computes USD totals today.
 */
export function ProfileForm({
  initialDisplayName,
  initialTimezone,
}: ProfileFormProps) {
  const t = useT();
  const [state, formAction] = useActionState<ProfileFormState, FormData>(
    updateProfile,
    INITIAL_PROFILE_STATE,
  );

  // The DB may hold a legacy bare-string timezone like "UTC". Normalize
  // it to a value that exists in TIMEZONE_OPTIONS so the select renders
  // a real option (not a phantom blank that vanishes on save).
  const selectedTimezone = normalizeStoredTimezone(initialTimezone);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <div className="grid grid-cols-1 divide-y divide-border rounded-md border border-border bg-surface">
        <FieldShell
          label={t("settings.profile.displayName")}
          htmlFor="profile-display-name"
        >
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

        <FieldShell
          label={t("settings.profile.timezone")}
          htmlFor="profile-timezone"
        >
          <select
            id="profile-timezone"
            name="timezone"
            defaultValue={selectedTimezone}
            className="w-full rounded border border-border bg-inset px-3 py-2 font-mono text-[12px] text-text focus:border-border-strong focus:outline-none"
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
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
  return (
    <span
      aria-hidden
      className="font-mono text-[10px] uppercase tracking-[0.18em] text-transparent"
    >
      ·
    </span>
  );
}

function formatLocalTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
