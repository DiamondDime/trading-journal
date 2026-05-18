"use client";

/**
 * RefreshButton — manual sync trigger for the /balances dashboard.
 *
 * Why a client island and not a plain `<form>` POST: the underlying route
 * (`/api/balances/refresh`) returns JSON (the worker's per-connection
 * counters). A form POST navigates to that JSON response, which dumps the
 * user out of the dashboard onto a raw `{"ok":true,...}` page. Instead we
 * fetch on the client and call `router.refresh()` so the server components
 * re-render with the new snapshot.
 *
 * UX states:
 *   idle    → "Refresh"
 *   loading → spinner + "Refreshing"
 *   ok      → "11/13 refreshed" for 2s, then back to idle
 *   error   → soft red dot + last error message, click again to retry
 *
 * Worker round-trips average 3–8s for 2–3 connections; we cap the visible
 * "refreshing" state at 30s (matches the route handler's REQUEST_TIMEOUT_MS).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface RefreshResult {
  ok: boolean;
  connections: number;
  upserted: number;
  reaped: number;
  snapshots: number;
  errors: number;
  message?: string | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; result: RefreshResult }
  | { kind: "error"; message: string };

export function RefreshButton() {
  const router = useRouter();
  const t = useT();
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });

  // Clear the success message after 2s so the button doesn't permanently
  // claim "11/13 refreshed" — slightly distracting if the user is reading.
  React.useEffect(() => {
    if (phase.kind !== "ok") return;
    const t = window.setTimeout(() => setPhase({ kind: "idle" }), 2000);
    return () => window.clearTimeout(t);
  }, [phase]);

  const onClick = React.useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const resp = await fetch("/api/balances/refresh", {
        method: "POST",
        // No body — the route reads userId from the auth header.
        cache: "no-store",
      });
      const json: { data?: RefreshResult; error?: { message?: string } } =
        await resp.json();
      if (!resp.ok || !json.data) {
        setPhase({
          kind: "error",
          message: json.error?.message ?? `HTTP ${resp.status}`,
        });
        return;
      }
      setPhase({ kind: "ok", result: json.data });
      router.refresh();
    } catch (e) {
      const err = e as Error;
      setPhase({ kind: "error", message: err.message || t("balances.refresh.networkError") });
    }
  }, [router, t]);

  const isLoading = phase.kind === "loading";
  const label = renderLabel(phase, t);
  const tone = renderTone(phase);

  return (
    <div className="flex items-center gap-2">
      {phase.kind === "error" && (
        <span
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-down"
          title={phase.message}
        >
          • {truncate(phase.message, 32)}
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={isLoading}
        aria-busy={isLoading}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border bg-app px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
          tone,
          isLoading ? "cursor-wait" : "hover:border-border-strong",
        )}
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {label}
      </button>
    </div>
  );
}

function renderLabel(phase: Phase, t: ReturnType<typeof useT>): string {
  switch (phase.kind) {
    case "idle":    return t("balances.refresh.idle");
    case "loading": return t("balances.refresh.loading");
    case "ok": {
      const { connections, errors } = phase.result;
      const successful = Math.max(0, connections - errors);
      return t("balances.refresh.ok", { successful, total: connections });
    }
    case "error":   return t("balances.refresh.retry");
  }
}

function renderTone(phase: Phase): string {
  switch (phase.kind) {
    case "ok":    return "border-up text-up";
    case "error": return "border-down/40 text-text";
    default:      return "border-border text-text";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
