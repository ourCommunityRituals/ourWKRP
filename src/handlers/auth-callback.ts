/**
 * GET /auth/callback?code=AQB...&state=xyz
 *
 * Spotify redirects here after user approves. This handler:
 * 1. Validates state matches KV (CSRF protection)
 * 2. Exchanges auth code for access + refresh tokens
 * 3. Fetches Spotify user profile
 * 4. Upserts contributor by spotify_user_id (returning users merge)
 * 5. Creates session token in HttpOnly cookie
 * 6. Redirects to app (clean URL, no token in query string)
 */

import type { Env, SpotifyUserProfile, StoredTokens } from '../types';
import { exchangeCodeForTokens } from '../auth/spotify-oauth';
import { getAuthState, deleteAuthState, storeSession, storeTokens } from '../lib/kv-storage';
import { newSessionData } from '../lib/session';
import { buildSessionCookie } from '../lib/session-cookie';
import { recordAudit } from '../lib/audit';
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

  const isProduction = env.WORKER_ENV === 'production';

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

  // Clean up used state (single-use — prevents replay)
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

    // Upsert contributor by spotify_user_id — returning users merge, not duplicate
    const contributorId = await upsertContributor(env, profile, authState.name, authState.gen, authState.role);

    log('AUTH_CALLBACK_CONTRIBUTOR_UPSERTED', { contributorId, name: authState.name });

    // Store tokens in KV (keyed by our contributor ID)
    const storedTokens: StoredTokens = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token ?? '',
      expires_at: Date.now() + (tokenResponse.expires_in * 1000),
    };
    await storeTokens(env.WKRP_KV, contributorId, storedTokens);

    // Create session — stored in KV, delivered via HttpOnly cookie
    const sessionToken = crypto.randomUUID();
    await storeSession(env.WKRP_KV, sessionToken, newSessionData({
      userId: contributorId,
      name: authState.name,
      gen: authState.gen,
      brand_id: 'wkrp',
    }));

    log('AUTH_CALLBACK_SUCCESS', { contributorId, name: authState.name, gen: authState.gen });
    await recordAudit(env, request, {
      action: 'auth.callback', resourceType: 'session', resourceId: contributorId,
      outcome: 'success', actorId: contributorId,
    });

    // Redirect to catalog — session is in the cookie, NOT in the URL
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${appUrl}/catalog`,
        'Set-Cookie': buildSessionCookie(sessionToken, isProduction),
      },
    });

  } catch (err) {
    logError('AUTH_CALLBACK_ERROR', err);
    await recordAudit(env, request, {
      action: 'auth.callback', resourceType: 'session', outcome: 'failure', actorId: null,
    });
    return Response.redirect(`${appUrl}/?error=auth_failed`, 302);
  }
}

/**
 * Upsert contributor by spotify_user_id.
 * If this Spotify account already exists, update it (returning user).
 * If new, insert with a fresh UUID.
 * Returns the contributor ID.
 */
async function upsertContributor(
  env: Env,
  profile: SpotifyUserProfile,
  name: string,
  gen: string,
  role?: string,
): Promise<string> {
  // Check if this Spotify user already exists
  const existing = await env.WKRP_DB.prepare(
    'SELECT id FROM contributors WHERE spotify_user_id = ?'
  ).bind(profile.id).first();

  if (existing) {
    // Returning user — update their record, keep existing ID
    await env.WKRP_DB.prepare(`
      UPDATE contributors SET
        name = ?,
        generation = ?,
        spotify_display_name = ?
      WHERE id = ?
    `).bind(
      name,
      gen,
      profile.display_name ?? name,
      existing.id as string,
    ).run();

    log('AUTH_CONTRIBUTOR_UPDATED', { id: existing.id, spotify_id: profile.id });
    return existing.id as string;
  }

  // New user — insert
  const contributorId = crypto.randomUUID();
  await env.WKRP_DB.prepare(`
    INSERT INTO contributors (id, name, generation, brand_id, role, status, spotify_user_id, spotify_display_name, created_at)
    VALUES (?, ?, ?, 'wkrp', ?, 'active', ?, ?, ?)
  `).bind(
    contributorId,
    name,
    gen,
    role || 'contributor',
    profile.id,
    profile.display_name ?? name,
    new Date().toISOString(),
  ).run();

  log('AUTH_CONTRIBUTOR_CREATED', { id: contributorId, spotify_id: profile.id });
  return contributorId;
}

/** Validate redirect target is an allowed domain — prevents open redirect */
const ALLOWED_REDIRECT_HOSTS = new Set([
  'ourwkrp.com',
  'www.ourwkrp.com',
  'stg.ourwkrp.com',
  'ourwkrp-staging.mzdano.workers.dev',
  'ourwkrp-production.mzdano.workers.dev',
  'localhost',
  '127.0.0.1',
]);

function validateRedirectTarget(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    if (!ALLOWED_REDIRECT_HOSTS.has(url.hostname)) return null;
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
