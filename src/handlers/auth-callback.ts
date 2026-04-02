/**
 * GET /auth/callback?code=AQB...&state=xyz
 *
 * Spotify redirects here after user approves. This handler:
 * 1. Validates state matches KV (CSRF protection)
 * 2. Exchanges auth code for access + refresh tokens
 * 3. Fetches Spotify user profile
 * 4. Upserts contributor in D1
 * 5. Creates session token
 * 6. Redirects to app with session
 */

import type { Env, SpotifyUserProfile, StoredTokens } from '../types';
import { exchangeCodeForTokens } from '../auth/spotify-oauth';
import { getAuthState, deleteAuthState, storeSession, storeTokens } from '../lib/kv-storage';
import { log, logError } from '../lib/logger';

export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Validate APP_URL is a safe redirect target (prevent open redirect)
  const appUrl = validateRedirectTarget(env.APP_URL);
  if (!appUrl) {
    logError('AUTH_CALLBACK_UNSAFE_REDIRECT', new Error(`Unsafe APP_URL: ${env.APP_URL}`));
    return Response.json({ ok: false, error: 'Server misconfiguration' }, { status: 500 });
  }

  // Spotify denied or user cancelled
  if (error) {
    log('AUTH_CALLBACK_DENIED', { error });
    return Response.redirect(`${appUrl}/?error=spotify_denied`, 302);
  }

  if (!code || !state) {
    log('AUTH_CALLBACK_INVALID', { has_code: !!code, has_state: !!state });
    return Response.redirect(`${appUrl}/?error=invalid_callback`, 302);
  }

  // Retrieve and validate auth state from KV
  const authState = await getAuthState(env.WKRP_KV, state);
  if (!authState) {
    log('AUTH_CALLBACK_STATE_MISS', { state: state.substring(0, 8) + '...' });
    return Response.redirect(`${appUrl}/?error=invalid_state`, 302);
  }

  // Clean up used state
  await deleteAuthState(env.WKRP_KV, state);

  try {
    // Exchange code for tokens
    const tokenResponse = await exchangeCodeForTokens(
      code,
      env.SPOTIFY_CLIENT_ID,
      env.SPOTIFY_REDIRECT_URI,
      authState.code_verifier,
    );

    // Fetch Spotify user profile
    const profile = await fetchSpotifyProfile(tokenResponse.access_token);
    log('AUTH_CALLBACK_PROFILE', {
      spotify_id: profile.id,
      display_name: profile.display_name,
    });

    // Generate contributor ID and session token
    const contributorId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();

    // Upsert contributor in D1
    await env.WKRP_DB.prepare(`
      INSERT INTO contributors (id, name, generation, brand_id, spotify_user_id, spotify_display_name, created_at)
      VALUES (?, ?, ?, 'wkrp', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        spotify_user_id = excluded.spotify_user_id,
        spotify_display_name = excluded.spotify_display_name
    `).bind(
      contributorId,
      authState.name,
      authState.gen,
      profile.id,
      profile.display_name ?? authState.name,
      new Date().toISOString(),
    ).run();

    log('AUTH_CALLBACK_CONTRIBUTOR_CREATED', { contributorId, name: authState.name });

    // Store tokens in KV
    const storedTokens: StoredTokens = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token ?? '',
      expires_at: Date.now() + (tokenResponse.expires_in * 1000),
    };
    await storeTokens(env.WKRP_KV, contributorId, storedTokens);

    // Create session
    await storeSession(env.WKRP_KV, sessionToken, {
      userId: contributorId,
      name: authState.name,
      gen: authState.gen,
      brand_id: 'wkrp',
    });

    log('AUTH_CALLBACK_SUCCESS', { contributorId, name: authState.name, gen: authState.gen });

    // Redirect to app with session
    return Response.redirect(`${appUrl}/?session=${sessionToken}`, 302);

  } catch (err) {
    logError('AUTH_CALLBACK_ERROR', err);
    return Response.redirect(`${appUrl}/?error=auth_failed`, 302);
  }
}

/** Validate redirect target is an allowed domain — prevents open redirect */
const ALLOWED_REDIRECT_HOSTS = new Set([
  'ourwkrp.com',
  'www.ourwkrp.com',
  'stg.ourwkrp.com',
  'localhost',
  '127.0.0.1',
]);

function validateRedirectTarget(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    if (!ALLOWED_REDIRECT_HOSTS.has(url.hostname)) return null;
    // Only allow http for localhost, https for everything else
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function fetchSpotifyProfile(accessToken: string): Promise<SpotifyUserProfile> {
  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Spotify profile fetch failed: ${response.status} — ${body}`);
  }

  return await response.json() as SpotifyUserProfile;
}
