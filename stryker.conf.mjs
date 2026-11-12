// @ts-check
//
// Mutation testing (StrykerJS), modelled on OSE's (ourSharedEvents
// workers/oursharedevents/stryker.conf.mjs, OSE-1186 G1). The integrity gates
// catch a test that is skipped; they cannot see one that is hollow, green with
// no assertion that bites. Stryker changes the source one small fault at a time
// (a `<` to `<=`, a `true` to `false`, a removed call) and reruns the tests that
// cover that line. A mutant that survives is a fault the suite would let ship.
//
// TARGETS are OW's security and privacy guards, chosen by what they protect,
// not by convenience:
//   count-floor        the under-5 floor (never who, only how many)
//   session, session-cookie, require-session, roles, admin-auth
//                      who may do what, and for how long
//   origin-check, cors, cross-product-auth
//                      which callers are trusted at all
//   rate-limit         the burst limit
//   security-headers, html
//                      CSP and escaping between stored data and the page
//   validate, schemas, ids, route-path, cursor
//                      the shapes untrusted input must take
//   privacy, erasure   what is published, and the right to erasure
//   crypto             the hashing and tokens the above rely on
//
// Each file has its own floor in mutation-floors.json, checked by
// scripts/ci/mutation-file-floor.mjs, because the `break` below is global and
// one file at 100% can carry another well under the bar. Add a target here and
// its floor there; tests/unit/ci/mutation-gate.test.ts fails when they differ.
//
// Run: `npm run test:mutation`. CI: .github/workflows/mutation-testing.yml.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts' },
  mutate: [
    'src/lib/count-floor.ts',
    'src/lib/session.ts',
    'src/lib/session-cookie.ts',
    'src/lib/require-session.ts',
    'src/lib/roles.ts',
    'src/lib/admin-auth.ts',
    'src/lib/origin-check.ts',
    'src/lib/cors.ts',
    'src/lib/cross-product-auth.ts',
    'src/lib/rate-limit.ts',
    'src/lib/security-headers.ts',
    'src/lib/html.ts',
    'src/lib/validate.ts',
    'src/lib/schemas.ts',
    'src/lib/ids.ts',
    'src/lib/route-path.ts',
    'src/lib/cursor.ts',
    'src/lib/privacy.ts',
    'src/lib/erasure.ts',
    'src/lib/crypto.ts',
  ],
  coverageAnalysis: 'perTest',
  // Stryker writes `// @ts-nocheck` into its sandbox copy of each file this
  // matches. Its default also matches `.html`, which would put the comment into
  // the templates' inline scripts (OSE hit this). Script files only.
  disableTypeChecks: '{src,tests}/**/*.{js,mjs,cjs,ts,mts,cts}',
  // `json` feeds the per-file floor.
  reporters: ['html', 'clear-text', 'progress', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  // The global bar. The per-file floors are the real gate (see above); this
  // only stops a run that is far off. Set at the first measured run.
  thresholds: { high: 95, low: 80, break: 80 },
};
