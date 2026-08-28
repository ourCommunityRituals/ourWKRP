/**
 * POST /spotify/sync/:userId
 *
 * Triggers a full sync for a contributor:
 * playlists → tracks → audio features → D1
 *
 * Requires valid session cookie. Verifies caller matches userId.
 * Rate limited: 1 sync per 5 minutes per contributor.
 */

import type { Env } from '../types';
import { getValidAccessToken } from '../auth/token-refresh';
import { syncContributor } from '../spotify/sync-engine';
import { getSession, getLastSync } from '../lib/kv-storage';
import { log, logError } from '../lib/logger';
import { getSessionToken } from '../lib/session-cookie';

const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export async function handleSync(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.pathname.split('/spotify/sync/')[1];

  if (!userId || userId.length < 10) {
    return Response.json(
      { ok: false, error: 'Invalid user ID' },
      { status: 400 },
    );
  }

  // --- Session authentication ---
  const sessionToken = getSessionToken(request);
  if (!sessionToken) {
    log('SYNC_NO_SESSION', { userId });
    return Response.json(
      { ok: false, error: 'Authentication required' },
      { status: 401 },
    );
  }

  const session = await getSession(env.WKRP_KV, sessionToken);
  if (!session) {
    log('SYNC_INVALID_SESSION', { userId });
    return Response.json(
      { ok: false, error: 'Session expired. Please reconnect.' },
      { status: 401 },
    );
  }

  // Verify caller owns this userId
  if (session.userId !== userId) {
    log('SYNC_USER_MISMATCH', { sessionUser: session.userId, requestedUser: userId });
    return Response.json(
      { ok: false, error: 'Not authorized to sync this account' },
      { status: 403 },
    );
  }

  // --- Rate limiting ---
  const lastSync = await getLastSync(env.WKRP_KV, userId);
  if (lastSync) {
    const elapsed = Date.now() - new Date(lastSync).getTime();
    if (elapsed < SYNC_COOLDOWN_MS) {
      const retryAfter = Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 1000);
      log('SYNC_RATE_LIMITED', { userId, retry_after: retryAfter });
      return Response.json(
        { ok: false, error: `Sync rate limited. Try again in ${retryAfter} seconds.` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }
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

    // ok stays true — playlists and tracks did persist. The audio-features
    // stage reports its own outcome so the user is never told that a stage
    // that returned nothing "synced successfully".
    const featuresStatus = result.audio_features_status;
    const message =
      featuresStatus === 'unavailable'
        ? `${contributor.name}'s library synced. Audio features unavailable for this Spotify app.`
        : featuresStatus === 'partial'
          ? `${contributor.name}'s library synced. Some audio features could not be fetched.`
          : `${contributor.name} synced successfully`;

    return Response.json({
      ok: true,
      message,
      audio_features_status: featuresStatus,
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
