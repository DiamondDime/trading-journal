"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellPlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogEyebrow,
  DialogBody,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createReminderAction } from "@/app/watchlist/reminder-actions";

interface SetReminderDialogProps {
  /**
   * Optional activity to link the reminder to. When set, the dialog is in
   * "linked" mode — it has no activity selector and the reminder is created
   * against this activity. When omitted, the reminder is standalone.
   */
  activityId?: string;
  /** Human label for the linked activity — shown read-only when linked. */
  activityName?: string;
  /**
   * The trigger element. Required — the caller supplies its own button so the
   * dialog drops into watchlist headers, activity-detail action rows, etc.
   */
  children: React.ReactNode;
}

/**
 * Set-reminder dialog.
 *
 * Fields: remind-at (datetime-local), title, optional note. When opened with
 * an `activityId` the reminder is linked to that activity; otherwise it is a
 * standalone reminder. Mirrors the bulk-regime-tag dialog's two-step
 * (form → done) shape and the journal's editorial visual language.
 *
 * On success it calls router.refresh() so the watchlist / calendar pick up
 * the new reminder without a full reload.
 */
export function SetReminderDialog({
  activityId,
  activityName,
  children,
}: SetReminderDialogProps) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<"form" | "done">("form");
  const [remindAt, setRemindAt] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const titleRef = React.useRef<HTMLInputElement>(null);
  const isLinked = activityId != null && activityId !== "";

  // Reset every field on the open transition. Done in the open-change handler
  // (not a useEffect) so it runs as an event, not a render side-effect — and
  // remind-at defaults to ~1h out so the picker is never blank.
  function handleOpenChange(next: boolean) {
    if (next) {
      setStep("form");
      setRemindAt(defaultRemindAt());
      setTitle("");
      setNote("");
      setError(null);
      setSubmitting(false);
    }
    setOpen(next);
  }

  // Focus the title input once the dialog is open + on the form step. Focus is
  // a genuine DOM side-effect, so this stays a useEffect (no setState inside).
  React.useEffect(() => {
    if (!open || step !== "form") return;
    const tid = setTimeout(() => titleRef.current?.focus(), 80);
    return () => clearTimeout(tid);
  }, [open, step]);

  const canSubmit =
    title.trim().length > 0 && remindAt.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!title.trim()) {
      setError(t("reminders.errors.titleRequired"));
      return;
    }
    if (!remindAt.trim()) {
      setError(t("reminders.errors.remindAtRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);

    // datetime-local yields a local wall-clock string with no zone. Construct
    // a Date from it (interpreted in the browser's TZ) and send ISO/UTC so the
    // server stores an unambiguous instant.
    const localDate = new Date(remindAt);
    if (!Number.isFinite(localDate.getTime())) {
      setSubmitting(false);
      setError(t("reminders.errors.remindAtRequired"));
      return;
    }

    const result = await createReminderAction({
      remindAt: localDate.toISOString(),
      title: title.trim(),
      note: note.trim() ? note.trim() : null,
      activityId: isLinked ? activityId : null,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error || t("reminders.errors.generic"));
      return;
    }
    setStep("done");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogEyebrow>{t("reminders.dialog.eyebrow")}</DialogEyebrow>
          <DialogTitle>
            {isLinked
              ? t("reminders.dialog.titleLinked")
              : t("reminders.dialog.titleNew")}
          </DialogTitle>
          {step === "form" && (
            <DialogDescription>
              {t("reminders.dialog.description")}
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "done" ? (
          <>
            <DialogBody>
              <p className="font-serif text-[15px] text-text">
                {t("reminders.dialog.doneTitle")}
              </p>
              <p className="mt-2 font-mono text-[11px] text-text-tertiary">
                {t("reminders.dialog.doneHint")}
              </p>
            </DialogBody>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border border-border bg-surface",
                  "px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text",
                  "transition-colors hover:border-border-strong hover:bg-subtle",
                )}
              >
                {t("common.close")}
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="flex flex-col gap-4">
              {/* Title */}
              <Field
                label={t("reminders.dialog.titleLabel")}
                htmlFor="reminder-title"
                helper={t("reminders.dialog.titleHelper")}
              >
                <input
                  ref={titleRef}
                  id="reminder-title"
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.currentTarget.value);
                    setError(null);
                  }}
                  placeholder={t("reminders.dialog.titlePlaceholder")}
                  maxLength={200}
                  className={inputClass}
                />
              </Field>

              {/* Remind-at */}
              <Field
                label={t("reminders.dialog.remindAtLabel")}
                htmlFor="reminder-remind-at"
                helper={t("reminders.dialog.remindAtHelper")}
              >
                <input
                  id="reminder-remind-at"
                  type="datetime-local"
                  value={remindAt}
                  onChange={(e) => {
                    setRemindAt(e.currentTarget.value);
                    setError(null);
                  }}
                  className={inputClass}
                />
              </Field>

              {/* Note */}
              <Field
                label={`${t("reminders.dialog.noteLabel")} · ${t("reminders.dialog.noteOptional")}`}
                htmlFor="reminder-note"
              >
                <textarea
                  id="reminder-note"
                  value={note}
                  onChange={(e) => setNote(e.currentTarget.value)}
                  placeholder={t("reminders.dialog.notePlaceholder")}
                  maxLength={2000}
                  rows={3}
                  className={cn(
                    "w-full rounded-md border border-border bg-inset px-3 py-2",
                    "font-serif text-[13px] leading-relaxed text-text placeholder:text-text-disabled",
                    "focus:outline-none focus:border-border-strong",
                  )}
                />
              </Field>

              {/* Linked activity — read-only when linked, "standalone" hint otherwise */}
              <Field
                label={t("reminders.dialog.linkedLabel")}
                htmlFor="reminder-linked"
              >
                <p
                  id="reminder-linked"
                  className={cn(
                    "flex items-center gap-2 rounded-md border border-border bg-inset px-3 py-2",
                    "font-mono text-[12px]",
                    isLinked ? "text-text" : "text-text-tertiary italic",
                  )}
                >
                  {isLinked
                    ? activityName
                    : t("reminders.dialog.linkedNone")}
                </p>
              </Field>

              {error && (
                <p className="font-mono text-[11px] text-down" role="alert">
                  {error}
                </p>
              )}
            </DialogBody>

            <DialogFooter>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={cn(
                  "font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary",
                  "transition-colors hover:text-text",
                )}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border border-border bg-surface",
                  "px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text",
                  "transition-colors hover:border-border-strong hover:bg-subtle",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                {submitting ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <BellPlus className="h-3 w-3" aria-hidden />
                )}
                {submitting
                  ? t("reminders.dialog.creating")
                  : t("reminders.dialog.create")}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Internal — labeled field wrapper, matches the wizard field style.
// ---------------------------------------------------------------------------

const inputClass = cn(
  "w-full rounded-md border border-border bg-inset px-3 py-2",
  "font-mono text-[12px] text-text placeholder:text-text-disabled",
  "focus:outline-none focus:border-border-strong",
);

function Field({
  label,
  htmlFor,
  helper,
  children,
}: {
  label: string;
  htmlFor: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
      >
        {label}
      </label>
      {children}
      {helper && (
        <p className="font-mono text-[10px] text-text-tertiary">{helper}</p>
      )}
    </div>
  );
}

/**
 * Default remind-at value for a fresh dialog — one hour from now, formatted
 * as a `datetime-local` string (`YYYY-MM-DDTHH:mm`) in the browser's TZ.
 */
function defaultRemindAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
