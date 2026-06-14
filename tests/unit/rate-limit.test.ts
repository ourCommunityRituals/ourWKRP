import { describe, it, expect, vi } from 'vitest';
import { bucketFor, enforceRateLimit } from '../../src/lib/rate-limit';
import type { Env } from '../../src/types';

vi.mock('../../src/lib/logger', () => ({ log: vi.fn(), logError: vi.fn() }));

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
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
