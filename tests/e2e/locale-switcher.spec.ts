/**
 * Locale switcher round-trip.
 *
 * The sidebar footer has an EN / РУ toggle wired to a Server Action that
 * sets the `csj-locale` cookie and revalidates the layout. A regression
 * could leave the cookie set but skip the revalidation, so the page would
 * stay in English even though the toggle now shows РУ as pressed. This
 * test guards both the cookie change AND the resulting DOM update.
 *
 * The dashboard h1 reads from `dashboard.title`:
 *   en → "The book"
 *   ru → "Журнал"  (NOT "Книга" — the brief said "Книга" but the source
 *                   string is "Журнал")
 *
 * Read-only: only the locale cookie changes. We reset it in afterEach.
 */
import { test, expect } from "@playwright/test";
import { hideDevOverlay, setLocaleCookie } from "./_helpers";

test.beforeEach(async ({ context }) => {
  await hideDevOverlay(context);
});

test.afterEach(async ({ context }) => {
  // Bring the cookie back to EN for subsequent specs.
  await setLocaleCookie(context, "en");
});

test("locale switcher: EN → РУ → EN updates the dashboard hero", async ({
  page,
  context,
}) => {
  // Start in EN.
  await setLocaleCookie(context, "en");
  await page.goto("/spreads");

  const h1 = page.locator("main h1, header h1").first();

  await test.step("EN: hero shows 'The book'", async () => {
    await expect(h1).toHaveText(/^The book$/);
  });

  await test.step("click РУ in the sidebar locale switcher", async () => {
    // The locale switcher buttons live inside a role="group" with
    // aria-label="Language". Both EN and РУ are <button aria-pressed=...>.
    const ruButton = page.getByRole("button", { name: /^РУ$/ });
    await expect(ruButton).toBeVisible();
    await ruButton.click();
  });

  await test.step("RU: hero re-renders as 'Журнал'", async () => {
    // The server action revalidates the layout; the next RSC payload arrives
    // and the hero updates. Wait on the text rather than a fixed timeout.
    await expect(h1).toHaveText(/^Журнал$/, { timeout: 10_000 });
  });

  await test.step("click EN to flip back", async () => {
    const enButton = page.getByRole("button", { name: /^EN$/ });
    await enButton.click();
    await expect(h1).toHaveText(/^The book$/, { timeout: 10_000 });
  });
});
