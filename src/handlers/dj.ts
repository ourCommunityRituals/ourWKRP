/**
 * DJ Attribution handlers
 *
 * GET  /dj/:id/live       — live set page (what's playing, tap to attribute)
 * GET  /dj/:id/stats      — DJ influence stats JSON
 * POST /api/sets           — start a live set
 * POST /api/sets/:id/tracks — add a track to the current set
 * POST /api/sets/:id/end   — end a live set
 * POST /api/attributions   — record a discovery attribution
 */

import type { Env } from '../types';
import { getSession } from '../lib/kv-storage';
import { getSessionToken } from '../lib/session-cookie';
import { pushTrackToLibrary, addToDiscoveryPlaylist, detectPlatform } from '../lib/music-push';
import { log } from '../lib/logger';

/**
 * POST /api/sets
 * Start a live DJ set. DJ must be authenticated.
 * Body: { venue_name?: string, event_id?: string }
 */
export async function handleStartSet(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  // Verify DJ role
  const contributor = await env.WKRP_DB.prepare(
    'SELECT id, role FROM contributors WHERE id = ?'
  ).bind(auth.userId).first();

  if (!contributor || contributor.role !== 'dj') {
    return Response.json({ ok: false, error: 'Only DJs can start sets' }, { status: 403 });
  }

  // End any existing live set
  await env.WKRP_DB.prepare(
    "UPDATE dj_sets SET is_live = 0, ended_at = datetime('now') WHERE dj_id = ? AND is_live = 1"
  ).bind(auth.userId).run();

  let body: { venue_name?: string; event_id?: string };
  try {
    body = await request.json() as { venue_name?: string; event_id?: string };
  } catch {
    body = {};
  }

  const setId = crypto.randomUUID();

  await env.WKRP_DB.prepare(`
    INSERT INTO dj_sets (id, dj_id, event_id, venue_name, started_at, is_live)
    VALUES (?, ?, ?, ?, datetime('now'), 1)
  `).bind(setId, auth.userId, body.event_id ?? null, body.venue_name ?? null).run();

  log('DJ_SET_STARTED', { set_id: setId, dj_id: auth.userId, venue: body.venue_name });

  return Response.json({
    ok: true,
    set: { id: setId, dj_id: auth.userId, venue_name: body.venue_name, is_live: true },
  }, { status: 201 });
}

/**
 * POST /api/sets/:id/tracks
 * Add a track to the current set.
 * Body: { track_id: string }
 */
export async function handleAddSetTrack(request: Request, env: Env, setId: string): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  // Verify ownership
  const set = await env.WKRP_DB.prepare(
    'SELECT id, dj_id, is_live FROM dj_sets WHERE id = ? AND is_live = 1'
  ).bind(setId).first();

  if (!set) {
    return Response.json({ ok: false, error: 'Live set not found' }, { status: 404 });
  }
  if (set.dj_id !== auth.userId) {
    return Response.json({ ok: false, error: 'Not your set' }, { status: 403 });
  }

  let body: { track_id?: string };
  try {
    body = await request.json() as { track_id?: string };
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.track_id) {
    return Response.json({ ok: false, error: 'track_id required' }, { status: 400 });
  }

  // Get next position
  const posResult = await env.WKRP_DB.prepare(
    `SELECT COALESCE(MAX(position), 0) as next_pos FROM set_tracks WHERE set_id = ?`
  ).bind(setId).first<{ next_pos: number }>();

  await env.WKRP_DB.prepare(`
    INSERT OR IGNORE INTO set_tracks (set_id, track_id, position, played_at)
    VALUES (?, ?, ?, datetime('now'))
  `).bind(setId, body.track_id, (posResult?.next_pos ?? 0) + 1).run();

  log('DJ_SET_TRACK_ADDED', { set_id: setId, track_id: body.track_id });

  return Response.json({ ok: true });
}

/**
 * POST /api/sets/:id/end
 * End a live set.
 */
export async function handleEndSet(request: Request, env: Env, setId: string): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  const set = await env.WKRP_DB.prepare(
    'SELECT id, dj_id FROM dj_sets WHERE id = ? AND is_live = 1'
  ).bind(setId).first();

  if (!set) {
    return Response.json({ ok: false, error: 'Live set not found' }, { status: 404 });
  }
  if (set.dj_id !== auth.userId) {
    return Response.json({ ok: false, error: 'Not your set' }, { status: 403 });
  }

  await env.WKRP_DB.prepare(
    "UPDATE dj_sets SET is_live = 0, ended_at = datetime('now') WHERE id = ?"
  ).bind(setId).run();

  log('DJ_SET_ENDED', { set_id: setId });

  return Response.json({ ok: true });
}

/**
 * POST /api/attributions
 * Record that a listener discovered a track via a DJ.
 * Then push the track to the listener's connected music service.
 *
 * Body: { dj_id: string, track_id: string, event_id?: string }
 * Can be anonymous (no session) or authenticated.
 *
 * Flow:
 *   1. Record attribution in D1 (permanent — the DJ gets credit)
 *   2. Detect listener's connected platform (Spotify, Apple Music, or none)
 *   3. Push track to their library
 *   4. If event context, add to "Discovered at [venue]" playlist
 */
export async function handleCreateAttribution(request: Request, env: Env): Promise<Response> {
  let listenerId: string | null = null;

  // Try to get session (optional — anonymous attribution is OK)
  const token = getSessionToken(request);
  if (token) {
    const session = await getSession(env.WKRP_KV, token);
    if (session) listenerId = session.userId;
  }

  let body: { dj_id?: string; track_id?: string; event_id?: string };
  try {
    body = await request.json() as { dj_id?: string; track_id?: string; event_id?: string };
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.dj_id || !body.track_id) {
    return Response.json({ ok: false, error: 'dj_id and track_id required' }, { status: 400 });
  }

  const id = crypto.randomUUID();

  // 1. Record attribution (the permanent record)
  await env.WKRP_DB.prepare(`
    INSERT INTO attributions (id, dj_id, listener_id, track_id, event_id, attributed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).bind(id, body.dj_id, listenerId, body.track_id, body.event_id ?? null).run();

  log('ATTRIBUTION_CREATED', {
    id, dj_id: body.dj_id, listener_id: listenerId, track_id: body.track_id,
  });

  // 2. Push to listener's music service (if authenticated and connected)
  let pushResult = null;
  let discoveryPlaylistId = null;

  if (listenerId) {
    // Get track ISRC for Apple Music matching
    const track = await env.WKRP_DB.prepare(
      'SELECT isrc FROM tracks WHERE id = ?'
    ).bind(body.track_id).first<{ isrc: string | null }>();

    pushResult = await pushTrackToLibrary(
      env.WKRP_KV,
      listenerId,
      body.track_id,
      track?.isrc ?? null,
    );

    // 3. Add to discovery playlist if event context
    if (body.event_id) {
      // Try to get venue name from the DJ's live set
      const liveSet = await env.WKRP_DB.prepare(
        'SELECT venue_name FROM dj_sets WHERE dj_id = ? AND is_live = 1'
      ).bind(body.dj_id).first<{ venue_name: string | null }>();

      discoveryPlaylistId = await addToDiscoveryPlaylist(
        env.WKRP_DB,
        env.WKRP_KV,
        listenerId,
        body.track_id,
        liveSet?.venue_name ?? null,
        body.event_id,
      );
    }
  }

  return Response.json({
    ok: true,
    attribution: { id },
    push: pushResult ? {
      platform: pushResult.platform,
      saved: pushResult.saved,
    } : null,
    discovery_playlist_id: discoveryPlaylistId,
  }, { status: 201 });
}

/**
 * GET /dj/:id/stats
 * DJ influence stats — total attributions, unique listeners, top discovered tracks.
 */
export async function handleGetDjStats(_request: Request, env: Env, djId: string): Promise<Response> {
  const [totalResult, listenersResult, topTracksResult, setsResult] = await env.WKRP_DB.batch([
    env.WKRP_DB.prepare(
      'SELECT COUNT(*) as count FROM attributions WHERE dj_id = ?'
    ).bind(djId),
    env.WKRP_DB.prepare(
      'SELECT COUNT(DISTINCT listener_id) as count FROM attributions WHERE dj_id = ? AND listener_id IS NOT NULL'
    ).bind(djId),
    env.WKRP_DB.prepare(
      `SELECT t.id, t.name, t.artist, COUNT(*) as attribution_count
       FROM attributions a
       INNER JOIN tracks t ON a.track_id = t.id
       WHERE a.dj_id = ?
       GROUP BY t.id ORDER BY attribution_count DESC LIMIT 10`
    ).bind(djId),
    env.WKRP_DB.prepare(
      'SELECT COUNT(*) as count FROM dj_sets WHERE dj_id = ?'
    ).bind(djId),
  ]);

  const totalAttributions = (totalResult.results[0] as Record<string, unknown>)?.count as number ?? 0;
  const uniqueListeners = (listenersResult.results[0] as Record<string, unknown>)?.count as number ?? 0;
  const totalSets = (setsResult.results[0] as Record<string, unknown>)?.count as number ?? 0;

  return Response.json({
    ok: true,
    dj_id: djId,
    stats: {
      total_attributions: totalAttributions,
      unique_listeners: uniqueListeners,
      total_sets: totalSets,
      top_discovered_tracks: topTracksResult.results,
    },
  });
}

/**
 * GET /dj/:id/live
 * Get the DJ's current live set with tracks (for the scan page).
 */
export async function handleGetLiveSet(_request: Request, env: Env, djId: string): Promise<Response> {
  const dj = await env.WKRP_DB.prepare(
    'SELECT id, name, role FROM contributors WHERE id = ? AND role = ?'
  ).bind(djId, 'dj').first();

  if (!dj) {
    return Response.json({ ok: false, error: 'DJ not found' }, { status: 404 });
  }

  const liveSet = await env.WKRP_DB.prepare(
    'SELECT id, venue_name, started_at FROM dj_sets WHERE dj_id = ? AND is_live = 1'
  ).bind(djId).first();

  let tracks: unknown[] = [];
  if (liveSet) {
    const trackResult = await env.WKRP_DB.prepare(`
      SELECT t.id, t.name, t.artist, t.album, t.image_url, t.genre, st.played_at
      FROM set_tracks st
      INNER JOIN tracks t ON st.track_id = t.id
      WHERE st.set_id = ?
      ORDER BY st.position DESC
    `).bind(liveSet.id).all();
    tracks = trackResult.results;
  }

  return Response.json({
    ok: true,
    dj: { id: dj.id, name: dj.name },
    live_set: liveSet ? {
      id: liveSet.id,
      venue_name: liveSet.venue_name,
      started_at: liveSet.started_at,
      tracks,
    } : null,
  });
}

// --- Auth helper ---

async function authenticate(request: Request, env: Env): Promise<{ userId: string } | Response> {
  const token = getSessionToken(request);
  if (!token) {
    return Response.json({ ok: false, error: 'Authentication required' }, { status: 401 });
  }
  const session = await getSession(env.WKRP_KV, token);
  if (!session) {
    return Response.json({ ok: false, error: 'Session expired' }, { status: 401 });
  }
  return { userId: session.userId };
}
