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
 *   POST /import/:contributorId     → import CSV library file
 *
 *   --- Catalog API (WKRP-6) ---
 *   GET  /api/tracks                → filtered, searchable, paginated tracks
 *   GET  /api/contributors          → all contributors with track counts
 *   GET  /api/contributors/:id        → contributor profile JSON
 *   GET  /api/contributors/:id/brands → cross-brand contributor discovery
 *   GET  /contributor/:id             → contributor profile page (HTML)
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
 *   --- Last.fm Integration ---
 *   GET  /auth/lastfm/start         → redirect to Last.fm auth
 *   GET  /auth/lastfm/callback      → exchange token for session key
 *   POST /lastfm/sync/:userId       → sync scrobble history + tags
 *   GET  /lastfm/status/:userId     → check Last.fm connection status
 *
 *   *                               → 404
 */

import type { Env } from './types';
import { handleHealth } from './handlers/health';
import { handleAuthStart } from './handlers/auth-start';
import { handleRegister } from './handlers/auth-register';
import { handleAuthCallback } from './handlers/auth-callback';
import { handleAuthSession } from './handlers/auth-session';
import { handleSync } from './handlers/sync';
import { handlePages } from './handlers/pages';
import { handleImport } from './handlers/import';
import { handleGetTracks, handleGetContributors, handleGetContributorPlaylists, handleGetContributorProfile, handleGetStats, handleGetBrands, handleGetContributorBrands, handleGetLayers } from './handlers/catalog';
import { handleCreatePlaylist, handleGetPlaylist, handleAddPlaylistTracks, handleRemovePlaylistTracks, handleExportPlaylist } from './handlers/playlist';
import { handleLastfmAuthStart, handleLastfmAuthCallback, handleLastfmSync, handleLastfmStatus } from './handlers/lastfm';
import { handleStartSet, handleAddSetTrack, handleEndSet, handleCreateAttribution, handleGetDjStats, handleGetLiveSet } from './handlers/dj';
import { handleExportTracks } from './handlers/export';
import { handleSponsorReport } from './handlers/sponsor';
import { handleGetEventMusic } from './handlers/events';
import { addCorsHeaders } from './lib/cors';
import { addSecurityHeaders } from './lib/security-headers';
import { log } from './lib/logger';

const UUID_RE = /^[0-9a-f-]{36}$/;

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
  else if (method === 'POST' && path === '/auth/register') {
    response = await handleRegister(request, env);
  }
  else if (method === 'GET' && path === '/auth/start') {
    response = await handleAuthStart(request, env);
  }
  else if (method === 'GET' && path === '/auth/callback') {
    response = await handleAuthCallback(request, env);
  }
  else if (method === 'GET' && path.startsWith('/auth/session/')) {
    response = await handleAuthSession(request, env);
  }
  // Spotify sync (legacy, still functional for <=5 users)
  else if (method === 'POST' && path.startsWith('/spotify/sync/')) {
    response = await handleSync(request, env);
  }
  // CSV import
  else if (method === 'POST' && path.startsWith('/import/')) {
    const contributorId = path.slice('/import/'.length);
    if (!contributorId || !UUID_RE.test(contributorId)) {
      response = Response.json({ ok: false, error: 'Invalid contributor ID format' }, { status: 400 });
    } else {
      response = await handleImport(request, env, contributorId);
    }
  }

  // --- Catalog API (WKRP-6) ---
  else if (method === 'GET' && path === '/api/tracks') {
    response = await handleGetTracks(request, env);
  }
  else if (method === 'GET' && path.startsWith('/api/contributors/') && path.endsWith('/brands')) {
    const contributorId = path.slice('/api/contributors/'.length, -'/brands'.length);
    if (!UUID_RE.test(contributorId)) {
      response = Response.json({ ok: false, error: 'Invalid contributor ID format' }, { status: 400 });
    } else {
      response = await handleGetContributorBrands(request, env, contributorId);
    }
  }
  else if (method === 'GET' && path.startsWith('/api/contributors/') && !path.includes('/brands')) {
    const contributorId = path.slice('/api/contributors/'.length);
    if (!UUID_RE.test(contributorId)) {
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
    const playlistId = path.slice('/api/playlists/'.length, -'/export'.length);
    if (!UUID_RE.test(playlistId)) {
      response = Response.json({ ok: false, error: 'Invalid playlist ID' }, { status: 400 });
    } else {
      response = await handleExportPlaylist(request, env, playlistId);
    }
  }
  else if (path.startsWith('/api/playlists/') && path.endsWith('/tracks')) {
    const playlistId = path.slice('/api/playlists/'.length, -'/tracks'.length);
    if (!UUID_RE.test(playlistId)) {
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
