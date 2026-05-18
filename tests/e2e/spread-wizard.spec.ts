/**
 * Spread wizard — manual-entry happy path.
 *
 * Walks the path:
 *   /add  →  Spread tile  →  /add/spread/source  →  Manual entry tile
 *         →  /add/spread/type?source=manual
 *         →  click "Long-short perps · same venue"
 *         →  /add/spread/fields?spreadType=funding&variantCanonical=same_venue&source=manual
 *
 * Then asserts the fields page rendered with the expected variant + status
 * defaults, the manual leg builder is present, and the BACK link round-trips
 * to the same /type URL it came from.
 *
 * Read-only: the test stops before submitting the form so no row is created.
 *
 * Assumes locale=en. If the orchestrator runs this in a Russian session the
 * EN tile texts ("Spread", "Manual entry", "Long-short perps · same venue")
 * would miss — beforeEach pins the cookie.
 */
import { test, expect } from "@playwright/test";
import { hideDevOverlay, setLocaleCookie, trackPageErrors } from "./_helpers";

test.beforeEach(async ({ context }) => {
  await setLocaleCookie(context, "en");
  await hideDevOverlay(context);
});

test("spread wizard: /add → Spread → Manual entry → Long-short same venue → /fields", async ({
  page,
}) => {
  const tracker = trackPageErrors(page);

  // ── Step 1: /add → click "Spread" tile ───────────────────────────────────
  await test.step("navigate to /add and click the Spread tile", async () => {
    await page.goto("/add");
    // The Spread tile is rendered by WizardRadioCardLink with the title in an
    // <h2>. Use the link's href to disambiguate from other "Spread" mentions
    // in the sidebar.
    await page.locator('a[href="/add/spread/source"]').click();
    await expect(page).toHaveURL(/\/add\/spread\/source$/);
  });

  // ── Step 2: /add/spread/source → click "Manual entry" ────────────────────
  await test.step('click "Manual entry"', async () => {
    // Manual entry card hrefs to /add/spread/type?source=manual.
    await page
      .locator('a[href="/add/spread/type?source=manual"]')
      .click();
    await expect(page).toHaveURL(/\/add\/spread\/type\?source=manual/);
  });

  // ── Step 3: /add/spread/type → click "Long-short perps · same venue" ─────
  await test.step('click "Long-short perps · same venue"', async () => {
    // The card title is rendered inside an <h4>; click the wrapping <a>.
    const card = page.locator(
      'a[href*="spreadType=funding"][href*="variantCanonical=same_venue"][href*="source=manual"]',
    );
    await expect(card).toBeVisible();
    // Sanity-check the visible text so a future refactor that swaps the
    // selector accidentally still fails loudly.
    await expect(card).toContainText("Long-short perps");
    await card.click();
  });

  // ── Step 4: /add/spread/fields — verify rendering ────────────────────────
  await test.step("assert /fields rendered with expected defaults", async () => {
    // URL contains all three params (order can vary; assert each).
    await expect(page).toHaveURL(/\/add\/spread\/fields/);
    const url = new URL(page.url());
    expect(url.searchParams.get("spreadType")).toBe("funding");
    expect(url.searchParams.get("variantCanonical")).toBe("same_venue");
    expect(url.searchParams.get("source")).toBe("manual");

    // Radio: variantCanonical=same_venue should be checked. The input is
    // sr-only, so `toBeChecked()` is the only safe assertion — visibility
    // checks would fail.
    const sameVenueRadio = page.locator(
      'input[name="variantCanonical"][value="same_venue"]',
    );
    await expect(sameVenueRadio).toBeChecked();

    // Status: manual path defaults to "closed".
    const statusClosed = page.locator(
      'input[name="status"][value="closed"]',
    );
    await expect(statusClosed).toBeChecked();

    // The manual leg builder is rendered with an "Add leg" button.
    const addLegButton = page.getByRole("button", { name: /^Add leg$/i });
    await expect(addLegButton).toBeVisible();
  });

  // ── Step 5: BACK round-trips to /add/spread/type with the same params ────
  await test.step("BACK link round-trips to /add/spread/type", async () => {
    const backLink = page.getByRole("link", { name: /^Back$/ });
    await expect(backLink).toBeVisible();
    const href = await backLink.getAttribute("href");
    expect(href).toBeTruthy();
    // The href is a relative URL beginning with /add/spread/type. Parse it.
    const parsed = new URL(href!, page.url());
    expect(parsed.pathname).toBe("/add/spread/type");
    expect(parsed.searchParams.get("source")).toBe("manual");
    expect(parsed.searchParams.get("spreadType")).toBe("funding");
    expect(parsed.searchParams.get("variantCanonical")).toBe("same_venue");
  });

  // No console / page errors during the whole walk.
  expect(
    tracker.isClean(),
    `spread wizard produced page errors:\n${tracker.snapshot()}`,
  ).toBe(true);
});
