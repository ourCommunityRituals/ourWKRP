/**
 * Portfolio handlers — a contributor's portfolio of pointed playlist URLs.
 *
 * POST   /api/portfolio                    — add a playlist URL (authed)
 * GET    /api/contributors/:id/portfolio   — list a contributor's portfolio (public)
 * DELETE /api/portfolio/:id                — remove one (authed, owner)
 */

import type { Env } from '../types';
import { requireSession } from '../lib/require-session';
import { parsePlaylistUrl, playlistEmbedUrl, type PlaylistPlatform } from '../lib/playlist-url';
import { addPortfolioBodySchema } from '../lib/schemas';
import { validateBody } from '../lib/validate';
import { log } from '../lib/logger';

interface PreferredPlaylistRow {
  id: string;
  contributor_id: string;
  platform: string;
  external_id: string;
  url: string;
  title: string | null;
  position: number;
  created_at: string;
}

/** Shape returned to clients — adds the embeddable player URL. */
function present(row: PreferredPlaylistRow) {
  return {
    id: row.id,
    contributor_id: row.contributor_id,
    platform: row.platform,
    external_id: row.external_id,
    url: row.url,
    title: row.title,
    position: row.position,
    created_at: row.created_at,
    embed_url: playlistEmbedUrl(row.platform as PlaylistPlatform, row.external_id),
  };
}

/** POST /api/portfolio — add a playlist URL to the authenticated contributor's portfolio. */
export async function handleAddPortfolioPlaylist(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const parsed = await validateBody(request, addPortfolioBodySchema);
  if (parsed instanceof Response) return parsed;

  const playlist = parsePlaylistUrl(parsed.url);
  if (!playlist) {
    return Response.json(
      { ok: false, error: 'Not a recognized Spotify playlist link — paste a link like https://open.spotify.com/playlist/...' },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();
  const title = parsed.title ?? null;

  // position is appended to the end of the contributor's portfolio.
  const result = await env.WKRP_DB.prepare(`
    INSERT OR IGNORE INTO preferred_playlists
      (id, contributor_id, platform, external_id, url, title, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?,
      COALESCE((SELECT MAX(position) FROM preferred_playlists WHERE contributor_id = ?), -1) + 1,
      datetime('now'))
  `).bind(id, auth.userId, playlist.platform, playlist.externalId, playlist.url, title, auth.userId).run();

  if (result.meta.changes === 0) {
    return Response.json(
      { ok: false, error: 'That playlist is already in your portfolio' },
      { status: 409 },
    );
  }

  const row = await env.WKRP_DB.prepare(
    'SELECT * FROM preferred_playlists WHERE id = ?',
  ).bind(id).first<PreferredPlaylistRow>();

  log('PORTFOLIO_PLAYLIST_ADDED', { id, contributor: auth.userId, platform: playlist.platform });

  return Response.json({ ok: true, playlist: present(row!) }, { status: 201 });
}

/** GET /api/contributors/:id/portfolio — a contributor's portfolio (public). */
export async function handleGetPortfolio(_request: Request, env: Env, contributorId: string): Promise<Response> {
  const result = await env.WKRP_DB.prepare(
    'SELECT * FROM preferred_playlists WHERE contributor_id = ? ORDER BY position ASC',
  ).bind(contributorId).all<PreferredPlaylistRow>();

  return Response.json({
    ok: true,
    contributor_id: contributorId,
    playlists: result.results.map(present),
  });
}

/** DELETE /api/portfolio/:id — remove a playlist the authenticated contributor owns. */
export async function handleRemovePortfolioPlaylist(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const row = await env.WKRP_DB.prepare(
    'SELECT contributor_id FROM preferred_playlists WHERE id = ?',
  ).bind(id).first<{ contributor_id: string }>();

  if (!row) {
    return Response.json({ ok: false, error: 'Playlist not found' }, { status: 404 });
  }
  if (row.contributor_id !== auth.userId) {
    return Response.json({ ok: false, error: 'Not your portfolio' }, { status: 403 });
  }

  await env.WKRP_DB.prepare('DELETE FROM preferred_playlists WHERE id = ?').bind(id).run();
  log('PORTFOLIO_PLAYLIST_REMOVED', { id, contributor: auth.userId });

  return Response.json({ ok: true, removed: id });
}
