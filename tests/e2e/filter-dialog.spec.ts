/**
 * Dashboard filter dialog.
 *
 * The dialog is the primary control for narrowing /spreads (the dashboard).
 * If any of its chips disappear or wire to the wrong state, the dashboard
 * silently shows wrong totals — exactly the kind of bug that's hard to spot
 * in code review.
 *
 * Behavior under test:
 *   • Clicking the trigger opens the dialog.
 *   • The dialog renders the three fieldsets we ship today
 *     (date range / activity types / minimum capital) with the right chips.
 *   • Reset / Cancel / Apply / Close all exist.
 *   • Pressing Cancel closes the dialog and restores no-dialog state.
 *
 * Read-only: we never click Apply, so dashboard state is unchanged.
 */
import { test, expect, type Locator } from "@playwright/test";
import { hideDevOverlay, setLocaleCookie, trackPageErrors } from "./_helpers";

test.beforeEach(async ({ context }) => {
  await setLocaleCookie(context, "en");
  await hideDevOverlay(context);
});

test("dashboard filter dialog opens with all chips and closes via Cancel", async ({
  page,
}) => {
  const tracker = trackPageErrors(page);
  await page.goto("/spreads");

  // ── Open the dialog ──────────────────────────────────────────────────────
  const openButton = page.getByRole("button", {
    name: "Open filters dialog",
  });
  await expect(openButton).toBeVisible();
  await openButton.click();

  // Radix renders the dialog at the document root with role="dialog". Scope
  // every subsequent locator to it so we don't accidentally match a sidebar
  // chip with the same label.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Filter the dashboard/i })).toBeVisible();

  // ── Date range chips ────────────────────────────────────────────────────
  await test.step("date range chips render", async () => {
    const labels = ["Last 7d", "Last 30d", "Last 90d", "YTD", "All-time", "Custom"];
    for (const label of labels) {
      await expectChip(dialog, label);
    }
  });

  // ── Activity type chips ─────────────────────────────────────────────────
  await test.step("activity type chips render", async () => {
    // The dashboard filter is limited to the 4 primary activity types
    // (yield + option don't appear here today). If we ever add them, this
    // test will fail and force a deliberate update.
    const labels = ["Spreads", "Trades", "Sales", "Airdrops"];
    for (const label of labels) {
      await expectChip(dialog, label);
    }
  });

  // ── Minimum capital chips ───────────────────────────────────────────────
  await test.step("min-capital chips render", async () => {
    const labels = ["$0", "$500+", "$5,000+"];
    for (const label of labels) {
      await expectChip(dialog, label);
    }
  });

  // ── Footer actions ──────────────────────────────────────────────────────
  await test.step("footer has Reset, Cancel, Apply, Close", async () => {
    await expect(
      dialog.getByRole("button", { name: /^Reset$/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /^Cancel$/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /^Apply$/ }),
    ).toBeVisible();
    // The Close button is a Radix DialogClose ("X" icon in the corner) — its
    // accessible name is "Close" via aria-label.
    await expect(
      dialog.getByRole("button", { name: "Close" }),
    ).toBeVisible();
  });

  // ── Cancel closes the dialog ─────────────────────────────────────────────
  await test.step("Cancel closes the dialog", async () => {
    await dialog.getByRole("button", { name: /^Cancel$/ }).click();
    // Radix unmounts on close; assert it disappears from the a11y tree.
    await expect(dialog).toBeHidden();
  });

  expect(
    tracker.isClean(),
    `filter dialog walk produced errors:\n${tracker.snapshot()}`,
  ).toBe(true);
});

/**
 * Assert that the dialog contains a button with this exact label. We require
 * exact match (`name: new RegExp(\`^...$\`)`) so we don't catch other chips
 * whose label contains the substring — `"Last 7d"` would match `"Last 7d"`
 * but a hypothetical `"Last 7d (filtered)"` would also match without the
 * anchors.
 */
async function expectChip(dialog: Locator, label: string): Promise<void> {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chip = dialog.getByRole("button", { name: new RegExp(`^${escaped}$`) });
  await expect(chip, `expected chip "${label}" inside filter dialog`).toBeVisible();
}
