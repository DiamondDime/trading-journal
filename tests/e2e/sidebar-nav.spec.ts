/**
 * Sidebar primary navigation.
 *
 * Every top-level link in the sidebar (BOOK + ANALYTICS + WORKSHOP groups)
 * should click through to the documented href and land the user on that
 * page. A broken href here would be caught by the smoke suite eventually,
 * but this spec asserts it from the user-perspective angle: "I clicked on
 * 'The archive', I'm on the archive".
 *
 * The "Trades", "The archive", "Watchlist", and "Movements" links each
 * concatenate a count badge into their accessible name (e.g. "Trades0"
 * when there are 0 open positions). We anchor the regex with `^Label`
 * (no `$`) so the badge digits don't break the match — exactly the
 * gotcha the orchestrator's brief called out.
 *
 * Read-only.
 */
import { test, expect } from "@playwright/test";
import { hideDevOverlay, setLocaleCookie, trackPageErrors } from "./_helpers";

interface NavLink {
  /** Visible label as a regex (prefix-match — accounts for trailing badge). */
  label: RegExp;
  /** Expected destination href. */
  href: string;
  /** Expected URL pattern after click. */
  urlPattern: RegExp;
}

const NAV_LINKS: readonly NavLink[] = [
  // ── BOOK ─────────────────────────────────────────────────────────────────
  { label: /^Overview$/, href: "/spreads", urlPattern: /\/spreads$/ },
  { label: /^Trades/, href: "/trades", urlPattern: /\/trades(\?|$)/ },
  { label: /^The archive/, href: "/spreads/archive", urlPattern: /\/spreads\/archive/ },
  { label: /^Calendar view$/, href: "/calendar", urlPattern: /\/calendar/ },
  { label: /^Watchlist/, href: "/watchlist", urlPattern: /\/watchlist/ },
  { label: /^Movements/, href: "/movement-events", urlPattern: /\/movement-events/ },
  { label: /^Balances$/, href: "/balances", urlPattern: /\/balances/ },

  // ── ANALYTICS ────────────────────────────────────────────────────────────
  { label: /^Track record$/, href: "/analytics/track-record", urlPattern: /\/analytics\/track-record/ },
  { label: /^Activity mix$/, href: "/analytics/activity-mix", urlPattern: /\/analytics\/activity-mix/ },
  { label: /^Regime distribution$/, href: "/analytics/regime", urlPattern: /\/analytics\/regime/ },

  // ── WORKSHOP ─────────────────────────────────────────────────────────────
  { label: /^Notes & marginalia$/, href: "/notes", urlPattern: /\/notes/ },
  { label: /^Saved views$/, href: "/views", urlPattern: /\/views/ },
  { label: /^Partners$/, href: "/partners", urlPattern: /\/partners/ },
  { label: /^Exchanges$/, href: "/settings/exchanges", urlPattern: /\/settings\/exchanges/ },
];

test.beforeEach(async ({ context }) => {
  await setLocaleCookie(context, "en");
  await hideDevOverlay(context);
});

test.describe.serial("sidebar primary nav: every link routes correctly", () => {
  for (const link of NAV_LINKS) {
    test(`clicking ${link.label.source} navigates to ${link.href}`, async ({
      page,
    }) => {
      const tracker = trackPageErrors(page);

      // Always start from /spreads so the sidebar is in a known shape and
      // the active-link highlight isn't already on the target link
      // (clicking an already-active link is a no-op in some browsers).
      await page.goto("/spreads");

      // Several hrefs appear twice in the sidebar: once in the top BOOK /
      // ANALYTICS / WORKSHOP section and once in the "saved views" block
      // further down (e.g. /movement-events is duplicated). The BOOK link
      // always comes first in DOM order, so `.first()` reliably targets it.
      // This is good enough for nav verification; the saved-views block has
      // its own coverage via the smoke suite touching every route.
      const sidebarLink = page.locator(`aside a[href="${link.href}"]`).first();
      await expect(
        sidebarLink,
        `${link.href} link not found in sidebar`,
      ).toBeVisible();

      // Sanity check: visible text starts with the documented label. This
      // catches an i18n key being silently swapped out from under us.
      const visibleText = (await sidebarLink.innerText()).trim();
      expect(
        link.label.test(visibleText),
        `expected sidebar label to match ${link.label} but got "${visibleText}"`,
      ).toBe(true);

      await sidebarLink.click();
      await expect(page).toHaveURL(link.urlPattern);

      // The destination must mount without errors.
      expect(
        tracker.isClean(),
        `${link.href} produced page errors:\n${tracker.snapshot()}`,
      ).toBe(true);
    });
  }
});
