"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface DeleteButtonProps {
  activityId: string;
  activityType: "spread" | "trade" | "sale" | "airdrop";
  /** Optional short serial to show in the confirmation dialog. */
  serial?: string;
}

/**
 * Delete affordance for an activity detail page.
 *
 * Renders an editorial "Delete" trigger that opens a confirmation Dialog.
 * Confirming POSTs DELETE /api/activities/[id] (soft-delete; sets
 * deleted_at) and on success replaces the route with /spreads/archive so
 * the user lands on a page that's guaranteed to not 404 (the activity
 * they just deleted would 404 on its detail page).
 *
 * Error handling: any non-2xx response surfaces an inline error in the
 * dialog body. The dialog stays open so the user can retry.
 */
export function DeleteButton({
  activityId,
  activityType,
  serial,
}: DeleteButtonProps) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activityId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        setError(
          body?.error?.message ??
            t("activity.delete.errors.failed", { status: res.status }),
        );
        setPending(false);
        return;
      }
      // Server returns 204 No Content. Route to a known-good page so the
      // browser can't get stuck on a now-404'd detail URL.
      setOpen(false);
      router.replace("/spreads/archive");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  const typeLabel =
    activityType === "spread"
      ? t("activity.spread")
      : activityType === "trade"
        ? t("activity.trade")
        : activityType === "sale"
          ? t("activity.sale")
          : t("activity.airdrop");
  const idSuffix = serial ?? `#${activityId.slice(0, 4).toUpperCase()}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5",
            "font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary",
            "transition-colors hover:border-down hover:text-down focus:outline-none focus:ring-1 focus:ring-down",
          )}
        >
          <Trash2 className="h-3 w-3" />
          {t("common.delete")}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("activity.delete.title", { type: typeLabel })}
          </DialogTitle>
          <DialogDescription>
            {t("activity.delete.desc", { idSuffix })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {error && (
            <p
              className="rounded-md border border-down/30 bg-down/5 px-3 py-2 font-mono text-[11px] text-down"
              role="alert"
            >
              {error}
            </p>
          )}
          {!error && (
            <p className="font-serif text-[13px] italic leading-snug text-text-secondary">
              {t("activity.delete.softDeleteHint")}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <button
              type="button"
              disabled={pending}
              className={cn(
                "inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2",
                "font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary",
                "transition-colors hover:border-border-strong hover:text-text",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {t("common.cancel")}
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className={cn(
              "inline-flex items-center justify-center rounded-md border border-down bg-down px-4 py-2",
              "font-mono text-[11px] uppercase tracking-[0.16em] text-app",
              "transition-colors hover:bg-down/90",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {pending
              ? t("activity.delete.deleting")
              : t("activity.delete.confirmCta", { type: typeLabel })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
