/**
 * Wave 6 Edit + Delete flows (Wave 8 fix B-5).
 *
 * Each test creates its own trade via the manual wizard so we don't depend
 * on stable seeded UUIDs. The created row is then edited or deleted; the
 * assertions land on either the detail page (after edit, "Updated" banner
 * visible) or the dashboard (after delete, the detail URL 404s).
 *
 * Strategy:
 *   • A short helper logs a unique trade and returns its detail URL so
 *     each test gets a clean target row.
 *   • Selectors prefer role + name over CSS so they survive class-name churn.
 *   • Edit happens via the link `/add/trade/fields?edit=<uuid>` — same path
 *     the detail page renders for the Edit button.
 *
 * Wizard timing is bounded by `actionTimeout` + `navigationTimeout` from
 * playwright.config.ts; specific waits use the same timeouts as
 * e2e/wizard-trade.spec.ts (10s for detail-page redirects).
 */
import { test, expect, type Page } from '@playwright/test';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Walk the trade wizard end-to-end with the supplied symbol. Returns the
 * detail URL the wizard redirects to so the calling test can navigate or
 * assert on the new row. Mirrors e2e/wizard-trade.spec.ts but stops short
 * of the archive check.
 */
async function logTrade(page: Page, symbol: string): Promise<string> {
  await page.goto('/add/trade/fields');
  await page.locator('select[name="exchange"]').selectOption('Binance');
  await page.locator('input[name="symbol"]').fill(symbol);
  await page
    .locator('input[name="instrument"][value="perp"]')
    .check({ force: true });
  await page
    .locator('input[name="side"][value="long"]')
    .check({ force: true });
  await page.locator('input[name="capital"]').fill('5000');
  await page.locator('input[name="qty"]').fill('0.5');
  await page.locator('input[name="entryPrice"]').fill('65000');
  await page.locator('input[name="exitPrice"]').fill('67000');
  await page.locator('input[name="fees"]').fill('5');
  await page.locator('input[name="openedAt"]').fill('2026-05-01T10:00');
  await page.locator('input[name="closedAt"]').fill('2026-05-02T10:00');
  await page.getByRole('button', { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/add\/trade\/review/);
  await page.getByRole('button', { name: /Log trade/i }).click();
  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 10_000 });
  const url = page.url();
  expect(url).toMatch(UUID_RE);
  return url;
}

test('edit a trade: modify capital + close + see "Updated" banner', async ({
  page,
}) => {
  const symbol = `EDT-${Date.now().toString().slice(-6)}-PERP`;
  const detailUrl = await logTrade(page, symbol);

  // Trade row exists — click Edit. The button is a Link, not a <button>, so
  // we go by visible text inside the Actions section.
  await page.getByRole('link', { name: /^Edit$/ }).click();

  // Wizard should be in edit mode, fields pre-filled.
  await expect(page).toHaveURL(/\/add\/trade\/fields\?edit=[0-9a-f-]{36}/);
  await expect(page.locator('input[name="symbol"]')).toHaveValue(symbol);
  // Capital comes back from Postgres NUMERIC as "5000.00000000" — match the
  // numeric value, not the literal string.
  await expect(page.locator('input[name="capital"]')).toHaveValue(/^5000(\.0+)?$/);

  // Bump capital. Other fields stay; the action recomputes net_pnl_usd.
  await page.locator('input[name="capital"]').fill('7500');
  await page.getByRole('button', { name: /^Review/ }).click();

  // Review step still carries edit=<uuid> through hidden inputs; submitting
  // dispatches updateTradeActivity instead of createTrade.
  await expect(page).toHaveURL(/\/add\/trade\/review/);
  // The submit button copy on edit is "Save changes" not "Log trade".
  const submit = page.getByRole('button', { name: /Save changes|Log trade/i });
  await submit.click();

  // Land back on the same detail URL with action=edited so the banner says
  // "Updated".
  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 10_000 });
  expect(page.url()).toMatch(/action=edited/);
  await expect(page.getByText(/^Updated/i)).toBeVisible();
  // Symbol should still be the same — proves we edited the same row, not
  // created a new one.
  await expect(page.getByText(symbol)).toBeVisible();
  // Reload to confirm the edit truly persisted.
  await page.reload();
  await expect(page.getByText(symbol)).toBeVisible();
  // Final sanity: same detail UUID before and after edit.
  expect(page.url().match(UUID_RE)?.[0]).toBe(detailUrl.match(UUID_RE)?.[0]);
});

test('delete a trade: confirm dialog → /spreads/archive, detail 404s', async ({
  page,
}) => {
  const symbol = `DEL-${Date.now().toString().slice(-6)}-PERP`;
  const detailUrl = await logTrade(page, symbol);
  const uuid = detailUrl.match(UUID_RE)?.[0];
  expect(uuid).toBeTruthy();

  // Open the Delete dialog.
  await page.getByRole('button', { name: /^Delete$/ }).click();

  // Confirm dialog body mentions the soft-delete reality (Wave 8 fix B-3).
  await expect(page.getByRole('heading', { name: /Delete this trade/i })).toBeVisible();
  // Click the destructive confirmation. There are two visible buttons named
  // /Delete/ in the dialog (the small icon trigger is now hidden behind the
  // open dialog, but a Cancel button + Delete trade button exist). Pick the
  // one whose label includes the type word.
  await page.getByRole('button', { name: /Delete trade/i }).click();

  // The component redirects to /spreads/archive after success.
  await page.waitForURL(/\/spreads\/archive$/, { timeout: 10_000 });

  // The deleted trade detail URL is now a 404.
  await page.goto(`/trades/${uuid}`);
  await expect(page.getByText(/404|not found/i)).toBeVisible();
});

test('edit cancellation: Cancel in wizard chrome returns to /spreads without changing the row', async ({
  page,
}) => {
  const symbol = `CAN-${Date.now().toString().slice(-6)}-PERP`;
  const detailUrl = await logTrade(page, symbol);

  // Navigate into edit mode.
  await page.goto(detailUrl);
  await page.getByRole('link', { name: /^Edit$/ }).click();
  await expect(page).toHaveURL(/\/add\/trade\/fields\?edit=[0-9a-f-]{36}/);

  // The wizard chrome has a top-right Cancel link that returns to /spreads
  // unconditionally. Clicking it must NOT touch the row.
  await page.getByRole('link', { name: /^Cancel$/ }).click();
  await expect(page).toHaveURL(/\/spreads$/);

  // The original row should still be intact when we navigate back to it.
  await page.goto(detailUrl);
  await expect(page.getByText(symbol)).toBeVisible();
});
