import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the crypto-spread-journal e2e suite.
 *
 * Assumptions:
 *   • A dev server is already running on http://localhost:3000 with the
 *     development database seeded (`pnpm db:reset && pnpm db:seed`).
 *   • Tests use `read-only` flows by default. Wizard flows write new rows
 *     and assert against them, but never modify seeded fixtures.
 *
 * v1 keeps the matrix tiny (Chromium only). Cross-browser is post-launch.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 10_000,
    actionTimeout: 5_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
