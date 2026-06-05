/**
 * Unit tests — health endpoint rate-limiter liveness signal.
 *
 * The `rate_limiter` field is the externally-observable hedge against a silent
 * security downgrade: if the RATE_LIMITER Durable Object binding is missing,
 * the limiter falls back to best-effort KV. Health must surface that so a
 * deploy smoke test fails loudly instead of the weaker control passing quietly.
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

  it('reports "degraded-kv" when RATE_LIMITER is unbound', async () => {
    const env = { ...baseEnv, RATE_LIMITER: undefined } as unknown as Env;
    const body = await (await handleHealth(req(), env)).json() as { rate_limiter: string };
    expect(body.rate_limiter).toBe('degraded-kv');
  });
});
