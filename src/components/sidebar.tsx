import { requireUser } from "@/lib/auth/server";
import { listSidebarCounts, type SidebarCounts } from "@/lib/db/sidebar-counts";
import { getBalancesResponse } from "@/lib/db/balances";
import { SidebarClient, type SidebarPortfolioSummary } from "./sidebar-client";

/**
 * Server-side entry for the sidebar. Resolves the current user and fetches
 * (a) every count the saved-views block displays and (b) the live portfolio
 * snapshot used by <PortfolioSidebarWidget> in the brand area.
 *
 * Why a wrapper instead of a server-only sidebar: `usePathname()` is needed
 * for active-link highlighting, and the locale-switcher / theme-toggle need
 * `useTheme` — both are client-only. We keep the rest of the sidebar
 * server-rendered for SEO + data freshness.
 *
 * Both fetches are wrapped in try/catch so a single failure (e.g. user not
 * yet authed, no balances yet) never takes down the whole sidebar.
 */
export async function Sidebar() {
  let counts: SidebarCounts;
  let portfolio: SidebarPortfolioSummary | null = null;
  try {
    const { id: userId } = await requireUser();
    const [countsResult, balancesResult] = await Promise.allSettled([
      listSidebarCounts(userId),
      getBalancesResponse(userId),
    ]);
    counts = countsResult.status === "fulfilled" ? countsResult.value : zeroCounts();
    if (balancesResult.status === "fulfilled" && balancesResult.value.snapshotAt != null) {
      portfolio = {
        totalUsd: balancesResult.value.totalUsd,
        delta24hUsd: balancesResult.value.delta24hUsd,
        updatedLabel: formatRelative(balancesResult.value.snapshotAt),
      };
    }
  } catch {
    counts = zeroCounts();
  }

  return <SidebarClient counts={counts} portfolio={portfolio} />;
}

function zeroCounts(): SidebarCounts {
  return {
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

// "moments ago" / "5m ago" / "2h ago" / "3d ago" — coarse-grained, server-rendered
// so the widget stays a pure pass-through. Acceptable that the label is stale
// between navigations; users see the snapshotAt timestamp via /balances anyway.
function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 90)                  return "moments ago";
  const min = Math.floor(diffSec / 60);
  if (min < 60)                      return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)                       return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30)                      return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12)                       return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}
