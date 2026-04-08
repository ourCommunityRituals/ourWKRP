/**
 * Last.fm handlers
 *
 * GET  /auth/lastfm/start       — redirect to Last.fm auth page
 * GET  /auth/lastfm/callback    — exchange token for permanent session key
 * POST /lastfm/sync/:userId     — sync scrobble history + tags into D1
 * GET  /lastfm/status/:userId   — check Last.fm connection status
 *
 * Multi-user: each contributor connects their own Last.fm account.
 * Session keys are permanent — connect once, sync anytime.
 */

import type { Env } from '../types';
import { getAuthUrl, getSession as getLastfmApiSession } from '../lastfm/client';
import { syncLastfmUser } from '../lastfm/sync-engine';
import { getSession, storeLastfmSession, getLastfmSession, getLastSync } from '../lib/kv-storage';
import { getSessionToken } from '../lib/session-cookie';
import { log, logError } from '../lib/logger';

/**
 * GET /auth/lastfm/start
 *
 * Requires existing session (user must be a contributor first).
 * Redirects to Last.fm auth page.
 */
export async function handleLastfmAuthStart(request: Request, env: Env): Promise<Response> {
  const token = getSessionToken(request);
  if (!token) {
    return Response.json({ ok: false, error: 'Login required — connect as a contributor first' }, { status: 401 });
  }

  const session = await getSession(env.WKRP_KV, token);
  if (!session) {
    return Response.json({ ok: false, error: 'Session expired' }, { status: 401 });
  }

  const callbackUrl = `${env.APP_URL}/auth/lastfm/callback`;
  const authUrl = getAuthUrl(env.LASTFM_API_KEY, callbackUrl);

  log('LASTFM_AUTH_START', { userId: session.userId, callback: callbackUrl });

  return Response.redirect(authUrl, 302);
}

/**
 * GET /auth/lastfm/callback?token=TOKEN
 *
 * Last.fm redirects here after user approves.
 * Exchanges one-time token for permanent session key.
 */
export async function handleLastfmAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const lastfmToken = url.searchParams.get('token');

  if (!lastfmToken) {
    return Response.redirect(`${env.APP_URL}/catalog?error=lastfm_denied`, 302);
  }

  // Get the contributor's session
  const sessionToken = getSessionToken(request);
  if (!sessionToken) {
    return Response.redirect(`${env.APP_URL}/?error=session_expired`, 302);
  }

  const session = await getSession(env.WKRP_KV, sessionToken);
  if (!session) {
    return Response.redirect(`${env.APP_URL}/?error=session_expired`, 302);
  }

  try {
    // Exchange token for permanent session key
    const lastfmSession = await getLastfmApiSession(
      lastfmToken,
      env.LASTFM_API_KEY,
      env.LASTFM_SHARED_SECRET,
    );

    // Store session key in KV (permanent — no TTL)
    await storeLastfmSession(env.WKRP_KV, session.userId, {
      username: lastfmSession.name,
      session_key: lastfmSession.key,
    });

    // Update contributor's Last.fm username in D1
    await env.WKRP_DB.prepare(
      'UPDATE contributors SET lastfm_username = ? WHERE id = ?'
    ).bind(lastfmSession.name, session.userId).run();

    log('LASTFM_AUTH_COMPLETE', {
      userId: session.userId,
      lastfm_username: lastfmSession.name,
    });

    return Response.redirect(`${env.APP_URL}/catalog?lastfm=connected`, 302);
  } catch (error) {
    logError('LASTFM_AUTH_FAILED', error, { userId: session.userId });
    return Response.redirect(`${env.APP_URL}/catalog?error=lastfm_auth_failed`, 302);
  }
}

/**
 * POST /lastfm/sync/:userId
 *
 * Triggers a sync of the contributor's Last.fm scrobble history.
 * Requires: contributor has a connected Last.fm account.
 * Rate limited: 5 min cooldown between syncs.
 */
export async function handleLastfmSync(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.pathname.split('/lastfm/sync/')[1];

  if (!userId) {
    return Response.json({ ok: false, error: 'Missing user ID' }, { status: 400 });
  }

  // Authenticate
  const sessionToken = getSessionToken(request);
  if (!sessionToken) {
    return Response.json({ ok: false, error: 'Authentication required' }, { status: 401 });
  }

  const session = await getSession(env.WKRP_KV, sessionToken);
  if (!session) {
    return Response.json({ ok: false, error: 'Session expired' }, { status: 401 });
  }

  // Verify user owns this account
  if (session.userId !== userId) {
    return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  // Check rate limit (5 min cooldown)
  const lastSync = await getLastSync(env.WKRP_KV, `lastfm:${userId}`);
  if (lastSync) {
    const elapsed = Date.now() - new Date(lastSync).getTime();
    const cooldown = 5 * 60 * 1000;
    if (elapsed < cooldown) {
      const retryAfter = Math.ceil((cooldown - elapsed) / 1000);
      return Response.json(
        { ok: false, error: 'Sync rate limited', retry_after: retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }
  }

  // Get Last.fm session key
  const lastfmSession = await getLastfmSession(env.WKRP_KV, userId);
  if (!lastfmSession) {
    return Response.json(
      { ok: false, error: 'Last.fm not connected — visit /auth/lastfm/start first' },
      { status: 400 },
    );
  }

  try {
    const result = await syncLastfmUser(
      env,
      userId,
      lastfmSession.username,
      env.LASTFM_API_KEY,
    );

    return Response.json({ ok: true, sync: result });
  } catch (error) {
    logError('LASTFM_SYNC_ERROR', error, { userId, username: lastfmSession.username });
    return Response.json(
      { ok: false, error: 'Sync failed — try again later' },
      { status: 500 },
    );
  }
}

/**
 * GET /lastfm/status/:userId
 *
 * Check if a contributor has Last.fm connected, and when they last synced.
 */
export async function handleLastfmStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.pathname.split('/lastfm/status/')[1];

  if (!userId) {
    return Response.json({ ok: false, error: 'Missing user ID' }, { status: 400 });
  }

  const lastfmSession = await getLastfmSession(env.WKRP_KV, userId);
  const lastSync = await getLastSync(env.WKRP_KV, `lastfm:${userId}`);

  return Response.json({
    ok: true,
    lastfm: {
      connected: lastfmSession !== null,
      username: lastfmSession?.username ?? null,
      last_sync: lastSync,
    },
  });
}
