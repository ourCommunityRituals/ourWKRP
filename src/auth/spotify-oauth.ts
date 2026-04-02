/**
 * Spotify Authorization Code Flow + PKCE
 *
 * No client_secret needed — code_verifier/challenge replaces it.
 * Spotify deprecated Implicit Grant Nov 2025.
 */

import type { SpotifyTokenResponse } from '../types';
import { log, logError } from '../lib/logger';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

/**
 * Generate a cryptographic random string for PKCE code_verifier
 */
export function generateCodeVerifier(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

/**
 * Derive SHA-256 code_challenge from code_verifier (base64url encoded)
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(digest);
}

/**
 * Generate a random state token for CSRF protection
 */
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the Spotify authorization URL
 */
export async function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): Promise<string> {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const url = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  log('OAUTH_AUTH_URL', { url: url.substring(0, 100) + '...' });
  return url;
}

/**
 * Exchange authorization code for access + refresh tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<SpotifyTokenResponse> {
  log('OAUTH_TOKEN_EXCHANGE', { code: code.substring(0, 10) + '...' });

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logError('OAUTH_TOKEN_ERROR', new Error(`Token exchange failed: ${response.status}`), {
      status: response.status,
      body: errorBody,
    });
    throw new Error(`Spotify token exchange failed: ${response.status} — ${errorBody}`);
  }

  const tokens = await response.json() as SpotifyTokenResponse;
  log('OAUTH_TOKEN_SUCCESS', { expires_in: tokens.expires_in, has_refresh: !!tokens.refresh_token });
  return tokens;
}

/**
 * Base64url encode an ArrayBuffer (no padding, URL-safe)
 */
function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
