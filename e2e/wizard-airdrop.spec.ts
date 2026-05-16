/**
 * Airdrop wizard: full happy-path.
 *
 * /add -> Airdrop -> /add/airdrop/fields -> submit -> /airdrops/<uuid>?from=wizard.
 */
import { test, expect } from '@playwright/test';

test('manual airdrop wizard: fields -> review -> detail', async ({ page }) => {
  const asset = `TA${Date.now().toString().slice(-5)}`;

  await page.goto('/add');
  await page.locator('a[href="/add/airdrop/fields"]').click();
  await expect(page).toHaveURL(/\/add\/airdrop\/fields/);

  await page.locator('input[name="protocol"]').fill('TestProto');
  await page.locator('input[name="asset"]').fill(asset);
  await page.locator('input[name="tokensClaimed"]').fill('1000');
  await page.locator('input[name="claimDate"]').fill('2026-04-15');
  await page.locator('input[name="usdValueAtClaim"]').fill('800');
  await page.locator('input[name="currentPriceUsd"]').fill('1.2');

  await page.getByRole('button', { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/add\/airdrop\/review/);
  await page.getByRole('button', { name: /Log airdrop|Save changes/i }).click();

  await page.waitForURL(/\/airdrops\/[0-9a-f-]{36}/, { timeout: 10_000 });
  expect(page.url()).toMatch(/from=wizard/);
  await expect(page.getByText(/just saved/i)).toBeVisible();
  await expect(page.getByText(asset).first()).toBeVisible();
});
