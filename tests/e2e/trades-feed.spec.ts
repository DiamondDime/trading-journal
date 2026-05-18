/**
 * /trades feed page — hero, empty state, sidebar active.
 *
 * The /trades route is the positions feed across every connected exchange.
 * The orchestrator's session has 1 connected exchange and 0 positions, so
 * the "noPositions" empty-state branch should render with the "Connect
 * another exchange" CTA.
 *
 * Asserts:
 *   • Hero h1 = "Trades"
 *   • "Add manual entry" link → /add
 *   • Empty state title visible ("No positions yet." in noPositions branch
 *     OR "Connect an exchange to start logging." in noConnections branch —
 *     both are valid depending on connection count, so accept either)
 *   • In the noPositions branch, "Connect another exchange" → /settings/exchanges
 *   • Sidebar `/trades` link has aria-current="page"
 */
import { test, expect } from "@playwright/test";
import { hideDevOverlay, setLocaleCookie, trackPageErrors } from "./_helpers";

test.beforeEach(async ({ context }) => {
  await setLocaleCookie(context, "en");
  await hideDevOverlay(context);
});

test("/trades feed renders hero, empty state, and active nav highlight", async ({
  page,
}) => {
  const tracker = trackPageErrors(page);
  await page.goto("/trades");

  // ── Hero ────────────────────────────────────────────────────────────────
  await test.step("hero renders with 'Trades' h1", async () => {
    const h1 = page.locator("header h1").first();
    await expect(h1).toHaveText(/^Trades$/);
  });

  // ── Quick-add link ──────────────────────────────────────────────────────
  await test.step("'Add manual entry' link points to /add", async () => {
    // The link text is "Add manual entry" (Plus icon precedes it, but the
    // icon is decorative — no text content). Use role+name to find it.
    const link = page.getByRole("link", { name: /Add manual entry/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/add");
  });

  // ── Empty state ─────────────────────────────────────────────────────────
  await test.step("empty state visible (noConnections OR noPositions)", async () => {
    // Both branches share the same overall shell; we match by the title text.
    const noConnections = page.getByRole("heading", {
      name: /Connect an exchange to start logging/i,
    });
    const noPositions = page.getByRole("heading", {
      name: /No positions yet/i,
    });

    // The test environment has 1 connection + 0 positions → noPositions
    // branch. If the orchestrator's session ever changes to 0 connections,
    // the test should still pass: accept either heading.
    const seenAny =
      (await noConnections.count()) > 0 || (await noPositions.count()) > 0;
    expect(seenAny, "expected one of the empty-state headings").toBe(true);

    // If we're in the noPositions branch, the "Connect another exchange"
    // CTA must point at /settings/exchanges. Skip if we got the
    // noConnections branch instead.
    if ((await noPositions.count()) > 0) {
      const cta = page.getByRole("link", {
        name: /Connect another exchange/i,
      });
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute("href", "/settings/exchanges");
    }
  });

  // ── Sidebar active-link highlight ───────────────────────────────────────
  await test.step("sidebar /trades nav link is active", async () => {
    // The BOOK group has a "Trades" link → /trades. The BY ACTIVITY group
    // has a similar "Logged trades" → /spreads/archive?activity=trade. We
    // want the BOOK one only — scope by href.
    const sidebarTrades = page.locator('aside a[href="/trades"]');
    await expect(sidebarTrades).toHaveAttribute("aria-current", "page");
  });

  expect(
    tracker.isClean(),
    `/trades page produced errors:\n${tracker.snapshot()}`,
  ).toBe(true);
});
