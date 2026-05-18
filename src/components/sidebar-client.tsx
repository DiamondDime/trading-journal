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
  Eye,
  Layers,
  Coins,
  Sigma,
  ArrowRightLeft,
  Wallet,
  LineChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { PortfolioSidebarWidget } from "@/components/balances/portfolio-sidebar-widget";
import { NotificationsBell } from "@/components/notifications/bell";
import type { SidebarCounts } from "@/lib/db/sidebar-counts";

/**
 * Pre-formatted portfolio summary passed in from the server `<Sidebar>`.
 * Null when the user has no balance snapshot yet — widget is hidden in that
 * case rather than showing "$0".
 */
export interface SidebarPortfolioSummary {
  totalUsd: string;
  delta24hUsd: string | null;
  updatedLabel: string;
}

type NavItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  disabled?: boolean;
  count?: number;
  badge?: { text: string; tone: "down" | "warn" | "brand" };
};

/**
 * Decide whether a nav `href` should look "active" given the current
 * pathname. Exact match for `/`-only pages, prefix match (with `/` boundary)
 * for everything else so e.g. `/spreads/123` still highlights `/spreads`.
 * `/spreads` and `/spreads/archive` are siblings, so we special-case the
 * archive to only match itself.
 */
function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/") return false;
  // `/spreads` should match `/spreads/123` but NOT `/spreads/archive`
  // (archive is a sibling, not a child). Both `/spreads` and the archive
  // sit in the nav and need to be mutually exclusive when on archive.
  if (href === "/spreads") return pathname.startsWith("/spreads/") && !pathname.startsWith("/spreads/archive");
  return pathname.startsWith(`${href}/`);
}

export interface SidebarClientProps {
  /** Real counts pulled from the DB by the server entry. */
  counts: SidebarCounts;
  /** Portfolio snapshot for the brand-area widget; null = no balances yet. */
  portfolio: SidebarPortfolioSummary | null;
  /**
   * Footer avatar copy. Pre-computed on the server from the profiles row so
   * the sidebar never needs to know about i18n placeholders — both fall back
   * to "—" when the profile is missing.
   */
  displayName: string;
  initials: string;
}

export function SidebarClient({ counts, portfolio, displayName, initials }: SidebarClientProps) {
  const pathname = usePathname();
  const t = useT();

  const sections: { label: string; items: NavItem[] }[] = [
    {
      label: t("sidebar.sections.book"),
      items: [
        { icon: BookOpen, label: t("sidebar.nav.overview"), href: "/spreads" },
        { icon: LineChart, label: t("sidebar.nav.trades"), href: "/trades" },
        { icon: Archive, label: t("sidebar.nav.archive"), href: "/spreads/archive", count: counts.all },
        { icon: CalendarDays, label: t("sidebar.nav.calendar"), href: "/calendar" },
        {
          icon: Eye,
          label: t("sidebar.nav.watchlist"),
          href: "/watchlist",
          count: counts.watchlist,
          ...(counts.watchlist > 0
            ? { badge: { text: t("sidebar.badges.live"), tone: "warn" as const } }
            : {}),
        },
        {
          icon: ArrowRightLeft,
          label: t("sidebar.nav.movements"),
          href: "/movement-events",
          count: counts.movements,
        },
        {
          icon: Wallet,
          label: t("navExt.balances"),
          href: "/balances",
        },
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

  // "By activity" group — every activity type (incl. v5 yield + option) +
  // event_log movements. Items with zero counts still render so the user
  // sees the full menu and can tell at a glance "I have not logged any
  // options yet" rather than wondering if the feature is missing.
  const byActivity: { icon: React.ComponentType<{ className?: string }>; label: string; href: string; count: number }[] = [
    { icon: Sigma,          label: t("sidebar.savedViews.spreads"),        href: "/spreads/archive?activity=spread",         count: counts.byType.spread },
    { icon: Activity,       label: t("sidebar.savedViews.trades"),         href: "/spreads/archive?activity=trade",          count: counts.byType.trade },
    { icon: Coins,          label: t("sidebar.savedViews.yieldPositions"), href: "/spreads/archive?activity=yield_position", count: counts.byType.yield_position },
    { icon: Layers,         label: t("sidebar.savedViews.options"),        href: "/spreads/archive?activity=option",         count: counts.byType.option },
    { icon: Coins,          label: t("sidebar.savedViews.sales"),          href: "/spreads/archive?activity=sale",           count: counts.byType.sale },
    { icon: Sparkles,       label: t("sidebar.savedViews.airdrops"),       href: "/spreads/archive?activity=airdrop",        count: counts.byType.airdrop },
    { icon: ArrowRightLeft, label: t("sidebar.savedViews.movements"),      href: "/movement-events",                         count: counts.movements },
  ];

  // "By spread type" group — only spreads. Zero-count rows are hidden to
  // keep the section compact.
  const bySpreadType: { label: string; href: string; count: number }[] = [
    { label: t("sidebar.savedViews.cashCarry"), href: "/spreads/archive?activity=spread&type=cash_carry",     count: counts.bySpreadType.cash_carry },
    { label: t("sidebar.savedViews.funding"),   href: "/spreads/archive?activity=spread&type=funding",        count: counts.bySpreadType.funding },
    { label: t("sidebar.savedViews.crossEx"),   href: "/spreads/archive?activity=spread&type=cross_exchange", count: counts.bySpreadType.cross_exchange },
    { label: t("sidebar.savedViews.calendar"),  href: "/spreads/archive?activity=spread&type=calendar",       count: counts.bySpreadType.calendar },
    { label: t("sidebar.savedViews.dexCex"),    href: "/spreads/archive?activity=spread&type=dex_cex",        count: counts.bySpreadType.dex_cex },
  ];

  // "By outcome" — closed activities only. The view supports a synthetic
  // `?outcome=` querystring that the archive page filters on.
  const byOutcome: { label: string; href: string; count: number; tone: "up" | "down" }[] = [
    { label: t("sidebar.savedViews.winners"), href: "/spreads/archive?outcome=winners", count: counts.byOutcome.winners, tone: "up" },
    { label: t("sidebar.savedViews.losers"),  href: "/spreads/archive?outcome=losers",  count: counts.byOutcome.losers,  tone: "down" },
  ];

  // Top strategy tags — capped at 5 in the DB layer.
  const byStrategy = counts.topStrategyTags.map((s) => ({
    label: s.tag,
    href:  `/spreads/archive?strategy=${encodeURIComponent(s.tag)}`,
    count: s.count,
  }));

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

      {/* Portfolio widget — appears once the user has at least one balance
          snapshot. Hidden when null so we don't show "$0" before the worker
          has populated `exchange_balances` for the first time. */}
      {portfolio && (
        <div className="px-3 pt-3">
          <PortfolioSidebarWidget
            totalUsd={portfolio.totalUsd}
            delta24hUsd={portfolio.delta24hUsd}
            updatedLabel={portfolio.updatedLabel}
          />
        </div>
      )}

      {/* Search + bell row */}
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <SearchPillButton placeholder={t("sidebar.search")} ariaLabel={t("sidebar.searchAria")} />
          <NotificationsBell />
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
              const isActive = isNavActive(pathname, item.href);
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
                  aria-current={isActive ? "page" : undefined}
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

        {/* Saved views — By activity */}
        <SavedViewsBlock title={t("sidebar.sections.byActivity")}>
          {byActivity.map((v) => {
            const Icon = v.icon;
            return (
              <SavedViewLink key={v.label} href={v.href} count={v.count}>
                <Icon className="h-3 w-3 text-text-tertiary" aria-hidden />
                <span>{v.label}</span>
              </SavedViewLink>
            );
          })}
        </SavedViewsBlock>

        {/* Saved views — By spread type */}
        {bySpreadType.some((v) => v.count > 0) && (
          <SavedViewsBlock title={t("sidebar.sections.bySpreadType")}>
            {bySpreadType
              .filter((v) => v.count > 0)
              .map((v) => (
                <SavedViewLink key={v.label} href={v.href} count={v.count}>
                  <span className="text-text-tertiary">·</span>
                  <span>{v.label}</span>
                </SavedViewLink>
              ))}
          </SavedViewsBlock>
        )}

        {/* Saved views — By outcome */}
        <SavedViewsBlock title={t("sidebar.sections.byOutcome")}>
          {byOutcome.map((v) => (
            <SavedViewLink key={v.label} href={v.href} count={v.count}>
              <span
                className={cn(
                  "text-text-tertiary",
                  v.tone === "up" && "text-up",
                  v.tone === "down" && "text-down",
                )}
              >
                ·
              </span>
              <span>{v.label}</span>
            </SavedViewLink>
          ))}
        </SavedViewsBlock>

        {/* Saved views — By strategy (only when the trader has tagged things) */}
        {byStrategy.length > 0 && (
          <SavedViewsBlock title={t("sidebar.sections.byStrategy")}>
            {byStrategy.map((v) => (
              <SavedViewLink key={v.label} href={v.href} count={v.count}>
                <span className="text-text-tertiary">·</span>
                <span className="truncate">{v.label}</span>
              </SavedViewLink>
            ))}
          </SavedViewsBlock>
        )}

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
      <SidebarFooter displayName={displayName} initials={initials} />
    </aside>
  );
}

function SavedViewsBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <p className="px-2.5 mb-1.5 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {title}
      </p>
      {children}
    </div>
  );
}

function SavedViewLink({
  href,
  count,
  children,
}: {
  href: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md px-2.5 py-1 text-[12px] text-text-secondary hover:bg-subtle hover:text-text transition-colors"
    >
      <span className="flex items-center gap-2 min-w-0">{children}</span>
      <span className="font-mono text-[10px] text-text-tertiary">{count}</span>
    </Link>
  );
}

function SidebarFooter({ displayName, initials }: { displayName: string; initials: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const t = useT();
  // Mount detection for SSR hydration — canonical next-themes pattern,
  // must run exactly once after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setMounted(true), []);

  return (
    <div className="border-t border-border p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-mono text-[11px] font-semibold text-white">
            {initials}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[12px] text-text font-medium">
              {displayName}
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

/**
 * Sidebar search pill — opens the global search palette on click. The pill
 * looks like an input so it reads as searchable, but the actual search
 * affordance lives in the ⌘K palette mounted at the root layout. Click here
 * dispatches a `search:open` custom event the keybind listener is already
 * watching for.
 *
 * The kbd hint shows the right modifier per platform (⌘ on Mac, Ctrl
 * elsewhere). Computed after mount to avoid SSR/CSR mismatch — pre-hydration
 * we show ⌘ since the asset is mac-heavy and the difference is a flash.
 */
function SearchPillButton({
  placeholder,
  ariaLabel,
}: {
  placeholder: string;
  ariaLabel: string;
}) {
  const [modKey, setModKey] = React.useState("⌘");
  React.useEffect(() => {
    const ua = navigator.userAgent;
    const isMac = /Mac|iPhone|iPad/.test(ua);
    setModKey(isMac ? "⌘" : "Ctrl");
  }, []);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => document.dispatchEvent(new CustomEvent("search:open"))}
      className="group flex flex-1 items-center gap-2 rounded-md border border-border bg-inset px-2.5 py-1.5 text-left transition-colors hover:border-border-strong focus:border-border-strong focus:outline-none"
    >
      <Search className="h-3.5 w-3.5 text-text-tertiary" />
      <span className="flex-1 bg-transparent text-[12px] text-text-tertiary">
        {placeholder}
      </span>
      <kbd className="hidden sm:inline-block rounded border border-border px-1 py-px font-mono text-[9px] text-text-tertiary">
        {modKey}K
      </kbd>
    </button>
  );
}
