/**
 * GET /auth/session/:token
 *
 * Frontend calls this on load to get contributor profile.
 * Returns contributor data if session is valid, 401 otherwise.
 */

import type { Env } from '../types';
import { getSession } from '../lib/kv-storage';
import { log } from '../lib/logger';

export async function handleAuthSession(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.pathname.split('/auth/session/')[1];

  if (!token || token.length < 10) {
    return Response.json(
      { ok: false, error: 'Invalid session token' },
      { status: 400 },
    );
  }

  const session = await getSession(env.WKRP_KV, token);
  if (!session) {
    log('SESSION_INVALID', { token: token.substring(0, 8) + '...' });
    return Response.json(
      { ok: false, error: 'Session not found or expired' },
      { status: 401 },
    );
  }

  // Fetch contributor details from D1
  const contributor = await env.WKRP_DB.prepare(
    'SELECT id, name, generation, brand_id, spotify_display_name, last_sync_at FROM contributors WHERE id = ?'
  ).bind(session.userId).first();

  if (!contributor) {
    log('SESSION_NO_CONTRIBUTOR', { userId: session.userId });
    return Response.json(
      { ok: false, error: 'Contributor not found' },
      { status: 404 },
    );
  }

  log('SESSION_VALID', { userId: session.userId, name: session.name });

  return Response.json({
    ok: true,
    contributor: {
      id: contributor.id,
      name: contributor.name,
      generation: contributor.generation,
      brand_id: contributor.brand_id,
      spotify_display_name: contributor.spotify_display_name,
      last_sync_at: contributor.last_sync_at,
    },
  });
}
