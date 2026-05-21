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
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/templates/**'],
    },
  },
});
