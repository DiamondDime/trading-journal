import { Sidebar } from "@/components/sidebar";
import { AnalyticsSubnav } from "@/components/analytics/analytics-subnav";

/**
 * Shared layout for the /analytics/* suite.
 *
 *   • Sidebar (same as /spreads/*) for global nav.
 *   • Sub-nav strip directly above the page content with three tabs.
 *
 * Why a single shared layout: the three pages render very different content
 * but share the same chrome — bumping the sub-nav into a layout lets each
 * page focus on its own grid. The sub-nav uses `usePathname()` so it
 * auto-highlights the active tab without each page passing props.
 */
export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AnalyticsSubnav />
        <main id="main-content" className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
