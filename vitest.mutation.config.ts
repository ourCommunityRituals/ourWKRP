import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// The Vitest project Stryker runs once per mutant (stryker.conf.mjs and
// stryker.schemas.conf.mjs).
//
// It is the default project (vitest.config.ts: same .html loader, node
// environment, globals) less what cannot judge a mutant:
//   - tests/performance: timing assertions. Under Stryker's instrumentation a
//     slower run would read as a killed mutant, which would make the score lie.
//   - three integration specs that test scripts, not src/: they spawn the
//     Playwright installer, the D1 seeder and the smoke reporter, which no
//     mutant in src/lib reaches.
//   - five specs that start a local Miniflare (workerd and D1) in beforeAll.
//     Under Stryker's parallel reruns their D1 setup failed now and then
//     ("fetch failed", "Migration 0001_initial.sql failed"). Stryker scores a
//     mutant whose run errors as neither killed nor survived, so the same file
//     scored 75, 87.5 and 93.3 on three runs, and 54 of schemas.ts's 160
//     mutants errored in one run. A floor cannot stand on a score that moves.
//     Their kills (cors.ts, html.ts, erasure.ts) are a follow-up: the same
//     cases at the unit layer.
// Leaving a spec out can only lose kills, never add one, so a pass is never
// easier than the full suite: a mutant only an excluded spec kills shows as
// survived and fails its floor.
//
// tests/support/mutation-setup.ts fixes the fast-check seed and lets
// structural specs read src/ as committed inside Stryker's sandbox.
export const MUTATION_TEST_DIRS = ['tests/unit', 'tests/security', 'tests/fuzz', 'tests/contract', 'tests/integration'];

export const MUTATION_EXCLUDED_SPECS = [
  'tests/integration/install-playwright-browsers.test.ts',
  'tests/integration/seed-local-d1.test.ts',
  'tests/integration/smoke-report.test.ts',
  'tests/integration/core-flows.test.ts',
  'tests/integration/determinism-ordering.test.ts',
  'tests/integration/facets-flow.test.ts',
  'tests/integration/vanity-slug.test.ts',
  'tests/security/vanity-slug-security.test.ts',
];

/**
 * The default project with `include` replaced, not extended. Vite's
 * mergeConfig concatenates arrays, so merging an `include` would keep the
 * default `tests/**` glob and run every layer (the first version did).
 * tests/unit/ci/mutation-gate.test.ts checks the resolved lists.
 */
export function mutationProject(include: string[]) {
  const config = mergeConfig(
    base,
    defineConfig({
      test: { setupFiles: ['tests/support/mutation-setup.ts'], exclude: MUTATION_EXCLUDED_SPECS },
    }),
  );
  return { ...config, test: { ...config.test, include } };
}

export default mutationProject(
  MUTATION_TEST_DIRS.flatMap((d) => [`${d}/**/*.test.ts`, `${d}/**/*.invariant.spec.ts`]),
);
