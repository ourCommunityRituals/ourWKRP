import { describe, it, expect, vi } from 'vitest';
import { RateLimiterDO } from '../../src/lib/rate-limiter-do';
import { enforceRateLimit } from '../../src/lib/rate-limit';
import type { Env } from '../../src/types';

vi.mock('../../src/lib/logger', () => ({ log: vi.fn(), logError: vi.fn() }));

/** In-memory DurableObjectState stand-in. */
function createState() {
  const map = new Map<string, unknown>();
  return {
    storage: {
      get: async (k: string) => map.get(k),
      put: async (k: string, v: unknown) => { map.set(k, v); },
      delete: async (k: string) => { map.delete(k); },
      setAlarm: async () => {},
    },
  } as unknown as DurableObjectState;
}

/**
 * Mock DO namespace that emulates the one guarantee we depend on: a single
 * instance per id, with fetches serialized (a real DO single-threads requests
 * to one object). Without that serialization the counter would race exactly
 * like KV — so this models the property under test.
 */
function createRateLimiterNs(): DurableObjectNamespace {
  const instances = new Map<string, { fetch: (url: string, init: RequestInit) => Promise<Response> }>();
  function instanceFor(name: string) {
    let inst = instances.get(name);
    if (!inst) {
      const di = new RateLimiterDO(createState());
      let chain: Promise<unknown> = Promise.resolve();
      const fetch = (url: string, init: RequestInit) => {
        const run = chain.then(() => di.fetch(new Request(url, init)));
        chain = run.then(() => undefined, () => undefined);
        return run;
      };
      inst = { fetch };
      instances.set(name, inst);
    }
    return inst;
  }
  return {
    idFromName: (name: string) => name,
    get: (id: string) => instanceFor(id),
  } as unknown as DurableObjectNamespace;
}

const brokenKv = { get: vi.fn(async () => { throw new Error('kv must not be used'); }) } as unknown as KVNamespace;

function env(ns: DurableObjectNamespace): Env {
  // KV throws — proves the hot buckets use the DO, not KV, when bound.
  return { RATE_LIMITER: ns, WKRP_KV: brokenKv } as unknown as Env;
}

function req(ip = '1.2.3.4'): Request {
  return new Request('http://localhost/import/x', { headers: { 'CF-Connecting-IP': ip } });
}

describe('RateLimiterDO (unit)', () => {
  it('allows up to the limit, then blocks with a positive Retry-After', async () => {
    const di = new RateLimiterDO(createState());
    const call = () => di.fetch(new Request('https://rl/consume', {
      method: 'POST',
      body: JSON.stringify({ limit: 3, windowMs: 60_000 }),
    }));

    for (let i = 0; i < 3; i++) {
      const r = await (await call()).json() as { allowed: boolean };
      expect(r.allowed).toBe(true);
    }
    const blocked = await (await call()).json() as { allowed: boolean; retryAfterSec: number };
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});

describe('enforceRateLimit via Durable Object', () => {
  it('routes hot buckets to the DO (not KV) and blocks past the limit', async () => {
    const e = env(createRateLimiterNs());
    // import bucket limit is 10/60s
    for (let i = 0; i < 10; i++) {
      expect(await enforceRateLimit(req(), e, 'POST', '/import/abc')).toBeNull();
    }
    const blocked = await enforceRateLimit(req(), e, 'POST', '/import/abc');
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(Number(blocked!.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('does not overcount under a concurrent burst (atomicity)', async () => {
    const e = env(createRateLimiterNs());
    // Fire 30 requests in parallel for the same identity; limit is 10.
    const results = await Promise.all(
      Array.from({ length: 30 }, () => enforceRateLimit(req('9.9.9.9'), e, 'POST', '/import/a')),
    );
    const allowed = results.filter((r) => r === null).length;
    const blocked = results.filter((r) => r !== null).length;
    expect(allowed).toBe(10);
    expect(blocked).toBe(20);
  });

  it('isolates counters per client IP', async () => {
    const e = env(createRateLimiterNs());
    for (let i = 0; i < 10; i++) await enforceRateLimit(req('1.1.1.1'), e, 'POST', '/import/a');
    expect(await enforceRateLimit(req('2.2.2.2'), e, 'POST', '/import/a')).toBeNull();
  });
});
