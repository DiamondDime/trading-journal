"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bell,
  Clock,
  CalendarDays,
  X,
  CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/lib/i18n/client";
import type { NotificationRow, NotificationKind } from "@/lib/db/notifications";

interface NotificationsDropdownProps {
  rows: NotificationRow[];
  loading: boolean;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function NotificationsDropdown({
  rows,
  loading,
  onMarkAllRead,
  onMarkRead,
  onDismiss,
}: NotificationsDropdownProps) {
  const t = useT();
  const hasUnread = rows.some((r) => r.readAt == null);

  return (
    <div
      role="dialog"
      aria-label={t("notifications.title")}
      className={cn(
        "absolute right-0 top-full z-50 mt-2 flex w-[340px] flex-col rounded-md",
        "border border-border bg-surface shadow-lg",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-serif text-[13px] font-semibold text-text">
          {t("notifications.title")}
        </span>
        {hasUnread && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:text-text"
          >
            <CheckCheck className="h-3 w-3" />
            {t("notifications.markAllRead")}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center px-4 py-10">
            <span className="font-mono text-[11px] text-text-tertiary">
              …
            </span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-10">
            <p className="font-serif text-[13px] italic text-text-tertiary">
              {t("notifications.empty")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <NotificationItem
                key={row.id}
                row={row}
                onMarkRead={onMarkRead}
                onDismiss={onDismiss}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------

interface NotificationItemProps {
  row: NotificationRow;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}

function NotificationItem({
  row,
  onMarkRead,
  onDismiss,
}: NotificationItemProps) {
  const t = useT();
  const locale = useLocale();
  const isRead = row.readAt != null;

  function handleClick() {
    if (!isRead) onMarkRead(row.id);
  }

  const content = (
    <div
      className={cn(
        "group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle",
        !isRead && "bg-warn/5",
      )}
    >
      {/* Kind icon */}
      <KindIcon kind={row.kind} className="mt-0.5 h-3.5 w-3.5 shrink-0" />

      {/* Text */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "font-serif text-[13px] leading-snug text-text truncate",
              !isRead && "font-medium",
            )}
          >
            {row.title}
          </p>
          {/* Dismiss button */}
          <button
            type="button"
            aria-label={t("notifications.dismiss")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDismiss(row.id);
            }}
            className="ml-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-text-tertiary hover:text-text"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <div className="mt-0.5 flex items-center gap-2">
          <KindLabel kind={row.kind} />
          {row.body && (
            <span className="font-mono text-[10px] text-text-tertiary truncate">
              {row.body}
            </span>
          )}
        </div>

        <p className="mt-1 font-mono text-[9px] text-text-tertiary">
          {relativeTime(row.createdAt, locale)}
        </p>
      </div>
    </div>
  );

  if (row.href) {
    return (
      <li>
        <Link href={row.href} onClick={handleClick} className="block">
          {content}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className="block w-full text-left"
        onClick={handleClick}
      >
        {content}
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Kind icon
// ---------------------------------------------------------------------------

function KindIcon({
  kind,
  className,
}: {
  kind: NotificationKind;
  className?: string;
}) {
  switch (kind) {
    case "deadline_overdue":
      return <AlertCircle className={cn("text-down", className)} />;
    case "deadline_today":
      return <Clock className={cn("text-warn", className)} />;
    case "deadline_t_minus_1":
      return <Clock className={cn("text-warn", className)} />;
    case "deadline_t_minus_3":
      return <CalendarDays className={cn("text-text-secondary", className)} />;
    case "drift_warning":
      return <AlertCircle className={cn("text-info", className)} />;
    case "manual_reminder":
      return <Bell className={cn("text-info", className)} />;
  }
}

// ---------------------------------------------------------------------------
// Kind label pill
// ---------------------------------------------------------------------------

function KindLabel({ kind }: { kind: NotificationKind }) {
  const t = useT();
  const label = t(`notifications.kinds.${kind}` as Parameters<typeof t>[0]);

  const tone =
    kind === "deadline_overdue"
      ? "text-down bg-down/10"
      : kind === "deadline_today" || kind === "deadline_t_minus_1"
      ? "text-warn bg-warn/10"
      : "text-text-tertiary bg-subtle";

  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-1 py-px font-mono text-[9px] uppercase tracking-wide",
        tone,
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Relative time — Intl.RelativeTimeFormat so RU users see Cyrillic copy
// ---------------------------------------------------------------------------

function relativeTime(iso: string, locale: string): string {
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const sec = Math.max(0, Math.floor(ms / 1000));
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto", style: "short" });
  if (sec < 90) return rtf.format(-sec, "second");
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.floor(hr / 24);
  if (day < 30) return rtf.format(-day, "day");
  return rtf.format(-Math.floor(day / 30), "month");
}
