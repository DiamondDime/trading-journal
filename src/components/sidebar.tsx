import { getCurrentProfile, requireUser } from "@/lib/auth/server";
import { listSidebarCounts, type SidebarCounts } from "@/lib/db/sidebar-counts";
import { getBalancesResponse } from "@/lib/db/balances";
import { SidebarClient, type SidebarPortfolioSummary } from "./sidebar-client";

/**
 * Server-side entry for the sidebar. Resolves the current user and fetches
 * (a) every count the saved-views block displays, (b) the live portfolio
 * snapshot used by <PortfolioSidebarWidget> in the brand area, and (c) the
 * profile row that drives the avatar / displayName in the footer.
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
  let displayName: string = "—";
  let initials: string = "—";
  try {
    const { id: userId } = await requireUser();
    const [countsResult, balancesResult, profileResult] = await Promise.allSettled([
      listSidebarCounts(userId),
      getBalancesResponse(userId),
      getCurrentProfile(),
    ]);
    counts = countsResult.status === "fulfilled" ? countsResult.value : zeroCounts();
    if (balancesResult.status === "fulfilled" && balancesResult.value.snapshotAt != null) {
      portfolio = {
        totalUsd: balancesResult.value.totalUsd,
        delta24hUsd: balancesResult.value.delta24hUsd,
        updatedLabel: formatRelative(balancesResult.value.snapshotAt),
      };
    }
    if (profileResult.status === "fulfilled" && profileResult.value != null) {
      const profile = profileResult.value;
      // postgres.camel transform: `display_name` → `displayName` at runtime,
      // even though Profile is typed with the snake_case shape.
      const camel = profile as unknown as {
        displayName: string | null;
        email: string;
      };
      const resolvedName = camel.displayName?.trim() || null;
      displayName = resolvedName ?? "—";
      initials = computeInitials(resolvedName, camel.email);
    }
  } catch {
    counts = zeroCounts();
  }

  return (
    <SidebarClient
      counts={counts}
      portfolio={portfolio}
      displayName={displayName}
      initials={initials}
    />
  );
}

/**
 * Initials for the sidebar avatar.
 *   - Two words → first letter of each, uppercased ("Andrew S." → "AS").
 *   - One word  → just the first letter ("Andrew" → "A").
 *   - No display name → first letter of email ("alice@x.com" → "A").
 *   - No data at all → em dash so the avatar still renders something.
 */
function computeInitials(displayName: string | null, email: string | null | undefined): string {
  const name = displayName?.trim();
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const first = words[0]!.charAt(0);
      const last = words[words.length - 1]!.charAt(0);
      return (first + last).toUpperCase();
    }
    if (words.length === 1 && words[0]!.length > 0) {
      return words[0]!.charAt(0).toUpperCase();
    }
  }
  const fallback = email?.trim().charAt(0);
  if (fallback) return fallback.toUpperCase();
  return "—";
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
