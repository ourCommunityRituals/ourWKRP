import { defineConfig, devices } from '@playwright/test';

// This is the WKRP repo, so the parameterized Tier-1 smoke (tests/e2e/smoke/
// tier1.spec.ts) targets the WKRP route manifest by default. The dedicated CI
// smoke step sets SMOKE_APP=wkrp explicitly; this makes the broader
// `npm run test:e2e` run (which doesn't) use the same app instead of falling
// back to the OSE manifest and 404-ing on OSE-only routes. Set SMOKE_APP=ose
// to opt into the OSE routes.
process.env.SMOKE_APP ||= 'wkrp';

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
    // Route-less local config: wrangler.toml's deploy route (stg.ourwkrp.com)
    // makes `wrangler dev` rewrite the request Origin to that host, which the
    // OW-81 CSRF allowlist rejects — breaking every browser mutation. See the
    // header of wrangler.e2e.toml for the full root cause.
    command: 'npx wrangler dev -c wrangler.e2e.toml --port 8787',
    url: 'http://localhost:8787/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
