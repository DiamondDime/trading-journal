"use client";

import { BellPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { SetReminderDialog } from "@/components/reminders/set-reminder-dialog";

interface SetReminderButtonProps {
  /** Activity the reminder is linked to. */
  activityId: string;
  /** Activity name — shown read-only inside the dialog. */
  activityName: string;
}

/**
 * "Set reminder" affordance for activity-detail pages. Bundles the editorial
 * trigger button + the {@link SetReminderDialog} in linked mode so each detail
 * page only needs a single one-line `<SetReminderButton …/>` next to its
 * `<DeleteButton/>` — no dialog markup duplicated per page.
 *
 * Styled to match the `DeleteButton` / edit-link affordances in the detail
 * pages' Actions row.
 */
export function SetReminderButton({
  activityId,
  activityName,
}: SetReminderButtonProps) {
  const t = useT();
  return (
    <SetReminderDialog activityId={activityId} activityName={activityName}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface",
          "px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary",
          "transition-colors hover:border-border-strong hover:text-text",
        )}
      >
        <BellPlus className="h-3 w-3" aria-hidden />
        {t("reminders.setReminder")}
      </button>
    </SetReminderDialog>
  );
}
