import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the crypto-spread-journal e2e suite.
 *
 * Assumptions:
 *   • Tests run against a real Next.js dev server on http://localhost:3000.
 *     `webServer.reuseExistingServer: true` so a server you have running
 *     already is reused instead of spawning a second one.
 *   • Tests are read-only by design. They observe state, click around the
 *     wizards, and assert on URLs / DOM — but do not submit forms that mutate
 *     the DB. Safe to run against a populated single-user dev database.
 *   • Single worker. The app is single-user (APP_USER_ID) with a shared DB
 *     so parallel test runs would race on shared state. 1 worker is the
 *     correct cost/safety trade-off.
 *
 * v1 keeps the matrix tiny (Chromium only). Cross-browser is post-launch.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    navigationTimeout: 15_000,
    actionTimeout: 5_000,
    locale: "en-US",
    timezoneId: "UTC",
  },
  // If a dev server is already running, reuse it. Otherwise start one. Lets
  // `pnpm test:e2e` work both in CI (where it boots its own server) and in
  // local dev (where one is already running on :3000).
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
