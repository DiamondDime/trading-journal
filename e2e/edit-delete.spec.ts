/**
 * Skeleton tests for the Wave 6 Edit + Delete flows.
 *
 * Wave 6 introduces:
 *   • Edit buttons on each of the four detail pages that link to
 *     /add/<type>/fields?edit=<uuid> with the wizard pre-filled.
 *   • Delete buttons that confirm + soft-delete + redirect to the dashboard.
 *
 * These tests are skipped because the UI wiring is in flight (Wave 6.5,
 * 6.6) at the time this file was authored. Flip the `.skip` to `.fixme`
 * once the buttons land and we will then wire up real assertions.
 */
import { test, expect } from '@playwright/test';

test.skip('detail page Edit button routes to wizard with ?edit=<uuid> (Wave 6)', async ({ page }) => {
  // Pre-condition: dashboard has at least one trade.
  await page.goto('/spreads');
  const card = page
    .locator('a[href*="/trades/"]')
    .filter({ has: page.locator('text=BTC') })
    .first();
  await card.click();
  await expect(page).toHaveURL(/\/trades\/[0-9a-f-]{36}/);

  // The Edit button. Wave 6 spec: data-testid="edit-activity".
  await page.getByTestId('edit-activity').click();
  await expect(page).toHaveURL(/\/add\/trade\/fields\?edit=[0-9a-f-]{36}/);
  // The page should show the "Editing trade #XXX" banner.
  await expect(page.getByText(/^Editing/i)).toBeVisible();
});

test.skip('detail page Delete button soft-deletes + redirects to /spreads (Wave 6)', async ({ page }) => {
  await page.goto('/spreads');
  const card = page.locator('a[href*="/trades/"]').first();
  const href = await card.getAttribute('href');
  await card.click();
  await page.getByTestId('delete-activity').click();
  // Confirm-step dialog.
  await page.getByRole('button', { name: /Delete/i }).click();
  await expect(page).toHaveURL(/\/spreads$/);
  // The deleted trade is no longer reachable.
  if (href) {
    await page.goto(href);
    await expect(page.getByText(/404|not found/i)).toBeVisible();
  }
});

test.skip('edit submission shows "Updated" banner on detail page (Wave 6)', async ({ page }) => {
  // Placeholder for the action=edited banner path. To be expanded when
  // Wave 6's wizard-preview-banner integration is wired (6.4).
});
