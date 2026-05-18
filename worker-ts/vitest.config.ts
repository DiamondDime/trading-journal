import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    // forks.singleFork avoids worker_threads vs ccxt's CommonJS interop
    // segfaults we saw with the default threads pool on Node 22 (vitest 4).
    forks: { singleFork: true },
  },
});
