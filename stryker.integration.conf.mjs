// @ts-check
//
// The integration layer's pass. The unit pass (stryker.conf.mjs) mutates the
// guards in src/lib and judges them with the unit, security, fuzz, contract
// and in-process integration specs. It leaves out every spec that starts a
// local Miniflare (vitest.mutation.config.ts says why), so the route handlers
// those specs drive, with a real D1, KV and the real migrations, were never
// mutated at all. This pass mutates those handlers and judges them with those
// specs only (vitest.mutation-integration.config.ts).
//
// TARGETS are the handlers behind the launch surfaces (profiles, profile type
// and vote opt-in, facets, portfolio, playlists, the sponsor report and sign-up),
// chosen from what the Miniflare specs drive:
//   auth-register   sign-up with a name, and a profile type
//   profile         profile type, vote opt-in, vanity slug
//   facets          a contributor's facets, and their erasure
//   portfolio       a contributor's portfolio
//   playlist        playlists through the router
//   sponsor         the sponsor report and its under-5 floor
//
// concurrency 1: one mutant at a time. The specs share nothing between
// Miniflare instances, but in parallel their D1 setup failed now and then
// (vitest.mutation.config.ts), and a pass whose score moves cannot hold a floor.
//
// Floors: mutation-floors.integration.json, checked by
// scripts/ci/mutation-file-floor.mjs --floors mutation-floors.integration.json.
//
// Run: `npm run test:mutation:integration`.
import base from './stryker.conf.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  vitest: { configFile: 'vitest.mutation-integration.config.ts' },
  mutate: [
    'src/handlers/auth-register.ts',
    'src/handlers/profile.ts',
    'src/handlers/facets.ts',
    'src/handlers/portfolio.ts',
    'src/handlers/playlist.ts',
    'src/handlers/sponsor.ts',
  ],
  concurrency: 1,
  htmlReporter: { fileName: 'reports/mutation-integration/index.html' },
  jsonReporter: { fileName: 'reports/mutation-integration/mutation.json' },
};
