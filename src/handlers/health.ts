/**
 * Health check handler
 * GET /health
 */

import type { Env } from '../types';

export async function handleHealth(_request: Request, env: Env): Promise<Response> {
  // Liveness of the atomic rate limiter. "durable" means the RateLimiterDO
  // binding is present and bursts are capped atomically; "degraded-kv" means a
  // misconfigured/unbound binding silently dropped us to the best-effort KV
  // path. Exposed so a deploy smoke test can fail loudly on the downgrade
  // instead of the weaker control passing unnoticed.
  const rateLimiter = env.RATE_LIMITER ? 'durable' : 'degraded-kv';

  return Response.json({
    ok: true,
    service: 'ourwkrp',
    version: env.WORKER_VERSION,
    env: env.WORKER_ENV,
    rate_limiter: rateLimiter,
    timestamp: new Date().toISOString(),
  });
}
