/**
 * ourWKRP — Central Router
 *
 * Route table:
 *
 *   GET  /health                    → health check
 *   GET  /ui.css                    → shared design system CSS (@ocr/ui)
 *   GET  /                          → connect page (or catalog if session)
 *   GET  /catalog                   → catalog page
 *   GET  /create                    → playlist creation page
 *   GET  /auth/start                → initiate Spotify OAuth + PKCE
 *   GET  /auth/callback             → Spotify redirect handler
 *   POST /auth/logout               → clear session cookie + KV
 *   GET  /auth/session/me           → get contributor profile from session cookie
 *   POST /spotify/sync/:userId      → sync playlists/tracks/audio-features
 *   POST /import/:contributorId     → import CSV library file
 *
 *   --- Catalog API (WKRP-6) ---
 *   GET  /api/tracks                → filtered, searchable, paginated tracks
 *   GET  /api/contributors          → all contributors with track counts
 *   GET  /api/contributors/:id        → contributor profile JSON
 *   GET  /api/contributors/:id/brands → cross-brand contributor discovery
 *   GET  /contributor/:id             → contributor profile page (HTML)
 *   GET  /c/:slug                     → same profile page via vanity slug (OW-122)
 *   POST /api/profile/slug            → claim/change own vanity slug (OW-122)
 *   GET  /api/playlists/:id         → contributor playlists (by contributor) or single playlist (by UUID)
 *   GET  /api/stats                 → catalog statistics
 *   GET  /api/brands                → all brands with counts
 *
 *   --- Playlist Builder (WKRP-7 MVP) ---
 *   POST   /api/playlists              → create curated playlist
 *   POST   /api/playlists/:id/tracks   → add tracks to playlist
 *   DELETE /api/playlists/:id/tracks   → remove tracks from playlist
 *   GET    /api/playlists/:id/export   → export playlist as JSON (ISRCs)
 *
 *   --- Portfolio (preferred playlists) ---
 *   POST   /api/portfolio                  → add a playlist URL to the portfolio
 *   GET    /api/contributors/:id/portfolio → a contributor's portfolio
 *   DELETE /api/portfolio/:id              → remove a playlist from the portfolio
 *
 *   --- Last.fm Integration ---
 *   GET  /auth/lastfm/start         → redirect to Last.fm auth
 *   GET  /auth/lastfm/callback      → exchange token for session key
 *   POST /lastfm/sync/:userId       → sync scrobble history + tags
 *   GET  /lastfm/status/:userId     → check Last.fm connection status
 *
 *   *                               → 404
 */

import type { Env } from './types';
import { serveCss } from '@ocr/ui/css';
import { handleHealth } from './handlers/health';
import { handleAuthStart } from './handlers/auth-start';
import { handleRegister } from './handlers/auth-register';
import { handleAuthCallback } from './handlers/auth-callback';
import { handleAuthSession } from './handlers/auth-session';
import { handleLogout } from './handlers/auth-logout';
import { handleSync } from './handlers/sync';
import { handlePages } from './handlers/pages';
import { handleImport } from './handlers/import';
import { handleGetTracks, handleGetContributors, handleGetContributorPlaylists, handleGetContributorProfile, handleGetStats, handleGetBrands, handleGetContributorBrands, handleGetLayers } from './handlers/catalog';
import { handleEraseIdentity } from './handlers/privacy';
import { handleCreatePlaylist, handleGetPlaylist, handleAddPlaylistTracks, handleRemovePlaylistTracks, handleExportPlaylist } from './handlers/playlist';
import { handleAddPortfolioPlaylist, handleGetPortfolio, handleRemovePortfolioPlaylist } from './handlers/portfolio';
import { handleClaimProfileSlug } from './handlers/profile';
import { handleLastfmAuthStart, handleLastfmAuthCallback, handleLastfmSync, handleLastfmStatus } from './handlers/lastfm';
import { handleStartSet, handleAddSetTrack, handleEndSet, handleCreateAttribution, handleGetDjStats, handleGetLiveSet } from './handlers/dj';
import { handleExportTracks } from './handlers/export';
import { handleSponsorReport } from './handlers/sponsor';
import { handleGetEventMusic } from './handlers/events';
import { addCorsHeaders } from './lib/cors';
import { addSecurityHeaders } from './lib/security-headers';
import { enforceRateLimit } from './lib/rate-limit';
import { isAllowedMutation } from './lib/origin-check';
import { extractUuid, UUID_RE } from './lib/route-path';
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

  // Rate limiting — throttle expensive/abuse-prone routes before dispatch.
  const limited = await enforceRateLimit(request, env, method, path);
  if (limited) {
    return addCorsHeaders(addSecurityHeaders(limited), request, env);
  }

  // CSRF defense-in-depth: reject cross-origin mutations (atop SameSite=Lax).
  if (!isAllowedMutation(request, env, method)) {
    log('CSRF_ORIGIN_BLOCKED', { method, path, origin: request.headers.get('Origin') });
    const blocked = Response.json(
      { ok: false, status: 403, error: 'Cross-origin request blocked' },
      { status: 403 },
    );
    return addCorsHeaders(addSecurityHeaders(blocked), request, env);
  }

  let response: Response;

  // Health
  if (method === 'GET' && path === '/health') {
    response = await handleHealth(request, env);
  }
  // Shared design system CSS
  else if (method === 'GET' && path === '/ui.css') {
    response = serveCss();
  }
  // Auth endpoints
  else if (method === 'POST' && path === '/auth/register') {
    response = await handleRegister(request, env);
  }
  else if (method === 'GET' && path === '/auth/start') {
    response = await handleAuthStart(request, env);
  }
  else if (method === 'GET' && path === '/auth/callback') {
    response = await handleAuthCallback(request, env);
  }
  else if (method === 'POST' && path === '/auth/logout') {
    response = await handleLogout(request, env);
  }
  else if (method === 'GET' && path === '/auth/session/me') {
    response = await handleAuthSession(request, env);
  }
  // Spotify sync (legacy, still functional for <=5 users)
  else if (method === 'POST' && path.startsWith('/spotify/sync/')) {
    response = await handleSync(request, env);
  }
  // CSV import
  else if (method === 'POST' && path.startsWith('/import/')) {
    const contributorId = extractUuid(path, '/import/');
    if (!contributorId) {
      response = Response.json({ ok: false, error: 'Invalid contributor ID format' }, { status: 400 });
    } else {
      response = await handleImport(request, env, contributorId);
    }
  }

  // --- Catalog API (WKRP-6) ---
  else if (method === 'GET' && path === '/api/tracks') {
    response = await handleGetTracks(request, env);
  }
  else if (method === 'DELETE' && path.startsWith('/api/contributors/') && path.endsWith('/identity')) {
    const contributorId = extractUuid(path, '/api/contributors/', '/identity');
    if (!contributorId) {
      response = Response.json({ ok: false, error: 'Invalid contributor ID format' }, { status: 400 });
    } else {
      response = await handleEraseIdentity(request, env, contributorId);
    }
  }
  else if (method === 'GET' && path.startsWith('/api/contributors/') && path.endsWith('/brands')) {
    const contributorId = extractUuid(path, '/api/contributors/', '/brands');
    if (!contributorId) {
      response = Response.json({ ok: false, error: 'Invalid contributor ID format' }, { status: 400 });
    } else {
      response = await handleGetContributorBrands(request, env, contributorId);
    }
  }
  else if (method === 'GET' && path.startsWith('/api/contributors/') && path.endsWith('/portfolio')) {
    const contributorId = extractUuid(path, '/api/contributors/', '/portfolio');
    if (!contributorId) {
      response = Response.json({ ok: false, error: 'Invalid contributor ID format' }, { status: 400 });
    } else {
      response = await handleGetPortfolio(request, env, contributorId);
    }
  }
  else if (method === 'GET' && path.startsWith('/api/contributors/') && !path.includes('/brands') && !path.endsWith('/portfolio')) {
    const contributorId = extractUuid(path, '/api/contributors/');
    if (!contributorId) {
      response = Response.json({ ok: false, error: 'Invalid contributor ID format' }, { status: 400 });
    } else {
      response = await handleGetContributorProfile(request, env, contributorId);
    }
  }
  else if (method === 'GET' && path === '/api/contributors') {
    response = await handleGetContributors(request, env);
  }
  else if (method === 'GET' && path === '/api/stats') {
    response = await handleGetStats(request, env);
  }
  else if (method === 'GET' && path === '/api/layers') {
    response = await handleGetLayers(request, env);
  }
  else if (method === 'GET' && path === '/api/brands') {
    response = await handleGetBrands(request, env);
  }

  // --- Playlist routes (WKRP-6 contributor playlists + WKRP-7 playlist builder) ---
  else if (method === 'POST' && path === '/api/playlists') {
    response = await handleCreatePlaylist(request, env);
  }
  else if (method === 'GET' && path.startsWith('/api/playlists/') && path.endsWith('/export')) {
    const playlistId = extractUuid(path, '/api/playlists/', '/export');
    if (!playlistId) {
      response = Response.json({ ok: false, error: 'Invalid playlist ID' }, { status: 400 });
    } else {
      response = await handleExportPlaylist(request, env, playlistId);
    }
  }
  else if (path.startsWith('/api/playlists/') && path.endsWith('/tracks')) {
    const playlistId = extractUuid(path, '/api/playlists/', '/tracks');
    if (!playlistId) {
      response = Response.json({ ok: false, error: 'Invalid playlist ID' }, { status: 400 });
    } else if (method === 'POST') {
      response = await handleAddPlaylistTracks(request, env, playlistId);
    } else if (method === 'DELETE') {
      response = await handleRemovePlaylistTracks(request, env, playlistId);
    } else {
      response = Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
    }
  }
  else if (method === 'GET' && path.startsWith('/api/playlists/')) {
    const id = path.slice('/api/playlists/'.length);
    if (UUID_RE.test(id)) {
      response = await handleGetPlaylist(request, env, id);
    } else {
      // Treat as contributor ID for contributor playlists
      response = await handleGetContributorPlaylists(request, env, id);
    }
  }

  // --- Portfolio (preferred playlists) ---
  else if (method === 'POST' && path === '/api/portfolio') {
    response = await handleAddPortfolioPlaylist(request, env);
  }
  else if (method === 'DELETE' && path.startsWith('/api/portfolio/')) {
    const id = path.slice('/api/portfolio/'.length);
    if (!UUID_RE.test(id)) {
      response = Response.json({ ok: false, error: 'Invalid playlist ID' }, { status: 400 });
    } else {
      response = await handleRemovePortfolioPlaylist(request, env, id);
    }
  }

  // --- Profile vanity slug (OW-122) ---
  else if (method === 'POST' && path === '/api/profile/slug') {
    response = await handleClaimProfileSlug(request, env);
  }

  // --- Last.fm Integration ---
  else if (method === 'GET' && path === '/auth/lastfm/start') {
    response = await handleLastfmAuthStart(request, env);
  }
  else if (method === 'GET' && path === '/auth/lastfm/callback') {
    response = await handleLastfmAuthCallback(request, env);
  }
  else if (method === 'POST' && path.startsWith('/lastfm/sync/')) {
    response = await handleLastfmSync(request, env);
  }
  else if (method === 'GET' && path.startsWith('/lastfm/status/')) {
    response = await handleLastfmStatus(request, env);
  }

  // Pages
  // --- DJ Attribution (WKRP-22) ---
  else if (method === 'POST' && path === '/api/sets') {
    response = await handleStartSet(request, env);
  }
  else if (method === 'POST' && path.startsWith('/api/sets/') && path.endsWith('/tracks')) {
    const setId = path.slice('/api/sets/'.length, -'/tracks'.length);
    response = await handleAddSetTrack(request, env, setId);
  }
  else if (method === 'POST' && path.startsWith('/api/sets/') && path.endsWith('/end')) {
    const setId = path.slice('/api/sets/'.length, -'/end'.length);
    response = await handleEndSet(request, env, setId);
  }
  else if (method === 'POST' && path === '/api/attributions') {
    response = await handleCreateAttribution(request, env);
  }
  else if (method === 'GET' && path.startsWith('/dj/') && path.endsWith('/stats')) {
    const djId = path.slice('/dj/'.length, -'/stats'.length);
    response = await handleGetDjStats(request, env, djId);
  }
  else if (method === 'GET' && path.startsWith('/dj/') && path.endsWith('/live')) {
    const djId = path.slice('/dj/'.length, -'/live'.length);
    response = await handleGetLiveSet(request, env, djId);
  }

  // --- Catalog Export (WKRP-29) ---
  else if (method === 'GET' && path === '/api/export/tracks') {
    response = await handleExportTracks(request, env);
  }

  // --- Sponsor Reporting (WKRP-25) ---
  else if (method === 'GET' && path.startsWith('/api/sponsors/') && path.endsWith('/report')) {
    const eventId = path.slice('/api/sponsors/'.length, -'/report'.length);
    response = await handleSponsorReport(request, env, eventId);
  }

  // --- OurSharedEvents Integration (WKRP-26) ---
  else if (method === 'GET' && path.startsWith('/api/events/') && path.endsWith('/music')) {
    const eventId = path.slice('/api/events/'.length, -'/music'.length);
    response = await handleGetEventMusic(request, env, eventId);
  }

  // Pages — DJ poster must match before generic /dj/ page
  else if (method === 'GET' && path.startsWith('/dj/') && path.endsWith('/poster')) {
    response = await handlePages(request, env);
  }
  else if (method === 'GET' && path.startsWith('/dj/')) {
    response = await handlePages(request, env);
  }
  else if (method === 'GET' && path.startsWith('/contributor/')) {
    response = await handlePages(request, env);
  }
  // Vanity profile URL (OW-122) — resolves a slug to the same profile page.
  // handlePages 404s a slug that matches no contributor.
  else if (method === 'GET' && path.startsWith('/c/')) {
    response = await handlePages(request, env);
  }
  else if (method === 'GET' && ['/', '/catalog', '/create', '/import', '/dashboard', '/stats'].includes(path)) {
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
