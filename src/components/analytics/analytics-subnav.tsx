"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

/**
 * Tab strip rendered above every /analytics/* page. Three tabs:
 *   - Track record
 *   - Activity mix
 *   - Regime distribution
 *
 * Visual style follows the rest of the journal: serif labels, mono caption,
 * a single 1px bottom border under the active tab. No fills, no rounded
 * pills — fits the editorial register.
 */

export function AnalyticsSubnav() {
  const pathname = usePathname();
  const t = useT();
  const TABS = [
    { href: "/analytics/track-record", label: t("analytics.nav.trackRecord"), caption: t("analytics.navCaptions.trackRecord") },
    { href: "/analytics/activity-mix", label: t("analytics.nav.activityMix"), caption: t("analytics.navCaptions.activityMix") },
    { href: "/analytics/regime", label: t("analytics.nav.regime"), caption: t("analytics.navCaptions.regime") },
  ];
  return (
    <nav className="border-b border-border bg-surface">
      <div className="flex items-end gap-1 overflow-x-auto px-8 lg:px-12">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex flex-col gap-0.5 border-b-2 px-4 py-3 transition-colors",
                isActive
                  ? "border-text text-text"
                  : "border-transparent text-text-tertiary hover:border-border-strong hover:text-text",
              )}
            >
              <span className="font-serif text-[13px] font-medium leading-none">
                {tab.label}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
                {tab.caption}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
