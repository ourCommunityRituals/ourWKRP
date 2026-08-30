import { describe, it, expect, vi } from 'vitest';
import { bucketFor, enforceRateLimit } from '../../src/lib/rate-limit';
import type { Env } from '../../src/types';

vi.mock('../../src/lib/logger', () => ({ log: vi.fn(), logError: vi.fn() }));

/**
 * Cloudflare KV rejects `expirationTtl` below 60 seconds with a 400.
 *
 * The previous mock accepted any options object, which is how a real defect
 * survived a green unit suite: enforceRateLimit computed a shrinking
 * remaining-window TTL, so every PUT after the first request in a window was
 * rejected by real KV, the counter never persisted, and the limiter silently
 * allowed unlimited requests. The logic was correct; the mock was simply more
 * permissive than the platform.
 *
 * The mock now models the constraint. A mock that cannot fail the way
 * production fails is not a test double, it is a rubber stamp.
 */
const KV_MIN_TTL_SEC = 60;

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string, opts?: { expirationTtl?: number }) => {
      if (opts?.expirationTtl !== undefined && opts.expirationTtl < KV_MIN_TTL_SEC) {
        throw new Error(
          `KV PUT failed: 400 Invalid expiration_ttl of ${opts.expirationTtl}. ` +
          `Expiration TTL must be at least ${KV_MIN_TTL_SEC}.`,
        );
      }
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  } as unknown as KVNamespace;
}

function envWith(kv: KVNamespace): Env {
  return { WKRP_KV: kv } as unknown as Env;
}

function req(ip = '1.2.3.4'): Request {
  return new Request('http://localhost/import/x', { headers: { 'CF-Connecting-IP': ip } });
}

describe('bucketFor', () => {
  it('classifies routes', () => {
    expect(bucketFor('POST', '/import/abc')).toBe('import');
    expect(bucketFor('GET', '/auth/start')).toBe('auth');
    expect(bucketFor('GET', '/api/tracks')).toBe('api');
    expect(bucketFor('GET', '/lastfm/status/x')).toBe('api');
    expect(bucketFor('GET', '/')).toBeNull();
    expect(bucketFor('GET', '/catalog')).toBeNull();
  });
});

describe('enforceRateLimit', () => {
  it('allows requests under the limit then blocks with 429 + Retry-After', async () => {
    const env = envWith(createMockKV());
    // import bucket limit is 10/60s
    for (let i = 0; i < 10; i++) {
      const r = await enforceRateLimit(req(), env, 'POST', '/import/abc');
      expect(r).toBeNull();
    }
    const blocked = await enforceRateLimit(req(), env, 'POST', '/import/abc');
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(Number(blocked!.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('isolates buckets per client IP', async () => {
    const env = envWith(createMockKV());
    for (let i = 0; i < 10; i++) await enforceRateLimit(req('1.1.1.1'), env, 'POST', '/import/a');
    // A different IP is unaffected
    const other = await enforceRateLimit(req('2.2.2.2'), env, 'POST', '/import/a');
    expect(other).toBeNull();
  });

  it('does not throttle unbucketed routes', async () => {
    const env = envWith(createMockKV());
    for (let i = 0; i < 50; i++) {
      expect(await enforceRateLimit(req(), env, 'GET', '/')).toBeNull();
    }
  });

  it('fails open when KV throws', async () => {
    const brokenKv = { get: vi.fn(async () => { throw new Error('kv down'); }) } as unknown as KVNamespace;
    const r = await enforceRateLimit(req(), envWith(brokenKv), 'POST', '/import/abc');
    expect(r).toBeNull();
  });
});

describe('enforceRateLimit | KV expirationTtl contract (regression)', () => {
  it('never writes a TTL below the KV minimum, mid-window', async () => {
    // TIME MUST ADVANCE for this to reproduce. Two calls in the same
    // millisecond both compute a full 60s remaining window and round to exactly
    // 60, so the bug hides. It only appears once the window has started
    // elapsing — which is every real request after the first.
    vi.useFakeTimers();
    try {
      const kv = createMockKV();
      const env = envWith(kv);

      await enforceRateLimit(req(), env, 'POST', '/import/abc');
      vi.advanceTimersByTime(1500); // 58.5s left in a 60s window → old code sent 59
      await enforceRateLimit(req(), env, 'POST', '/import/abc');

      const puts = (kv.put as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(puts.length).toBeGreaterThanOrEqual(2);
      for (const call of puts) {
        const opts = call[2] as { expirationTtl?: number } | undefined;
        expect(opts?.expirationTtl).toBeGreaterThanOrEqual(60);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('still counts after the window has started elapsing', async () => {
    // The user-visible consequence: with a strict KV and elapsed time, every
    // PUT after the first was rejected, so the counter never accumulated and
    // the limiter never tripped.
    vi.useFakeTimers();
    try {
      const env = envWith(createMockKV());
      for (let i = 0; i < 10; i++) {
        expect(await enforceRateLimit(req(), env, 'POST', '/import/abc')).toBeNull();
        vi.advanceTimersByTime(1000);
      }
      const blocked = await enforceRateLimit(req(), env, 'POST', '/import/abc');
      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still counts across requests when KV enforces its real TTL floor', async () => {
    // The user-visible consequence of the bug: with a strict KV, the counter
    // never persisted, so the limiter never tripped. It must still trip.
    const env = envWith(createMockKV());
    for (let i = 0; i < 10; i++) {
      expect(await enforceRateLimit(req(), env, 'POST', '/import/abc')).toBeNull();
    }
    const blocked = await enforceRateLimit(req(), env, 'POST', '/import/abc');
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });
});
