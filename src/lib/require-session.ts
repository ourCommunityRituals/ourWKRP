/**
 * Shared session authentication helper.
 *
 * Extracts session token from HttpOnly cookie, validates against KV.
 * Returns session data or a 401 Response.
 */

import type { Env, SessionData } from '../types';
import { getSession } from './kv-storage';
import { getSessionToken } from './session-cookie';

export async function requireSession(
  request: Request,
  env: Env,
): Promise<SessionData | Response> {
  const token = getSessionToken(request);
  if (!token) {
    return Response.json(
      { ok: false, error: 'Authentication required' },
      { status: 401 },
    );
  }

  const session = await getSession(env.WKRP_KV, token);
  if (!session) {
    return Response.json(
      { ok: false, error: 'Session expired' },
      { status: 401 },
    );
  }

  return session;
}
