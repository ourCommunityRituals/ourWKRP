/**
 * ourWKRP — Cloudflare Worker entry point
 *
 * Deploy staging:    npm run deploy:staging
 * Deploy production: npm run deploy:prod
 * Local dev:         npm run dev
 */

import { route } from './router';
import type { Env } from './types';

export type { Env };

// Durable Object class must be exported from the entry module so the runtime
// can instantiate it for the RATE_LIMITER binding.
export { RateLimiterDO } from './lib/rate-limiter-do';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({
        type: 'UNHANDLED_ERROR',
        error,
        url: request.url,
        method: request.method,
        timestamp: new Date().toISOString(),
      }));

      return Response.json(
        { ok: false, status: 500, error: 'Internal server error' },
        { status: 500 },
      );
    }
  },
};
