import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// The Vitest project Stryker runs once per mutant (stryker.conf.mjs).
//
// It is the default project (vitest.config.ts: same .html loader, node
// environment, globals) narrowed to the layers that test src/ logic in
// process: unit, security, fuzz and contract. Two layers are left out:
//   - tests/integration: several specs spawn processes (wrangler, the D1
//     seeder, the Playwright installer). Per mutant, that is minutes of work
//     for code the mutated modules do not reach.
//   - tests/performance: timing assertions. Under Stryker's instrumentation a
//     slower run would read as a killed mutant, which would make the score lie.
// Leaving a layer out can only lose kills, never add one, so this pass is
// never easier than the full suite: a mutant only an excluded spec kills
// shows as survived and fails its floor.
//
// tests/support/mutation-setup.ts fixes the fast-check seed, so a fuzz
// property kills the same mutants on every run. A random seed would let a
// mutant be killed on one run and survive the next.
export const MUTATION_TEST_DIRS = ['tests/unit', 'tests/security', 'tests/fuzz', 'tests/contract'];

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: MUTATION_TEST_DIRS.flatMap((d) => [`${d}/**/*.test.ts`, `${d}/**/*.invariant.spec.ts`]),
      setupFiles: ['tests/support/mutation-setup.ts'],
    },
  }),
);
