import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest configuration for the Wave 7 test suite.
//
// - tests/unit          -- pure-function tests, no I/O.
// - tests/integration   -- real Postgres against crypto_spread_journal_test.
//                          Boot the DB via `pnpm test:db:setup` first.
// - src colocated tests -- reserved (none yet).
//
// The `e2e` directory is excluded -- Playwright owns that and uses its own
// config.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/helpers/setup.ts'],
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
    ],
    // Vitest 4 hoists pool config to top-level. We use a single fork so
    // integration files do not race on the shared test DB user.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/types/database.types.ts',
        'src/app/**/page.tsx',
        'src/app/**/layout.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
