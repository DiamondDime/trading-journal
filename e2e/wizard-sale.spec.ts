/**
 * Sale wizard: full happy-path.
 *
 * /add -> Sale card -> /add/sale/fields -> submit -> /sales/<uuid>?from=wizard
 *
 * Asset is timestamped so re-runs do not collide.
 */
import { test, expect } from '@playwright/test';

test('manual sale wizard: fields -> review -> detail', async ({ page }) => {
  const asset = `TS${Date.now().toString().slice(-5)}`;

  await page.goto('/add');
  // The Sale card links to /add/sale/fields. Match by href to avoid the
  // accessible-name collision with the "Sale" word inside other cards.
  await page.locator('a[href="/add/sale/fields"]').click();
  await expect(page).toHaveURL(/\/add\/sale\/fields/);

  // sale kind: launchpad. The radio inputs are visually `sr-only`; check the
  // form value programmatically by clicking the wrapping label which the
  // markup uses to capture clicks.
  await page
    .locator('input[name="saleKind"][value="launchpad"]')
    .check({ force: true });
  await page.locator('input[name="venue"]').fill('Binance Launchpad');
  await page.locator('input[name="asset"]').fill(asset);
  await page.locator('input[name="usdPaid"]').fill('1500');
  await page.locator('input[name="tokensAllocated"]').fill('500');
  await page.locator('input[name="tgeDate"]').fill('2026-04-01');
  await page.locator('input[name="tgeUnlockPct"]').fill('100');
  await page.locator('input[name="currentPriceUsd"]').fill('5');
  await page.locator('input[name="openedAt"]').fill('2026-03-15T10:00');
  await page.getByRole('button', { name: /^Review/ }).click();

  await expect(page).toHaveURL(/\/add\/sale\/review/);
  await page.getByRole('button', { name: /Log sale|Save changes/i }).click();

  await page.waitForURL(/\/sales\/[0-9a-f-]{36}/, { timeout: 10_000 });
  expect(page.url()).toMatch(/from=wizard/);
  await expect(page.getByText(/just saved/i)).toBeVisible();
  // Asset symbol shows in the detail page hero.
  await expect(page.getByText(asset).first()).toBeVisible();
});
