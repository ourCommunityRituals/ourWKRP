/**
 * E2E fixtures — per-test rate-limit identity.
 *
 * WHY THIS EXISTS
 * `src/lib/rate-limit.ts` keys its buckets on the `CF-Connecting-IP` header.
 * Nothing sets that header against a local `wrangler dev`, so every request
 * from every spec collapsed into ONE bucket — and `auth` allows 20 per 60s.
 * A suite that registers dozens of contributors therefore trips the limiter
 * partway through and the rest of the run dies on "Too many requests".
 *
 * That never surfaced before because the limiter was silently dead: it wrote a
 * KV TTL below Cloudflare's 60s floor, every PUT was rejected, and the counter
 * never persisted (OW-124). Fixing the limiter exposed the suite's hidden
 * dependency on it being broken.
 *
 * THE CHOICE MADE HERE
 * Give each test its own client identity rather than relaxing the control under
 * test. The limiter stays LIVE at production settings (20/60s) — a control that
 * is disabled in the test environment is exactly the dormant-control gap the
 * invariant work exists to close. Tests get isolation; the control keeps its
 * teeth. `rate-limit.spec.ts` deliberately bursts a single identity to prove
 * 429 still fires.
 *
 * USAGE — import `test` and `expect` from here instead of '@playwright/test':
 *   import { test, expect } from './fixtures';
 *
 * For a manually-created context, spread `rateLimitHeaders(testInfo)` into
 * `browser.newContext({ extraHTTPHeaders: ... })` — a context built by hand
 * does not inherit the fixture's option override.
 */
import { test as base, expect, type TestInfo } from '@playwright/test';

/**
 * A deterministic, per-test synthetic client IP.
 *
 * Derived from the test id so it is stable across retries (a retry is the same
 * logical client) and distinct across tests and workers. The 10.0.0.0/8 block
 * is private and never routable — this is a header value for a local worker,
 * not a real network address.
 */
export function rateLimitIp(testInfo: TestInfo): string {
  let hash = 2166136261;
  for (const ch of testInfo.testId) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const a = (hash >>> 16) & 0xff;
  const b = (hash >>> 8) & 0xff;
  const c = hash & 0xff;
  // Worker index in the second octet keeps parallel workers from colliding
  // even in the unlikely event two test ids hash alike.
  return `10.${testInfo.workerIndex & 0xff}.${a}.${(b ^ c) & 0xff}`;
}

export function rateLimitHeaders(testInfo: TestInfo): Record<string, string> {
  return { 'CF-Connecting-IP': rateLimitIp(testInfo) };
}

export const test = base.extend({
  // Overriding the built-in `extraHTTPHeaders` option applies to both the
  // browser context (page navigations) and the `request` fixture (API calls),
  // so a spec gets one identity across everything it does.
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, testInfo) => {
    await use({ ...(extraHTTPHeaders ?? {}), ...rateLimitHeaders(testInfo) });
  },
});

export { expect };
