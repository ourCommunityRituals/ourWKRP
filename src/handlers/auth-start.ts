/**
 * GET /auth/start?name=Matt&gen=founder
 *
 * Initiates Spotify OAuth + PKCE flow:
 * 1. Validate name + generation params
 * 2. Generate code_verifier, code_challenge, state
 * 3. Store auth state in KV (10 min TTL)
 * 4. Redirect browser to Spotify authorization page
 */

import type { Env } from '../types';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthUrl,
} from '../auth/spotify-oauth';
import { storeAuthState } from '../lib/kv-storage';
import { log, logError } from '../lib/logger';

const VALID_GENERATIONS = ['founder', 'gen2', 'gen3'];

export async function handleAuthStart(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get('name')?.trim();
  const gen = url.searchParams.get('gen')?.trim();

  // Validate inputs
  if (!name || name.length < 1 || name.length > 100) {
    log('AUTH_START_INVALID', { reason: 'missing_name' });
    return Response.json(
      { ok: false, error: 'Name is required (1-100 characters)' },
      { status: 400 },
    );
  }

  if (!gen || !VALID_GENERATIONS.includes(gen)) {
    log('AUTH_START_INVALID', { reason: 'invalid_generation', gen });
    return Response.json(
      { ok: false, error: `Generation must be one of: ${VALID_GENERATIONS.join(', ')}` },
      { status: 400 },
    );
  }

  // Sanitize name — strip HTML/script tags
  const sanitizedName = name.replace(/<[^>]*>/g, '').trim();
  if (!sanitizedName) {
    return Response.json(
      { ok: false, error: 'Name contains invalid characters' },
      { status: 400 },
    );
  }

  try {
    // Generate PKCE values
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Store in KV for callback to retrieve
    await storeAuthState(env.WKRP_KV, state, {
      code_verifier: codeVerifier,
      name: sanitizedName,
      gen,
    });

    // Build Spotify auth URL and redirect
    const authUrl = await buildAuthUrl(
      env.SPOTIFY_CLIENT_ID,
      env.SPOTIFY_REDIRECT_URI,
      state,
      codeChallenge,
    );

    log('AUTH_START_REDIRECT', { name: sanitizedName, gen });
    return Response.redirect(authUrl, 302);
  } catch (err) {
    logError('AUTH_START_ERROR', err);
    return Response.json(
      { ok: false, error: 'Failed to start authentication' },
      { status: 500 },
    );
  }
}
