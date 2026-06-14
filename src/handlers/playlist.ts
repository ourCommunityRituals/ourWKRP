/**
 * Playlist Builder handlers (D1-only MVP)
 *
 * POST   /api/playlists              — create playlist
 * GET    /api/playlists/:id          — get playlist with tracks
 * POST   /api/playlists/:id/tracks   — add tracks
 * DELETE /api/playlists/:id/tracks   — remove tracks
 * GET    /api/playlists/:id/export   — export as JSON (ISRCs for Apple Music import)
 */

import type { Env } from '../types';
import { requireSession } from '../lib/require-session';
import { extractBrandId } from '../lib/brand';
import { createPlaylistBodySchema, playlistTracksBodySchema } from '../lib/schemas';
import { validateBody } from '../lib/validate';
import { recordAudit } from '../lib/audit';
import { log } from '../lib/logger';

const ALLOWED_CREATOR_ROLES = ['founder', 'curator', 'dj'];

/** Verify the authenticated user owns a curated playlist. */
async function requireOwnedPlaylist(
  env: Env, playlistId: string, userId: string,
): Promise<Record<string, unknown> | Response> {
  const playlist = await env.WKRP_DB.prepare(
    'SELECT id, contributor_id, track_count FROM playlists WHERE id = ? AND is_curated = 1'
  ).bind(playlistId).first();
  if (!playlist) {
    return Response.json({ ok: false, error: 'Curated playlist not found' }, { status: 404 });
  }
  if (playlist.contributor_id !== userId) {
    return Response.json({ ok: false, error: 'Not your playlist' }, { status: 403 });
  }
  return playlist;
}

/**
 * POST /api/playlists
 * Body: { name: string, description?: string }
 */
export async function handleCreatePlaylist(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const brandId = extractBrandId(request);

  // Check role
  const contributor = await env.WKRP_DB.prepare(
    'SELECT id, role FROM contributors WHERE id = ?'
  ).bind(auth.userId).first();

  if (!contributor) {
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }
  if (!ALLOWED_CREATOR_ROLES.includes(contributor.role as string)) {
    await recordAudit(env, request, {
      action: 'playlist.create', resourceType: 'playlist', outcome: 'denied',
      actorId: auth.userId, brandId, meta: { reason: 'insufficient_role' },
    });
    return Response.json(
      { ok: false, error: 'Only founders, curators, and DJs can create playlists' },
      { status: 403 },
    );
  }

  const parsed = await validateBody(request, createPlaylistBodySchema);
  if (parsed instanceof Response) return parsed;

  const name = parsed.name;
  const description = parsed.description ?? null;
  const id = crypto.randomUUID();

  await env.WKRP_DB.prepare(`
    INSERT INTO playlists (id, contributor_id, name, description, track_count, is_curated, brand_id, created_at)
    VALUES (?, ?, ?, ?, 0, 1, ?, datetime('now'))
  `).bind(id, auth.userId, name, description, brandId).run();

  log('PLAYLIST_CREATED', { id, name, creator: auth.userId, brand_id: brandId });
  await recordAudit(env, request, {
    action: 'playlist.create', resourceType: 'playlist', resourceId: id,
    outcome: 'success', actorId: auth.userId, brandId,
  });

  return Response.json({
    ok: true,
    playlist: { id, name, description, track_count: 0, brand_id: brandId },
  }, { status: 201 });
}

/**
 * GET /api/playlists/:id
 */
export async function handleGetPlaylist(request: Request, env: Env, playlistId: string): Promise<Response> {
  const playlist = await env.WKRP_DB.prepare(`
    SELECT p.id, p.name, p.description, p.track_count, p.contributor_id,
           p.is_curated, p.brand_id, p.created_at,
           c.name as creator_name
    FROM playlists p
    LEFT JOIN contributors c ON p.contributor_id = c.id
    WHERE p.id = ?
  `).bind(playlistId).first();

  if (!playlist) {
    return Response.json({ ok: false, error: 'Playlist not found' }, { status: 404 });
  }

  // Get tracks in this playlist
  const tracks = await env.WKRP_DB.prepare(`
    SELECT t.id, t.name, t.artist, t.album, t.duration_ms, t.image_url,
           t.energy, t.danceability, t.valence, t.genre, t.isrc, t.release_year,
           pt.position
    FROM playlist_tracks pt
    INNER JOIN tracks t ON pt.track_id = t.id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position ASC
  `).bind(playlistId).all();

  return Response.json({
    ok: true,
    playlist: {
      ...playlist,
      tracks: tracks.results,
    },
  });
}

/**
 * POST /api/playlists/:id/tracks
 * Body: { track_ids: string[] }
 */
export async function handleAddPlaylistTracks(request: Request, env: Env, playlistId: string): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const playlist = await requireOwnedPlaylist(env, playlistId, auth.userId);
  if (playlist instanceof Response) return playlist;

  const parsed = await validateBody(request, playlistTracksBodySchema);
  if (parsed instanceof Response) return parsed;

  const trackIds = parsed.track_ids;

  // Derive position atomically inside the batch to avoid race with concurrent adds
  const statements = trackIds.map((trackId, i) =>
    env.WKRP_DB.prepare(
      `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at, added_by)
       VALUES (?, ?, COALESCE((SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = ?), -1) + 1 + ?, datetime('now'), ?)`
    ).bind(playlistId, trackId, playlistId, i, auth.userId)
  );

  // Update track count
  statements.push(
    env.WKRP_DB.prepare(
      `UPDATE playlists SET track_count = (
        SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?
      ) WHERE id = ?`
    ).bind(playlistId, playlistId)
  );

  await env.WKRP_DB.batch(statements);

  log('PLAYLIST_TRACKS_ADDED', { playlist_id: playlistId, count: trackIds.length });
  await recordAudit(env, request, {
    action: 'playlist.tracks.add', resourceType: 'playlist', resourceId: playlistId,
    outcome: 'success', actorId: auth.userId, meta: { count: trackIds.length },
  });

  return Response.json({ ok: true, added: trackIds.length });
}

/**
 * DELETE /api/playlists/:id/tracks
 * Body: { track_ids: string[] }
 */
export async function handleRemovePlaylistTracks(request: Request, env: Env, playlistId: string): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const playlist = await requireOwnedPlaylist(env, playlistId, auth.userId);
  if (playlist instanceof Response) return playlist;

  const parsed = await validateBody(request, playlistTracksBodySchema);
  if (parsed instanceof Response) return parsed;

  const trackIds = parsed.track_ids;

  const statements = trackIds.map(trackId =>
    env.WKRP_DB.prepare(
      'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?'
    ).bind(playlistId, trackId)
  );

  // Update track count
  statements.push(
    env.WKRP_DB.prepare(
      `UPDATE playlists SET track_count = (
        SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?
      ) WHERE id = ?`
    ).bind(playlistId, playlistId)
  );

  await env.WKRP_DB.batch(statements);

  log('PLAYLIST_TRACKS_REMOVED', { playlist_id: playlistId, count: trackIds.length });
  await recordAudit(env, request, {
    action: 'playlist.tracks.remove', resourceType: 'playlist', resourceId: playlistId,
    outcome: 'success', actorId: auth.userId, meta: { count: trackIds.length },
  });

  return Response.json({ ok: true, removed: trackIds.length });
}

/**
 * GET /api/playlists/:id/export
 * Returns playlist as JSON with ISRCs for Apple Music manual import.
 */
export async function handleExportPlaylist(request: Request, env: Env, playlistId: string): Promise<Response> {
  const playlist = await env.WKRP_DB.prepare(
    `SELECT p.id, p.name, p.description, c.name as creator_name
     FROM playlists p LEFT JOIN contributors c ON p.contributor_id = c.id
     WHERE p.id = ?`
  ).bind(playlistId).first();

  if (!playlist) {
    return Response.json({ ok: false, error: 'Playlist not found' }, { status: 404 });
  }

  const tracks = await env.WKRP_DB.prepare(`
    SELECT t.name, t.artist, t.album, t.isrc, t.duration_ms, pt.position
    FROM playlist_tracks pt
    INNER JOIN tracks t ON pt.track_id = t.id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position ASC
  `).bind(playlistId).all();

  return Response.json({
    ok: true,
    export: {
      playlist_name: playlist.name,
      playlist_description: playlist.description,
      creator: playlist.creator_name,
      track_count: tracks.results.length,
      exported_at: new Date().toISOString(),
      tracks: tracks.results.map((t, i) => ({
        position: i + 1,
        name: t.name,
        artist: t.artist,
        album: t.album,
        isrc: t.isrc,
        duration_ms: t.duration_ms,
      })),
    },
  });
}
