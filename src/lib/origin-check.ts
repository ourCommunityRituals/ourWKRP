/**
 * CSRF defense-in-depth for state-changing requests.
 *
 * SameSite=Lax on the session cookie is the primary control: browsers won't
 * send the cookie on cross-site POST/DELETE. This adds a second layer by
 * rejecting mutations whose Origin (or Referer, as fallback) is present but not
 * allowlisted. Requests with neither header — non-browser clients like curl or
 * server-to-server callers that never carry a cookie cross-site — are allowed;
 * the cookie's SameSite attribute still gates browser-driven CSRF.
 */

import type { Env } from '../types';
import { buildAllowedOrigins } from './cors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isAllowedMutation(request: Request, env: Env, method: string): boolean {
  if (!MUTATING.has(method)) return true;

  const allowed = buildAllowedOrigins(env);

  const origin = request.headers.get('Origin');
  if (origin) return allowed.has(origin);

  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false; // malformed Referer on a mutation — reject
    }
  }

  return true;
}
