/**
 * Archive filter URL sync.
 *
 *   • Trades chip -> ?activity=trade in URL
 *   • Winners chip -> &outcome=winners appended
 *   • Reset -> URL clears
 *
 * The filter row is purely client-state -> URL pushed via history.replaceState
 * (see ArchiveBrowser). We assert on the URL search params, not the row count
 * (the dataset includes 27 seeded activities, but the precise counts will
 * drift as wizards run).
 */
import { test, expect } from '@playwright/test';

test('archive chip clicks push to URL; reset clears it', async ({ page }) => {
  await page.goto('/spreads/archive');

  // Wait for chips to render (client component hydrates after server HTML).
  const tradesChip = page.getByRole('button', { name: /^Trade · / });
  await expect(tradesChip).toBeVisible();
  await tradesChip.click();
  await expect(page).toHaveURL(/activity=trade/);

  const winnersChip = page.getByRole('button', { name: /^Winners · / });
  await winnersChip.click();
  await expect(page).toHaveURL(/outcome=winners/);
  await expect(page).toHaveURL(/activity=trade/);

  // Reset button only appears when filters are active.
  await page.getByRole('button', { name: /Reset/ }).click();
  // After reset both query params are gone.
  await expect(page).not.toHaveURL(/activity=/);
  await expect(page).not.toHaveURL(/outcome=/);
});

test('archive URL filter is honoured on direct load (deep-link)', async ({ page }) => {
  // Deep-linking the archive with ?activity=trade should preserve the
  // selection (the chip starts active).
  await page.goto('/spreads/archive?activity=trade');
  const tradesChip = page.getByRole('button', { name: /^Trade · / });
  await expect(tradesChip).toHaveAttribute('aria-pressed', 'true');
});
