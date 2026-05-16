/**
 * Vitest global setup — runs once before any test file is imported.
 *
 * Responsibilities:
 *   1. Force-set DATABASE_URL to the test database so postgres.js's singleton
 *      in src/lib/db/client.ts connects to `crypto_spread_journal_test`.
 *      This MUST happen before any module imports `@/lib/db/client`.
 *   2. Provide a deterministic CREDENTIALS_MASTER_KEY so encryption helpers
 *      don't pull in the dev-env key.
 *   3. Provide a default APP_USER_ID for auth-related tests.
 *
 * Override any of these by setting them in your environment before running:
 *   TEST_DATABASE_URL=… pnpm test:run
 */

// Test database — separate from dev DB to keep prod data clean.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${process.env.USER ?? 'skywalqr'}@localhost:5432/crypto_spread_journal_test`;

// Deterministic key — 32 random bytes base64-encoded. NEVER use in prod.
// We hard-code it so the encrypt-then-decrypt round-trip is reproducible
// across runs (and across the round-trip test that needs the same key).
process.env.CREDENTIALS_MASTER_KEY =
  process.env.CREDENTIALS_MASTER_KEY ??
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

// Default test user. Individual tests can use this UUID or override.
process.env.APP_USER_ID =
  process.env.APP_USER_ID ?? '11111111-1111-1111-1111-111111111111';
