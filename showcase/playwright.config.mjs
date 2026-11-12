import { defineConfig } from '@playwright/test';

// The creator showcase end-to-end layer: the built fixture page at phone,
// tablet and laptop widths, in both themes. Run from the repo root:
//   npx playwright test --config showcase/playwright.config.mjs
const PORT = Number(process.env.SHOWCASE_E2E_PORT ?? 4317);
const widths = [
  ['phone', 375, 812],
  ['tablet', 768, 1024],
  ['laptop', 1280, 860],
];

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  outputDir: './test-results',
  globalSetup: './tests/e2e/global-setup.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', trace: 'retain-on-failure' },
  projects: widths.flatMap(([name, width, height]) =>
    ['dark', 'light'].map((colorScheme) => ({
      name: `${name}-${colorScheme}`,
      use: { viewport: { width, height }, colorScheme, isMobile: name === 'phone', hasTouch: name === 'phone' },
    })),
  ),
  webServer: {
    command: `node tests/e2e/serve.mjs .e2e/site ${PORT}`,
    url: `http://127.0.0.1:${PORT}/__health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
