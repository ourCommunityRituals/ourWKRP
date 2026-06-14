/**
 * CORS — origin allowlist
 *
 * Only allows requests from known origins. Wildcard (*) is not safe
 * for an OAuth app that sets cookies / session tokens.
 */

import type { Env } from '../types';

/**
 * Build the set of allowed origins from environment. Single source of truth for
 * both CORS reflection and the mutation Origin/Referer check (see origin-check).
 */
export function buildAllowedOrigins(env: Env): Set<string> {
  const allowed = new Set<string>([
    env.APP_URL,                           // e.g. https://ourwkrp.com
    // security-gate: allow forbidden_url_scan -- wrangler dev origins, unreachable from prod
    'http://localhost:8787',               // wrangler dev
    // security-gate: allow forbidden_url_scan -- wrangler dev alt loopback, unreachable from prod
    'http://127.0.0.1:8787',              // wrangler dev alt
  ]);

  // Staging subdomain if configured
  if (env.WORKER_ENV === 'staging') {
    allowed.add('https://stg.ourwkrp.com');
  }

  return allowed;
}

/**
 * Returns allowed origin or null. Checks APP_URL and known dev origins.
 */
function getAllowedOrigin(requestOrigin: string | null, env: Env): string | null {
  if (!requestOrigin) return null;
  const allowed = buildAllowedOrigins(env);
  return allowed.has(requestOrigin) ? requestOrigin : null;
}

export function corsHeaders(requestOrigin: string | null, env: Env): Record<string, string> {
  const origin = getAllowedOrigin(requestOrigin, env);
  if (!origin) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function addCorsHeaders(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get('Origin');
  const headers = corsHeaders(origin, env);

  if (Object.keys(headers).length === 0) return response;

  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}
