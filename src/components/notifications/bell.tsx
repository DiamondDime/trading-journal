"use client";

import * as React from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationsDropdown } from "./dropdown";
import { useT } from "@/lib/i18n/client";
import type { NotificationRow } from "@/lib/db/notifications";

/**
 * Bell icon with unread count badge. Polls /api/notifications/count every 60s
 * while the tab is visible (skips when hidden to avoid waking the scanner).
 *
 * On first render it fetches /api/notifications to hydrate the dropdown list
 * so there is no second round-trip when the user opens it.
 */
// Polling cadence — base interval + max backoff when API errors stack up.
// 60s normal cadence; on repeated failure we back off exponentially up to
// 5min so a broken /api/notifications/count route doesn't keep hammering.
const POLL_BASE_MS = 60_000;
const POLL_MAX_MS = 300_000;

export function NotificationsBell() {
  const t = useT();
  const [count, setCount] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<NotificationRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Exponential-backoff state — bumped on error, reset on success.
  const failCountRef = React.useRef(0);

  // Fetch full list + seed count
  const fetchRows = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const json = (await res.json()) as { data: NotificationRow[] };
      setRows(json.data);
      setCount(json.data.filter((r) => r.readAt == null).length);
    } catch {
      // Silently swallow network errors — bell is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  // Lightweight count poll — only runs when tab is visible. Returns true on
  // success so the scheduler can reset its backoff counter.
  const pollCount = React.useCallback(async (): Promise<boolean> => {
    if (document.hidden) return true;
    try {
      const res = await fetch("/api/notifications/count");
      if (!res.ok) return false;
      const json = (await res.json()) as { data: { count: number } };
      setCount(json.data.count);
      return true;
    } catch {
      return false;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    // Initial hydration
    fetchRows();

    function schedule() {
      if (cancelled) return;
      // 60s on success, 2x backoff per consecutive failure, capped at 5min.
      const delay = Math.min(
        POLL_BASE_MS * Math.pow(2, failCountRef.current),
        POLL_MAX_MS,
      );
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        if (document.hidden) {
          // Skip work on hidden tabs but keep the loop alive.
          schedule();
          return;
        }
        const ok = await pollCount();
        failCountRef.current = ok ? 0 : failCountRef.current + 1;
        schedule();
      }, delay);
    }
    schedule();

    // Re-poll immediately when tab becomes visible (also resets backoff so we
    // see fresh data after returning from a long absence).
    const onVisibility = () => {
      if (!document.hidden) {
        failCountRef.current = 0;
        pollCount();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchRows, pollCount]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleMarkAllRead() {
    fetch("/api/notifications/read-all", { method: "POST" })
      .then(() => {
        setRows((prev) => prev.map((r) => ({ ...r, readAt: new Date().toISOString() })));
        setCount(0);
      })
      .catch(() => {});
  }

  function handleMarkOneRead(id: string) {
    fetch(`/api/notifications/${id}/read`, { method: "POST" })
      .then(() => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, readAt: new Date().toISOString() } : r,
          ),
        );
        setCount((c) => Math.max(0, c - 1));
      })
      .catch(() => {});
  }

  function handleDismiss(id: string) {
    const wasUnread = rows.find((r) => r.id === id)?.readAt == null;
    fetch(`/api/notifications/${id}/dismiss`, { method: "POST" })
      .then(() => {
        setRows((prev) => prev.filter((r) => r.id !== id));
        if (wasUnread) setCount((c) => Math.max(0, c - 1));
      })
      .catch(() => {});
  }

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        type="button"
        aria-label={t("notifications.bellAria")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded-md",
          "text-text-secondary transition-colors hover:bg-subtle hover:text-text",
          open && "bg-subtle text-text",
        )}
      >
        <Bell className="h-3.5 w-3.5" />
        {count > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center",
              "rounded-full bg-warn px-0.5 font-mono text-[9px] font-semibold text-white leading-none",
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <NotificationsDropdown
          rows={rows}
          loading={loading}
          onMarkAllRead={handleMarkAllRead}
          onMarkRead={handleMarkOneRead}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  );
}
