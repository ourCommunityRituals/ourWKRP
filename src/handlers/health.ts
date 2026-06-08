/**
 * Health check handler
 * GET /health
 */

import type { Env } from '../types';

export async function handleHealth(_request: Request, env: Env): Promise<Response> {
  // Which rate-limiter backend is live. "kv" is the launch default (best-effort
  // fixed-window limiter); "durable" means the optional RateLimiterDO upgrade is
  // bound and bursts are capped atomically. Both are valid live controls — the
  // DO is a deferred enhancement (OW-78 CCR), not a requirement. Exposed so a
  // smoke test can observe the active backend.
  const rateLimiter = env.RATE_LIMITER ? 'durable' : 'kv';

  return Response.json({
    ok: true,
    service: 'ourwkrp',
    version: env.WORKER_VERSION,
    env: env.WORKER_ENV,
    rate_limiter: rateLimiter,
    timestamp: new Date().toISOString(),
  });
}
