/**
 * Settings -> Exchanges page basic flow.
 *
 * Scope (read-only / shallow):
 *   • Page loads (empty state OR table renders).
 *   • Add exchange dialog opens, advances through pick step, and lets the
 *     user dismiss without committing credentials.
 *
 * We do NOT POST real credentials in this test — that would write encrypted
 * rows to the dev database. Submitting the dialog is covered manually in the
 * pre-launch QA checklist.
 */
import { test, expect } from '@playwright/test';

test('settings/exchanges renders + Add Exchange dialog opens', async ({ page }) => {
  await page.goto('/settings/exchanges');

  // Either the empty-state primary button OR the table-mode trigger should
  // be present (the page has no other variant). data-testid is stable.
  const trigger = page.getByTestId('add-exchange-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();

  // Dialog title appears.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/Connect an exchange/)).toBeVisible();

  // Escape closes the dialog without writing.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('settings/exchanges: pick Binance reveals credentials step', async ({ page }) => {
  await page.goto('/settings/exchanges');
  await page.getByTestId('add-exchange-trigger').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Pick Binance from the catalog list. The pick step uses buttons named
  // after the exchange display name.
  const binance = page
    .getByRole('button', { name: /Binance/, exact: false })
    .first();
  await binance.click();

  // Should advance to the credentials step.
  await expect(page.getByText(/Step 2 of 2/i)).toBeVisible();

  // Back closes the dialog cleanly.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
