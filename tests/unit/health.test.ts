/**
 * Unit tests — health endpoint rate-limiter liveness signal.
 *
 * The `rate_limiter` field reports which backend is live so a deploy smoke test
 * can observe it. "kv" is the launch default (best-effort fixed-window limiter,
 * always live); "durable" means the optional RateLimiterDO upgrade is bound and
 * bursts are capped atomically. Both are valid live controls — the DO is a
 * deferred enhancement (OW-78 CCR), not a requirement.
 */
import { describe, it, expect } from 'vitest';
import { handleHealth } from '../../src/handlers/health';
import type { Env } from '../../src/types';

const baseEnv = { WORKER_VERSION: '0.1.0', WORKER_ENV: 'staging' } as unknown as Env;
const req = () => new Request('https://ourwkrp.com/health');

describe('health rate-limiter liveness', () => {
  it('reports "durable" when RATE_LIMITER is bound', async () => {
    const env = { ...baseEnv, RATE_LIMITER: {} } as unknown as Env;
    const body = await (await handleHealth(req(), env)).json() as { rate_limiter: string; ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.rate_limiter).toBe('durable');
  });

  it('reports "kv" (the live launch backend) when RATE_LIMITER is unbound', async () => {
    const env = { ...baseEnv, RATE_LIMITER: undefined } as unknown as Env;
    const body = await (await handleHealth(req(), env)).json() as { rate_limiter: string };
    expect(body.rate_limiter).toBe('kv');
  });
});
