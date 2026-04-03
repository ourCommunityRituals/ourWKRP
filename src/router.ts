/**
 * ourWKRP — Central Router
 *
 * Route table:
 *
 *   GET  /health                    → health check
 *   GET  /                          → connect page (or catalog if session)
 *   GET  /catalog                   → catalog page
 *   GET  /create                    → playlist creation page
 *   GET  /auth/start                → initiate Spotify OAuth + PKCE
 *   GET  /auth/callback             → Spotify redirect handler
 *   GET  /auth/session/:token       → get contributor profile from session
 *   POST /spotify/sync/:userId      → sync playlists/tracks/audio-features
 *   POST /spotify/create-playlist/:userId → create playlist on Spotify
 *   POST /import/:contributorId     → import CSV library file
 *   *                               → 404
 */

import type { Env } from './types';
import { handleHealth } from './handlers/health';
import { handleAuthStart } from './handlers/auth-start';
import { handleAuthCallback } from './handlers/auth-callback';
import { handleAuthSession } from './handlers/auth-session';
import { handleSync } from './handlers/sync';
import { handlePages } from './handlers/pages';
import { handleImport } from './handlers/import';
import { addCorsHeaders } from './lib/cors';
import { addSecurityHeaders } from './lib/security-headers';
import { log } from './lib/logger';

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  log('ROUTE', { method, path, timestamp: new Date().toISOString() });

  // CORS preflight
  if (method === 'OPTIONS') {
    return addCorsHeaders(new Response(null, { status: 204 }), request, env);
  }

  let response: Response;

  // Health
  if (method === 'GET' && path === '/health') {
    response = await handleHealth(request, env);
  }
  // Auth endpoints
  else if (method === 'GET' && path === '/auth/start') {
    response = await handleAuthStart(request, env);
  }
  else if (method === 'GET' && path === '/auth/callback') {
    response = await handleAuthCallback(request, env);
  }
  else if (method === 'GET' && path.startsWith('/auth/session/')) {
    response = await handleAuthSession(request, env);
  }
  // Spotify sync
  else if (method === 'POST' && path.startsWith('/spotify/sync/')) {
    response = await handleSync(request, env);
  }
  // CSV import
  else if (method === 'POST' && path.startsWith('/import/')) {
    const contributorId = path.replace('/import/', '');
    response = await handleImport(request, env, contributorId);
  }
  // Pages
  else if (method === 'GET' && ['/', '/catalog', '/create'].includes(path)) {
    response = await handlePages(request, env);
  }
  // 404
  else {
    response = Response.json(
      { ok: false, status: 404, error: 'Not found' },
      { status: 404 },
    );
  }

  response = addSecurityHeaders(response);
  response = addCorsHeaders(response, request, env);
  return response;
}
