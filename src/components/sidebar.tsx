"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BookOpen,
  Archive,
  CalendarDays,
  TrendingUp,
  PieChart,
  Activity,
  FileText,
  Bookmark,
  Plug,
  Plus,
  Search,
  Sun,
  Moon,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  disabled?: boolean;
  count?: number;
  badge?: { text: string; tone: "down" | "warn" | "brand" };
};

const sections: { label: string; items: NavItem[] }[] = [
  {
    label: "Book",
    items: [
      { icon: BookOpen, label: "Overview", href: "/spreads" },
      { icon: Archive, label: "The archive", href: "/spreads/archive", count: 27 },
      { icon: CalendarDays, label: "Calendar view", href: "/calendar" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { icon: TrendingUp, label: "Track record", href: "/analytics/track-record" },
      { icon: PieChart, label: "Activity mix", href: "/analytics/activity-mix" },
      { icon: Activity, label: "Regime distribution", href: "/analytics/regime" },
    ],
  },
  {
    label: "Workshop",
    items: [
      { icon: FileText, label: "Notes & marginalia", href: "/notes" },
      { icon: Bookmark, label: "Saved views", href: "/views" },
      {
        icon: Plug,
        label: "Exchanges",
        href: "/settings/exchanges",
      },
    ],
  },
];

const savedViews: { label: string; href: string; count: number; tone?: "up" | "down" }[] = [
  { label: "All activity",     href: "/spreads/archive",                       count: 27 },
  { label: "Spreads",          href: "/spreads/archive?activity=spread",        count: 16 },
  { label: "Trades",           href: "/spreads/archive?activity=trade",         count: 5  },
  { label: "Sales",            href: "/spreads/archive?activity=sale",          count: 3  },
  { label: "Airdrops",         href: "/spreads/archive?activity=airdrop",       count: 3  },
  { label: "Winners",          href: "/spreads/archive?outcome=winners",        count: 22, tone: "up" },
  { label: "Losers",           href: "/spreads/archive?outcome=losers",         count: 5,  tone: "down" },
  { label: "Cash-and-carry",   href: "/spreads/archive?activity=spread&type=cash_carry",      count: 5 },
  { label: "Funding captures", href: "/spreads/archive?activity=spread&type=funding",         count: 5 },
  { label: "Cross-exchange",   href: "/spreads/archive?activity=spread&type=cross_exchange",  count: 3 },
  { label: "Calendar spreads", href: "/spreads/archive?activity=spread&type=calendar",        count: 2 },
  { label: "DEX-CEX",          href: "/spreads/archive?activity=spread&type=dex_cex",         count: 1 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-[260px] flex-shrink-0 flex-col border-r border-border bg-surface">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-signature/15">
          <span className="font-serif text-[14px] italic font-semibold text-signature">
            J
          </span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-serif text-[13px] italic font-medium text-text">
            Crypto Journal
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-text-tertiary">
            journal · v0.1
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-inset px-2.5 py-1.5 transition-colors hover:border-border-strong">
          <Search className="h-3.5 w-3.5 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search spreads, notes…"
            className="flex-1 bg-transparent text-[12px] text-text placeholder:text-text-tertiary focus:outline-none"
          />
          <kbd className="hidden sm:inline-block font-mono text-[9px] text-text-tertiary border border-border rounded px-1 py-px">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {sections.map((sec) => (
          <div key={sec.label} className="mb-5">
            <p className="px-2.5 mb-1.5 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {sec.label}
            </p>
            {sec.items.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              const inner = (
                <>
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {item.badge && (
                      <span
                        className={cn(
                          "rounded-sm px-1 py-px font-mono text-[9px] uppercase tracking-wide",
                          item.badge.tone === "down" && "bg-down/15 text-down",
                          item.badge.tone === "warn" && "bg-warn/15 text-warn",
                          item.badge.tone === "brand" && "bg-brand/15 text-brand"
                        )}
                      >
                        {item.badge.text}
                      </span>
                    )}
                    {item.count !== undefined && (
                      <span className="font-mono text-[10px] text-text-tertiary">
                        {item.count}
                      </span>
                    )}
                    {item.disabled && (
                      <span
                        title="Coming soon"
                        className="font-mono text-[8px] uppercase tracking-wide text-text-tertiary/60"
                      >
                        soon
                      </span>
                    )}
                  </span>
                </>
              );

              if (item.disabled) {
                return (
                  <span
                    key={item.label}
                    aria-disabled="true"
                    title="Coming soon"
                    className={cn(
                      "flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px]",
                      "text-text-tertiary/70 cursor-not-allowed select-none"
                    )}
                  >
                    {inner}
                  </span>
                );
              }

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                    isActive
                      ? "bg-subtle text-text font-medium"
                      : "text-text-secondary hover:bg-subtle hover:text-text"
                  )}
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        ))}

        {/* Saved views */}
        <div className="mb-5">
          <p className="px-2.5 mb-1.5 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Saved views
          </p>
          {savedViews.map((v) => (
            <Link
              key={v.label}
              href={v.href}
              className="flex items-center justify-between rounded-md px-2.5 py-1 text-[12px] text-text-secondary hover:bg-subtle hover:text-text transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="text-text-tertiary">·</span>
                {v.label}
              </span>
              <span
                className={cn(
                  "font-mono text-[10px]",
                  v.tone === "down"
                    ? "text-down"
                    : v.tone === "up"
                    ? "text-up"
                    : "text-text-tertiary"
                )}
              >
                {v.count}
              </span>
            </Link>
          ))}
        </div>

        {/* Quick actions */}
        <div className="mb-5">
          <p className="px-2.5 mb-1.5 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Quick
          </p>
          <Link
            href="/add"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-text hover:bg-subtle hover:text-text transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Log activity
          </Link>
          <Link
            href="/settings/exchanges"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-subtle hover:text-text transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Connect exchange
          </Link>
        </div>
      </nav>

      {/* Account footer */}
      <SidebarFooter />
    </aside>
  );
}

function SidebarFooter() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-mono text-[11px] font-semibold text-white">
            AS
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[12px] text-text font-medium">Andrew S.</span>
            <span className="font-mono text-[10px] text-text-tertiary">
              admin
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="h-7 w-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-subtle hover:text-text transition-colors"
          >
            {mounted && theme === "dark" ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </button>
          <Link
            href="/settings"
            aria-label="Settings"
            className="h-7 w-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-subtle hover:text-text transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
