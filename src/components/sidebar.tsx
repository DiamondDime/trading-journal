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
  Sparkles,
  Plug,
  Plus,
  Search,
  Sun,
  Moon,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { LocaleSwitcher } from "@/components/locale-switcher";

type NavItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  disabled?: boolean;
  count?: number;
  badge?: { text: string; tone: "down" | "warn" | "brand" };
};

export function Sidebar() {
  const pathname = usePathname();
  const t = useT();

  const sections: { label: string; items: NavItem[] }[] = [
    {
      label: t("sidebar.sections.book"),
      items: [
        { icon: BookOpen, label: t("sidebar.nav.overview"), href: "/spreads" },
        { icon: Archive, label: t("sidebar.nav.archive"), href: "/spreads/archive", count: 27 },
        { icon: CalendarDays, label: t("sidebar.nav.calendar"), href: "/calendar" },
      ],
    },
    {
      label: t("sidebar.sections.analytics"),
      items: [
        { icon: TrendingUp, label: t("sidebar.nav.trackRecord"), href: "/analytics/track-record" },
        { icon: PieChart, label: t("sidebar.nav.activityMix"), href: "/analytics/activity-mix" },
        { icon: Activity, label: t("sidebar.nav.regime"), href: "/analytics/regime" },
      ],
    },
    {
      label: t("sidebar.sections.workshop"),
      items: [
        { icon: FileText, label: t("sidebar.nav.notes"), href: "/notes" },
        { icon: Bookmark, label: t("sidebar.nav.views"), href: "/views" },
        { icon: Sparkles, label: t("partners.sidebarLink"), href: "/partners" },
        { icon: Plug, label: t("sidebar.nav.exchanges"), href: "/settings/exchanges" },
      ],
    },
  ];

  const savedViews: { label: string; href: string; count: number; tone?: "up" | "down" }[] = [
    { label: t("sidebar.savedViews.all"),       href: "/spreads/archive",                                       count: 27 },
    { label: t("sidebar.savedViews.spreads"),   href: "/spreads/archive?activity=spread",                       count: 16 },
    { label: t("sidebar.savedViews.trades"),    href: "/spreads/archive?activity=trade",                        count: 5  },
    { label: t("sidebar.savedViews.sales"),     href: "/spreads/archive?activity=sale",                         count: 3  },
    { label: t("sidebar.savedViews.airdrops"),  href: "/spreads/archive?activity=airdrop",                      count: 3  },
    { label: t("sidebar.savedViews.winners"),   href: "/spreads/archive?outcome=winners",                       count: 22, tone: "up" },
    { label: t("sidebar.savedViews.losers"),    href: "/spreads/archive?outcome=losers",                        count: 5,  tone: "down" },
    { label: t("sidebar.savedViews.cashCarry"), href: "/spreads/archive?activity=spread&type=cash_carry",       count: 5 },
    { label: t("sidebar.savedViews.funding"),   href: "/spreads/archive?activity=spread&type=funding",          count: 5 },
    { label: t("sidebar.savedViews.crossEx"),   href: "/spreads/archive?activity=spread&type=cross_exchange",   count: 3 },
    { label: t("sidebar.savedViews.calendar"),  href: "/spreads/archive?activity=spread&type=calendar",         count: 2 },
    { label: t("sidebar.savedViews.dexCex"),    href: "/spreads/archive?activity=spread&type=dex_cex",          count: 1 },
  ];

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
            {t("app.name")}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-text-tertiary">
            {t("app.tagline")}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-inset px-2.5 py-1.5 transition-colors hover:border-border-strong">
          <Search className="h-3.5 w-3.5 text-text-tertiary" />
          <input
            type="text"
            placeholder={t("sidebar.search")}
            aria-label={t("sidebar.searchAria")}
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
                  </span>
                </>
              );

              if (item.disabled) {
                return (
                  <span
                    key={item.label}
                    aria-disabled="true"
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
            {t("sidebar.sections.savedViews")}
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
            {t("sidebar.sections.quick")}
          </p>
          <Link
            href="/add"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-text hover:bg-subtle hover:text-text transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("sidebar.quick.log")}
          </Link>
          <Link
            href="/settings/exchanges"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-subtle hover:text-text transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("sidebar.quick.connect")}
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
  const t = useT();
  React.useEffect(() => setMounted(true), []);

  return (
    <div className="border-t border-border p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-mono text-[11px] font-semibold text-white">
            {t("sidebar.user.initials")}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[12px] text-text font-medium">
              {t("sidebar.user.displayName")}
            </span>
            <span className="font-mono text-[10px] text-text-tertiary">
              {t("sidebar.role")}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label={t("common.toggleTheme")}
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
            aria-label={t("common.settings")}
            className="h-7 w-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-subtle hover:text-text transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <LocaleSwitcher />
    </div>
  );
}
