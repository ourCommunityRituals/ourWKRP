import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

export default defineConfig({
  // src/handlers/pages.ts imports *.html templates as text strings (wrangler
  // resolves these via [[rules]] type = "Text"). Mirror that for tests so the
  // real page handler — and anything that imports the router — loads cleanly.
  plugins: [
    {
      name: 'wkrp-html-as-text',
      enforce: 'pre',
      load(id: string) {
        const path = id.split('?')[0];
        if (path.endsWith('.html')) {
          return `export default ${JSON.stringify(readFileSync(path, 'utf-8'))};`;
        }
        return null;
      },
    },
  ],
  test: {
    globals: true,
    environment: 'node',
    // *.test.ts is the default suite. *.invariant.spec.ts is the OCR brain
    // invariant-test naming convention (architectural-invariants.yaml gives
    // each invariant a `<name>.invariant.spec.ts` test_file) — include it so
    // those structural tests actually execute in CI rather than being inert
    // files that only satisfy the brain's file-presence glob.
    include: ['tests/**/*.test.ts', 'tests/**/*.invariant.spec.ts'],
    // tests/e2e and tests/playwright are Playwright suites — keep vitest out
    // of them. tests/playwright is excluded explicitly so a future
    // *.invariant.spec.ts placed there cannot be picked up by the include
    // glob above and run under the wrong runner.
    exclude: ['tests/e2e/**', 'tests/playwright/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/templates/**'],
    },
  },
});
