"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BellPlus, Check, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/lib/i18n/client";
import { SetReminderDialog } from "@/components/reminders/set-reminder-dialog";
import {
  completeReminderAction,
  deleteReminderAction,
} from "@/app/watchlist/reminder-actions";
import type { ReminderRow } from "@/lib/db/reminders-types";
import {
  daysUntilReminder,
  formatReminderCountdown,
} from "@/lib/reminders/countdown";

/** A reminder plus the resolved deep-link for its linked activity (if any). */
export interface ReminderListItem extends ReminderRow {
  /** Detail-page href for the linked activity, or null when standalone. */
  activityHref: string | null;
  /** Display name for the linked activity, or null when standalone. */
  activityName: string | null;
}

interface RemindersSectionProps {
  items: ReminderListItem[];
}

/**
 * Watchlist "Reminders" section — lists pending reminders with an inline
 * complete + delete control on each, plus a "+ New reminder" button that
 * opens the set-reminder dialog standalone.
 *
 * Styled as a peer of the watchlist's category sub-sections.
 */
export function RemindersSection({ items }: RemindersSectionProps) {
  const t = useT();

  return (
    <section
      className="rounded-md border border-border bg-surface"
      aria-labelledby="watchlist-reminders-title"
    >
      <header className="flex flex-col gap-1 border-b border-border px-6 py-4 md:flex-row md:items-baseline md:justify-between">
        <div>
          <h2
            id="watchlist-reminders-title"
            className="font-serif text-[13px] font-semibold uppercase tracking-[0.16em] text-text"
          >
            {t("reminders.sectionTitle")}
          </h2>
          <p className="mt-1 font-serif text-[12px] italic leading-snug text-text-tertiary">
            {t("reminders.sectionCaption")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
            {items.length}
          </span>
          <SetReminderDialog>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface",
                "px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary",
                "transition-colors hover:border-border-strong hover:text-text",
              )}
            >
              <BellPlus className="h-3 w-3" aria-hidden />
              {t("reminders.newReminder")}
            </button>
          </SetReminderDialog>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="font-serif text-[14px] italic text-text-tertiary">
            {t("reminders.empty")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <ReminderRowItem key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Single reminder row
// ---------------------------------------------------------------------------

function ReminderRowItem({ item }: { item: ReminderListItem }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = React.useState<"complete" | "delete" | null>(null);

  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const remindDate = new Date(item.remindAt);
  const dateValid = Number.isFinite(remindDate.getTime());

  const dateLabel = dateValid
    ? remindDate.toLocaleString(intlLocale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  const days = dateValid ? daysUntilReminder(remindDate) : null;
  const countdown = formatReminderCountdown(days, {
    today: t("reminders.countdown.today"),
    tomorrow: t("reminders.countdown.tomorrow"),
    overdue: t("reminders.countdown.overdue"),
  });
  const countdownTone =
    days == null
      ? "text-text-tertiary"
      : days < 0
        ? "text-down"
        : days <= 1
          ? "text-warn"
          : "text-text-secondary";

  async function handleComplete() {
    setBusy("complete");
    const result = await completeReminderAction(item.id);
    if (result.ok) {
      router.refresh();
    } else {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("delete");
    const result = await deleteReminderAction(item.id);
    if (result.ok) {
      router.refresh();
    } else {
      setBusy(null);
    }
  }

  return (
    <li>
      <div className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-subtle">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-serif text-[15px] font-medium leading-tight text-text">
            {item.title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-mono tabular-nums text-text-tertiary">
              {dateLabel}
            </span>
            <span
              className={cn(
                "font-mono uppercase tracking-[0.12em] tabular-nums",
                countdownTone,
              )}
            >
              · {countdown}
            </span>
            {item.activityHref && item.activityName && (
              <>
                <span className="font-mono text-text-tertiary">·</span>
                <Link
                  href={item.activityHref}
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary underline-offset-2 hover:text-text hover:underline"
                >
                  {t("reminders.linkedActivity")}: {item.activityName}
                </Link>
              </>
            )}
          </div>
          {item.note && (
            <p className="font-serif text-[12px] italic leading-snug text-text-tertiary">
              {item.note}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleComplete()}
            disabled={busy != null}
            aria-label={t("reminders.completeAria")}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface",
              "text-text-tertiary transition-colors hover:border-up/50 hover:text-up",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            {busy === "complete" ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy != null}
            aria-label={t("reminders.deleteAria")}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface",
              "text-text-tertiary transition-colors hover:border-down/50 hover:text-down",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            {busy === "delete" ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </li>
  );
}

