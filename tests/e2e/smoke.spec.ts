/**
 * Smoke suite.
 *
 * For every user-facing route in the app we assert:
 *   1. The navigation response is 2xx.
 *   2. No uncaught exception (`pageerror`) fires while the page mounts.
 *   3. No `console.error` is logged during mount.
 *
 * Catches the most common regression: a page that throws on mount because of
 * a missing prop, a server-action import gone bad, or an i18n key that no
 * longer resolves. None of those would show up in a typecheck — only when
 * the route is actually rendered.
 *
 * Each route is its own `test()` so a failure on one page does not mask
 * failures on the others. Serial mode keeps DB state predictable for the
 * single-user app, but each test still gets a fresh page + tracker.
 */
import { test, expect, type Page } from "@playwright/test";
import { hideDevOverlay, setLocaleCookie, trackPageErrors } from "./_helpers";

/** Every user-facing route the journal exposes. Keep alphabetised within each
 *  cluster so additions are easy to spot in PR diffs. */
const ROUTES: readonly string[] = [
  // ── Top-level dashboard + book ───────────────────────────────────────────
  "/",
  "/spreads",
  "/spreads/archive",
  "/trades",
  "/calendar",
  "/watchlist",
  "/movement-events",
  "/balances",

  // ── Analytics ────────────────────────────────────────────────────────────
  "/analytics/track-record",
  "/analytics/activity-mix",
  "/analytics/regime",
  "/analytics/strategy",

  // ── Workshop ─────────────────────────────────────────────────────────────
  "/notes",
  "/views",
  "/partners",
  "/search",

  // ── Settings ─────────────────────────────────────────────────────────────
  "/settings",
  "/settings/exchanges",
  "/settings/profile",
  "/settings/import",
  "/settings/mcp",
  "/settings/about",

  // ── Activity-type listings ───────────────────────────────────────────────
  "/sales",
  "/airdrops",
  "/options",
  "/yield-positions",

  // ── /add wizard tree ─────────────────────────────────────────────────────
  "/add",
  "/add/spread/source",
  "/add/spread/pick",
  "/add/spread/type",
  "/add/trade/source",
  "/add/trade/kind",
  "/add/sale/kind",
  "/add/airdrop",
  "/add/airdrop/wallet",
  "/add/yield/kind",
  "/add/option/kind",
  "/add/option/legs?subtype=single_leg",
  "/add/movement/kind",
];

test.describe.serial("smoke: every route renders cleanly", () => {
  test.beforeEach(async ({ context }) => {
    // Pin locale so the i18n cookie isn't whatever the dev session has set.
    // The auth cookie set up by the orchestrator is preserved.
    await setLocaleCookie(context, "en");
    // Stop the Next dev-mode error overlay from intercepting clicks. See
    // _helpers.ts — there's an open hydration-mismatch bug on the dashboard.
    await hideDevOverlay(context);
  });

  for (const route of ROUTES) {
    test(`route ${route}`, async ({ page }) => {
      const tracker = trackPageErrors(page);

      const response = await page.goto(route, {
        // Wait for the network to settle so client-only fetches (sync status,
        // notifications bell) have a chance to fail loudly if they're going
        // to. The default 'load' event fires too early to catch those.
        waitUntil: "networkidle",
      });

      // The Next.js dev server always responds with HTML so `response` is
      // guaranteed non-null on a real navigation. The `?subtype=…` route uses
      // a query string which `page.goto()` follows the same way; the response
      // is the redirect target if one fires.
      expect(response, `no response received for ${route}`).not.toBeNull();
      const status = response!.status();
      expect(
        status,
        `expected 2xx on ${route}, got ${status}`,
      ).toBeGreaterThanOrEqual(200);
      expect(status, `expected 2xx on ${route}, got ${status}`).toBeLessThan(
        400,
      );

      // Make sure something actually rendered. A 200 with a blank body is
      // worse than a 500 — assert the page has a `<main>` or `<h1>` so we
      // catch broken layouts that swallowed an error boundary.
      const renderedSomething = await pageRenderedSomething(page);
      expect(
        renderedSomething,
        `${route}: no main / h1 / aside in the DOM`,
      ).toBe(true);

      // Console-error / pageerror buckets must be empty.
      expect(
        tracker.isClean(),
        `${route} produced page errors:\n${tracker.snapshot()}`,
      ).toBe(true);
    });
  }
});

/**
 * Returns true if the page rendered any of the expected high-level shells.
 * We don't require all of them — `/search` is a minimal command-palette page
 * that has no `<main>` until the user types, but it has an `<aside>` sidebar.
 */
async function pageRenderedSomething(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    return (
      document.querySelector("main") != null ||
      document.querySelector("h1") != null ||
      document.querySelector("aside") != null
    );
  });
}
