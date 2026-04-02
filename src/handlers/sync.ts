/**
 * POST /spotify/sync/:userId
 *
 * Triggers a full sync for a contributor:
 * playlists → tracks → audio features → D1
 *
 * Requires valid session. Returns sync results.
 */

import type { Env } from '../types';
import { getValidAccessToken } from '../auth/token-refresh';
import { syncContributor } from '../spotify/sync-engine';
import { log, logError } from '../lib/logger';

export async function handleSync(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.pathname.split('/spotify/sync/')[1];

  if (!userId || userId.length < 10) {
    return Response.json(
      { ok: false, error: 'Invalid user ID' },
      { status: 400 },
    );
  }

  // Verify contributor exists
  const contributor = await env.WKRP_DB.prepare(
    'SELECT id, name FROM contributors WHERE id = ?'
  ).bind(userId).first();

  if (!contributor) {
    log('SYNC_USER_NOT_FOUND', { userId });
    return Response.json(
      { ok: false, error: 'Contributor not found' },
      { status: 404 },
    );
  }

  // Get valid access token (auto-refreshes if needed)
  const accessToken = await getValidAccessToken(env, userId);
  if (!accessToken) {
    log('SYNC_NO_TOKEN', { userId });
    return Response.json(
      { ok: false, error: 'Spotify authentication expired. Please reconnect.' },
      { status: 401 },
    );
  }

  try {
    const result = await syncContributor(env, userId, accessToken);

    log('SYNC_RESPONSE', { userId, name: contributor.name, ...result });

    return Response.json({
      ok: true,
      message: `${contributor.name} synced successfully`,
      sync: result,
    });
  } catch (err) {
    logError('SYNC_ERROR', err, { userId });
    return Response.json(
      { ok: false, error: 'Sync failed. Check logs for details.' },
      { status: 500 },
    );
  }
}
