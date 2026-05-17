"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface BackfillButtonProps {
  activityId: string;
}

/**
 * "Backfill" inline action for the empty-state of the MFE-R section.
 *
 * Posts to /api/activities/[id]/excursion/backfill. The route returns 202
 * with an honest "manually trigger" message — Wave 10-1's worker is the
 * thing that actually fetches kline data and computes MAE/MFE.
 *
 * Successful response surfaces the message in a small flash so the trader
 * understands what just happened (the queue isn't implemented yet for v1).
 */
export function BackfillButton({ activityId }: BackfillButtonProps) {
  const t = useT();
  const [status, setStatus] = React.useState<"idle" | "pending" | "flashed" | "error">(
    "idle",
  );
  const [message, setMessage] = React.useState<string | null>(null);

  async function handleClick() {
    setStatus("pending");
    setMessage(null);
    try {
      const res = await fetch(
        `/api/activities/${activityId}/excursion/backfill`,
        { method: "POST" },
      );
      if (res.status === 202) {
        const json = (await res.json()) as {
          data: { message: string; queued: boolean };
        };
        setStatus("flashed");
        setMessage(json.data.message);
        return;
      }
      if (res.status === 404) {
        setStatus("error");
        setMessage(t("activity.backfill.errors.notFound"));
        return;
      }
      const json = await res.json().catch(() => null);
      setStatus("error");
      setMessage(
        json?.error?.message ??
          t("activity.backfill.errors.failed", { status: res.status }),
      );
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "pending"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5",
          "font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary",
          "transition-colors hover:border-border-strong hover:text-text",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {status === "pending" && (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        )}
        {t("activity.backfill.cta")}
      </button>
      {message && (
        <p
          className={cn(
            "font-mono text-[10px] leading-relaxed text-text-tertiary",
            status === "error" && "text-down",
          )}
          role={status === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      )}
    </div>
  );
}
