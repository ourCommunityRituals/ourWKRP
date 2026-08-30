/**
 * E2E — the rate limiter actually fires (control liveness).
 *
 * WHY THIS EXISTS
 * `fixtures.ts` gives every test its own `CF-Connecting-IP` so specs stop
 * sharing one bucket. That isolation is necessary — but on its own it would
 * recreate the exact failure it was introduced to fix: if the limiter died
 * again, every test would still pass and nothing would notice. That is how the
 * control stayed dead through a green suite in the first place (OW-124: the KV
 * TTL fell below Cloudflare's 60s floor, every PUT was rejected, the counter
 * never persisted).
 *
 * So one test deliberately bursts a SINGLE identity past the bucket limit and
 * requires a 429. Isolation everywhere else, one place that proves the teeth
 * are real.
 *
 * This is the PR-time half of the OW-87 control-liveness tier. Its staging
 * complement is `scripts/smoke.mjs` against a deployed Worker — a local
 * `wrangler dev` proves the logic fires, not that the deployed binding does.
 */
import { test, expect } from './fixtures';

// src/lib/rate-limit.ts POLICIES — auth is the tightest bucket at 20/60s.
const AUTH_LIMIT = 20;

test.describe('Rate limiter — control liveness', () => {
  test('a burst from one identity is refused with 429 and Retry-After', async ({ request }) => {
    // Every request here carries this test's own CF-Connecting-IP (from the
    // fixture), so the burst lands in one bucket and cannot disturb any other
    // spec. `/auth/session/me` is a cheap GET on the auth bucket that needs no
    // session — an unauthenticated call is a 401, which still consumes quota.
    const statuses: number[] = [];
    for (let i = 0; i < AUTH_LIMIT + 5; i++) {
      const res = await request.get('/auth/session/me', { failOnStatusCode: false });
      statuses.push(res.status());
      if (res.status() === 429) {
        // The contract: a refusal tells the caller when to come back.
        expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0);
        break;
      }
    }

    expect(
      statuses,
      `expected a 429 within ${AUTH_LIMIT + 5} requests — if this fails the ` +
      `limiter is not accumulating (see OW-124: KV expirationTtl below the 60s floor)`,
    ).toContain(429);
  });

  test('an unrelated identity is unaffected by that burst', async ({ browser }) => {
    // Bucket isolation is per-identity, not global: one abusive client must not
    // lock everyone else out. Uses a fixed, distinct IP of its own.
    const ctx = await browser.newContext({
      extraHTTPHeaders: { 'CF-Connecting-IP': '10.255.255.254' },
    });
    try {
      const res = await ctx.request.get('/auth/session/me', { failOnStatusCode: false });
      expect(res.status()).not.toBe(429);
    } finally {
      await ctx.close();
    }
  });
});
