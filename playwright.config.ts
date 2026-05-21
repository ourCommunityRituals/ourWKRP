import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Scope Playwright to the e2e + playwright dirs only — never the vitest *.test.ts files.
  testMatch: ['e2e/**/*.spec.ts', 'playwright/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npx wrangler dev --port 8787',
    url: 'http://localhost:8787/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
