/**
 * POST /auth/logout
 *
 * Clears the session cookie and deletes the session from KV.
 * Idempotent — returns 200 even if no session exists.
 */

import type { Env } from '../types';
import { deleteSession } from '../lib/kv-storage';
import { getSessionToken } from '../lib/session-cookie';
import { buildClearSessionCookie } from '../lib/session-cookie';
import { log } from '../lib/logger';

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = getSessionToken(request);

  if (token) {
    await deleteSession(env.WKRP_KV, token);
    log('LOGOUT', { token: token.substring(0, 8) + '...' });
  }

  return new Response(
    JSON.stringify({ ok: true }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildClearSessionCookie(),
      },
    },
  );
}
