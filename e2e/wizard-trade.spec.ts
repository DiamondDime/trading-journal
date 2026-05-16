/**
 * Trade wizard: full happy-path.
 *
 * Click /add -> Trade card -> Manual entry -> fill all fields -> Review ->
 * Log trade -> land on /trades/<uuid>?from=wizard -> banner visible ->
 * reload -> trade still there -> navigate to archive and confirm it shows up.
 *
 * Symbol is suffixed with a timestamp so the row is uniquely findable after
 * the seed pool and re-runs do not collide.
 */
import { test, expect } from '@playwright/test';

test('manual trade wizard: source -> fields -> review -> detail -> archive', async ({
  page,
}) => {
  const symbol = `TST-${Date.now().toString().slice(-6)}-PERP`;

  // ── /add: pick the Trade card ──────────────────────────────────────────
  await page.goto('/add');
  await page.locator('a[href="/add/trade/source"]').click();

  // ── /add/trade/source: pick Manual entry ──────────────────────────────
  await expect(page).toHaveURL(/\/add\/trade\/source/);
  await page.locator('a[href="/add/trade/fields"]').click();

  // ── /add/trade/fields: fill the form ──────────────────────────────────
  await expect(page).toHaveURL(/\/add\/trade\/fields/);
  // Native <select name="exchange">.
  await page.locator('select[name="exchange"]').selectOption('Binance');
  await page.locator('input[name="symbol"]').fill(symbol);
  // Radios are sr-only inside <label> wrappers; force-check bypasses
  // visibility checks.
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

  // ── /add/trade/review: confirm + submit ───────────────────────────────
  await expect(page).toHaveURL(/\/add\/trade\/review/);
  // The review screen should show a derived headline metric (APR or net P&L).
  // We don't assert a specific number — just that the page rendered fully.
  await expect(page.getByRole('button', { name: /Log trade/i })).toBeVisible();
  await page.getByRole('button', { name: /Log trade/i }).click();

  // ── /trades/<uuid>?from=wizard ────────────────────────────────────────
  await page.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 10_000 });
  const detailUrl = page.url();
  expect(detailUrl).toMatch(/from=wizard/);
  await expect(page.getByText(/just saved/i)).toBeVisible();
  await expect(page.getByText(symbol)).toBeVisible();

  // Reload: trade is persisted (the banner goes away once `?from=wizard` is
  // gone from the URL but the trade data must still be there).
  await page.reload();
  await expect(page.getByText(symbol)).toBeVisible();

  // ── Archive: trade is in the cross-activity feed ──────────────────────
  await page.goto('/spreads/archive');
  // Filter chips are buttons whose label contains the activity-type word.
  await page.getByRole('button', { name: /^Trade · / }).click();
  // URL gets ?activity=trade.
  await expect(page).toHaveURL(/activity=trade/);
  // The auto-derived name is "<base> <side> · perp" — base is parsed from the
  // symbol's first hyphen-split segment, so "TST-925482-PERP" -> "TST".
  // That auto-name appears in the archive row.
  const baseToken = symbol.split('-')[0]; // "TST"
  await expect(page.getByText(new RegExp(`${baseToken} long`)).first())
    .toBeVisible();
});
