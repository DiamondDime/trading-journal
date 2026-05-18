import { requireUser } from "@/lib/auth/server";
import { listSidebarCounts, type SidebarCounts } from "@/lib/db/sidebar-counts";
import { SidebarClient } from "./sidebar-client";

/**
 * Server-side entry for the sidebar. Resolves the current user and fetches
 * every count the saved-views block displays (replacing the hardcoded
 * 27/16/5/3/3 numbers the pre-v5 sidebar shipped with). The pure-presentation
 * pathname-aware bits live in <SidebarClient> below.
 *
 * Why a wrapper instead of a server-only sidebar: `usePathname()` is needed
 * for active-link highlighting, and the locale-switcher / theme-toggle need
 * `useTheme` — both are client-only. We keep the rest of the sidebar
 * server-rendered for SEO + data freshness.
 *
 * The fetch never throws — if counts can't be loaded (e.g. user not yet
 * authed), we render with zero-counts so the sidebar still appears and
 * doesn't take down the page.
 */
export async function Sidebar() {
  let counts: SidebarCounts;
  try {
    const { id: userId } = await requireUser();
    counts = await listSidebarCounts(userId);
  } catch {
    counts = {
      all: 0,
      byType: {
        spread:         0,
        trade:          0,
        sale:           0,
        airdrop:        0,
        yield_position: 0,
        option:         0,
      },
      bySpreadType: {
        cash_carry:     0,
        funding:        0,
        cross_exchange: 0,
        calendar:       0,
        dex_cex:        0,
      },
      byOutcome: { winners: 0, losers: 0 },
      movements: 0,
      watchlist: 0,
      topStrategyTags: [],
    };
  }

  return <SidebarClient counts={counts} />;
}
