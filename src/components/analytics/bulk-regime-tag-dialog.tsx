"use client";

import * as React from "react";
import { Loader2, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/lib/i18n/client";
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
import type { UntaggedActivityRow } from "@/lib/db/activity";
import type { ActivityType } from "@/types/canonical";
import type { MessageKey } from "@/lib/i18n/resolve";
import {
  fetchUntaggedActivities,
  applyBulkRegimeTag,
} from "@/app/analytics/regime/actions";

const ACTIVITY_TYPE_I18N_KEY: Record<ActivityType, MessageKey> = {
  spread: "activity.spread",
  trade: "activity.trade",
  sale: "activity.sale",
  airdrop: "activity.airdrop",
  yield_position: "activity.yieldPosition",
  option: "activity.option",
};

interface Props {
  /** Total untagged count for the trigger label — avoids a client fetch just to show the number. */
  untaggedCount: number;
}

type Step = "list" | "done";

export function BulkRegimeTagDialog({ untaggedCount }: Props) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("list");
  const [activities, setActivities] = React.useState<UntaggedActivityRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [tagInput, setTagInput] = React.useState("");
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [updatedCount, setUpdatedCount] = React.useState(0);

  const inputRef = React.useRef<HTMLInputElement>(null);

  // Load the untagged list when the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStep("list");
    setSelected(new Set());
    setTagInput("");

    void fetchUntaggedActivities().then((rows) => {
      if (cancelled) return;
      setActivities(rows);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError(t("analytics.regime.bulkTagErrorLoad"));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [open]);

  // Focus the tag input once activities have loaded.
  React.useEffect(() => {
    if (!loading && activities.length > 0 && open) {
      // Small delay to let dialog animation settle.
      const tid = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(tid);
    }
  }, [loading, activities.length, open]);

  function toggleAll() {
    if (selected.size === activities.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(activities.map((a) => a.id)));
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApply() {
    if (!tagInput.trim() || selected.size === 0) return;
    setApplying(true);
    setError(null);
    const result = await applyBulkRegimeTag([...selected], tagInput.trim());
    setApplying(false);
    if (!result.ok) {
      setError(result.error ?? t("analytics.regime.bulkTagErrorApply"));
      return;
    }
    setUpdatedCount(result.updated);
    setStep("done");
  }

  const allSelected = activities.length > 0 && selected.size === activities.length;
  const canApply = selected.size > 0 && tagInput.trim().length > 0 && !applying;

  function fmtDate(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    const intl = locale === "ru" ? "ru-RU" : "en-US";
    return d.toLocaleDateString(intl, { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.16em]",
            "text-text-secondary transition-colors hover:text-text",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-text rounded",
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <Tag className="h-3 w-3" aria-hidden />
            {t("analytics.regime.bulkTagAction")}
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogEyebrow>{t("analytics.regime.bulkTagEyebrow")}</DialogEyebrow>
          <DialogTitle>{t("analytics.regime.bulkTagTitle2")}</DialogTitle>
          {step === "list" && (
            <DialogDescription>
              {t("analytics.regime.bulkTagDescription", { count: untaggedCount })}
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "done" ? (
          <DialogBody>
            <p className="font-serif text-[15px] text-text">
              {t("analytics.regime.bulkTagDone", { count: updatedCount, tag: tagInput.trim() })}
            </p>
            <p className="mt-2 font-mono text-[11px] text-text-tertiary">
              {t("analytics.regime.bulkTagDoneHint")}
            </p>
          </DialogBody>
        ) : loading ? (
          <DialogBody className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-label="Loading" />
          </DialogBody>
        ) : activities.length === 0 ? (
          <DialogBody>
            <p className="font-serif text-[14px] italic text-text-secondary">
              {t("analytics.regime.bulkTagEmpty")}
            </p>
          </DialogBody>
        ) : (
          <>
            <DialogBody className="flex flex-col gap-4">
              {/* Tag input */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="bulk-regime-tag-input"
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                >
                  {t("analytics.regime.bulkTagInputLabel")}
                </label>
                <input
                  ref={inputRef}
                  id="bulk-regime-tag-input"
                  type="text"
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleApply();
                  }}
                  placeholder={t("analytics.regime.bulkTagInputPlaceholder")}
                  maxLength={60}
                  className={cn(
                    "w-full rounded-md border border-border bg-inset px-3 py-2",
                    "font-mono text-[12px] text-text placeholder:text-text-disabled",
                    "focus:outline-none focus:border-border-strong",
                  )}
                />
                <p className="font-mono text-[10px] text-text-tertiary">
                  {t("analytics.regime.bulkTagInputHelper")}
                </p>
              </div>

              {/* Activity checklist */}
              <div className="flex flex-col gap-1">
                {/* Select-all header */}
                <label className="flex cursor-pointer items-center gap-2.5 border-b border-border pb-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 accent-text"
                    aria-label={t("analytics.regime.bulkTagSelectAll")}
                  />
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                    {t("analytics.regime.bulkTagSelectAll")}
                    {" "}
                    ({selected.size}/{activities.length})
                  </span>
                </label>

                {/* Scrollable list */}
                <ul
                  className="max-h-64 overflow-y-auto"
                  role="group"
                  aria-label={t("analytics.regime.bulkTagListLabel")}
                >
                  {activities.map((a) => (
                    <li key={a.id}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded py-1.5 px-1 hover:bg-subtle">
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggle(a.id)}
                          className="h-3.5 w-3.5 shrink-0 accent-text"
                        />
                        <span className="min-w-0 flex-1 font-serif text-[13px] text-text truncate">
                          {a.name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-text-tertiary uppercase tracking-[0.12em]">
                          {ACTIVITY_TYPE_I18N_KEY[a.type]
                            ? t(ACTIVITY_TYPE_I18N_KEY[a.type])
                            : a.type}
                        </span>
                        {a.openedAt && (
                          <span className="shrink-0 font-mono text-[10px] text-text-disabled">
                            {fmtDate(a.openedAt)}
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>

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
                onClick={() => void handleApply()}
                disabled={!canApply}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border border-border bg-surface",
                  "px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text",
                  "transition-colors hover:border-border-strong hover:bg-subtle",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                {applying && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                {t("analytics.regime.bulkTagApply", { count: selected.size })}
              </button>
            </DialogFooter>
          </>
        )}

        {step === "done" && (
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
        )}
      </DialogContent>
    </Dialog>
  );
}
