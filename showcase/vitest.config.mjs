import { defineConfig } from 'vitest/config';

// The creator showcase's own suite (security, contract, unit, born-red). Run from
// the repo root:  npx vitest run --config showcase/vitest.config.mjs
// The root suite (vitest.config.ts) only collects tests/**, so nothing runs twice.
export default defineConfig({
  test: {
    root: '.',
    include: ['showcase/tests/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 30_000,
    // Born-red mutants are written under showcase/lib/.mutants; one file at a time.
    fileParallelism: false,
  },
});
