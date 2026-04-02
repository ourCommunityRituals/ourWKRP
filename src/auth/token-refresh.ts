/**
 * Token refresh — automatically refreshes expired Spotify tokens
 *
 * Call getValidAccessToken() before any Spotify API call.
 * If within 5 min of expiry, refreshes automatically. Updates KV.
 */

import type { Env, StoredTokens, SpotifyTokenResponse } from '../types';
import { getTokens, storeTokens } from '../lib/kv-storage';
import { log, logError } from '../lib/logger';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

/**
 * Get a valid access token for the given user. Refreshes if needed.
 * Returns null if no tokens exist (user needs to re-auth).
 */
export async function getValidAccessToken(env: Env, userId: string): Promise<string | null> {
  const tokens = await getTokens(env.WKRP_KV, userId);
  if (!tokens) {
    log('TOKEN_MISSING', { userId });
    return null;
  }

  // Check if token is still valid (with buffer)
  if (Date.now() < tokens.expires_at - REFRESH_BUFFER_MS) {
    log('TOKEN_VALID', { userId, expires_in_ms: tokens.expires_at - Date.now() });
    return tokens.access_token;
  }

  // Token expired or about to expire — refresh
  log('TOKEN_REFRESH_START', { userId });
  try {
    const refreshed = await refreshAccessToken(tokens.refresh_token, env.SPOTIFY_CLIENT_ID);

    const updatedTokens: StoredTokens = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      expires_at: Date.now() + (refreshed.expires_in * 1000),
    };

    await storeTokens(env.WKRP_KV, userId, updatedTokens);
    log('TOKEN_REFRESH_SUCCESS', { userId, expires_in: refreshed.expires_in });

    return updatedTokens.access_token;
  } catch (err) {
    logError('TOKEN_REFRESH_FAILED', err, { userId });
    return null;
  }
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token refresh failed: ${response.status} — ${errorBody}`);
  }

  return await response.json() as SpotifyTokenResponse;
}
