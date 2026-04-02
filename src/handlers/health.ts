/**
 * Health check handler
 * GET /health
 */

import type { Env } from '../types';

export async function handleHealth(_request: Request, env: Env): Promise<Response> {
  return Response.json({
    ok: true,
    service: 'ourwkrp',
    version: env.WORKER_VERSION,
    env: env.WORKER_ENV,
    timestamp: new Date().toISOString(),
  });
}
