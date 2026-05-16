/**
 * Dashboard golden path.
 *
 * Verifies that /spreads renders against seeded DB data:
 *   • hero net P&L is a real value (not an em-dash placeholder)
 *   • the "recent closes" section renders at least one card
 *   • clicking a card lands on a detail page whose URL contains a UUID
 *     suffix matching one of /trades/, /sales/, /airdrops/, /spreads/[id]
 */
import { test, expect } from '@playwright/test';

test('dashboard renders KPIs + recent closes + drill-down link', async ({ page }) => {
  await page.goto('/spreads');

  // The hero KPI grid renders the net-P&L value somewhere in its first card.
  // Match the dollar sign (the helper formats with $ even for tiny values) —
  // if the value is missing the page renders an em-dash placeholder.
  const heroKpi = page.locator('main').getByText(/\$[0-9]/).first();
  await expect(heroKpi).toBeVisible();

  // The recent closes section heading.
  await expect(
    page.getByRole('heading', { name: /recent closes/i }),
  ).toBeVisible();

  // At least one card has a /spreads/<uuid>, /trades/<uuid>, /sales/<uuid>,
  // or /airdrops/<uuid> href. The regex requires a UUID suffix so we ignore
  // /spreads (root) and /spreads/archive.
  const cardLinks = page.locator(
    'a[href*="/spreads/"], a[href*="/trades/"], a[href*="/sales/"], a[href*="/airdrops/"]',
  );
  const count = await cardLinks.count();
  let drillLink: import('@playwright/test').Locator | null = null;
  for (let i = 0; i < count; i++) {
    const href = await cardLinks.nth(i).getAttribute('href');
    if (href && /[0-9a-f-]{36}/.test(href)) {
      drillLink = cardLinks.nth(i);
      break;
    }
  }
  expect(drillLink, 'expected at least one detail-page link with a UUID').not.toBeNull();
  await drillLink!.click();
  await expect(page).toHaveURL(/(spreads|trades|sales|airdrops)\/[0-9a-f-]{36}/);
});
