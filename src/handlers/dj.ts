/**
 * DJ Attribution handlers
 *
 * GET  /dj/:id/live       — live set JSON: tracks played so far, plus
 *                            `now_playing` (the set's open playback event, or null)
 * GET  /dj/:id/stats      — DJ influence stats JSON
 * POST /api/sets           — start a live set (ends the DJ's previous live set
 *                            and closes its open playback event)
 * POST /api/sets/:id/tracks — the set's DJ logs the song now playing: closes the
 *                            open playback event and opens a new one, returned
 *                            as `playback_event: { id }`
 * POST /api/sets/:id/end   — end a live set (closes its open playback event)
 * POST /api/attributions   — record a discovery attribution
 *
 * Playback events (migration 0011, OW-219). Each play of a song in a set is its
 * own `playback_events` row with its own id, so a replay of the same song is a
 * new event, and "the song playing now" is named by an id, never inferred from
 * a timestamp. The rules:
 *   - Only the DJ who owns the live set changes the song (session + ownership +
 *     live checks below). A listener never does.
 *   - Times are server time (`datetime('now')` in D1). No client clock is read.
 *   - A set has at most one open event (ended_at IS NULL), held by a unique
 *     partial index; closing the old one and opening the new one run in one
 *     D1 batch, so no reader sees two open or none in between.
 *   - Ending a set, or starting a new one, closes the open event in the same
 *     batch that ends the set.
 *   - brand_id is the owning DJ's contributors.brand_id.
 *   - set_tracks (one row per song per set) is still written as before; the
 *     live page's track list reads it unchanged.
 */

import type { Env } from '../types';
import { getSession } from '../lib/kv-storage';
import { getSessionToken } from '../lib/session-cookie';
import { requireSession } from '../lib/require-session';
import { pushTrackToLibrary, addToDiscoveryPlaylist } from '../lib/music-push';
import { startSetBodySchema, addSetTrackBodySchema, createAttributionBodySchema } from '../lib/schemas';
import { validateBody } from '../lib/validate';
import { recordAudit } from '../lib/audit';
import { log } from '../lib/logger';
import { openSongVote, closeSongVote, songLabel } from '../lib/ose-vote-link';
import { applyCountFloor, dropSubFloorRows, sumContributingBuckets, COUNT_FLOOR } from '../lib/count-floor';

/**
 * POST /api/sets
 * Start a live DJ set. DJ must be authenticated.
 * Body: { venue_name?: string, event_id?: string }
 */
export async function handleStartSet(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  // Verify DJ role
  const contributor = await env.WKRP_DB.prepare(
    'SELECT id, role FROM contributors WHERE id = ?'
  ).bind(auth.userId).first();

  if (!contributor || contributor.role !== 'dj') {
    return Response.json({ ok: false, error: 'Only DJs can start sets' }, { status: 403 });
  }

  // End any existing live set, closing its open playback event in the same
  // batch (the playback update runs first, while the set still reads as live).
  await env.WKRP_DB.batch([
    env.WKRP_DB.prepare(
      `UPDATE playback_events SET ended_at = datetime('now')
        WHERE ended_at IS NULL
          AND set_id IN (SELECT id FROM dj_sets WHERE dj_id = ? AND is_live = 1)`
    ).bind(auth.userId),
    env.WKRP_DB.prepare(
      "UPDATE dj_sets SET is_live = 0, ended_at = datetime('now') WHERE dj_id = ? AND is_live = 1"
    ).bind(auth.userId),
  ]);

  const parsed = await validateBody(request, startSetBodySchema);
  const body = parsed instanceof Response ? { venue_name: null, event_id: null } : parsed;

  const setId = crypto.randomUUID();

  await env.WKRP_DB.prepare(`
    INSERT INTO dj_sets (id, dj_id, event_id, venue_name, started_at, is_live)
    VALUES (?, ?, ?, ?, datetime('now'), 1)
  `).bind(setId, auth.userId, body.event_id ?? null, body.venue_name ?? null).run();

  log('DJ_SET_STARTED', { set_id: setId, dj_id: auth.userId, venue: body.venue_name });
  await recordAudit(env, request, {
    action: 'set.start', resourceType: 'set', resourceId: setId,
    outcome: 'success', actorId: auth.userId,
  });

  return Response.json({
    ok: true,
    set: { id: setId, dj_id: auth.userId, venue_name: body.venue_name, is_live: true },
  }, { status: 201 });
}

/** The vote link of the set's open play, or null (OW-219). */
async function openPlayVote(env: Env, setId: string): Promise<string | null> {
  const row = await env.WKRP_DB.prepare(
    'SELECT vote_object_id FROM playback_events WHERE set_id = ? AND ended_at IS NULL'
  ).bind(setId).first<{ vote_object_id: string | null }>();
  return row?.vote_object_id ?? null;
}

/**
 * After a song is logged: close the last play's vote on OurSharedEvents, open
 * one for this play, and keep the link (lib/ose-vote-link.ts). Off by default;
 * a failure leaves the link empty and never fails the DJ's request.
 */
async function linkPlayVote(
  env: Env,
  oseEventId: string | null,
  previousObjectId: string | null,
  playbackEventId: string,
  trackId: string
): Promise<void> {
  await closeSongVote(env, oseEventId, previousObjectId);
  if (!oseEventId) return;
  const track = await env.WKRP_DB.prepare('SELECT name, artist FROM tracks WHERE id = ?')
    .bind(trackId).first<{ name: string; artist: string | null }>();
  if (!track?.name) return;
  const objectId = await openSongVote(env, oseEventId, songLabel(track.name, track.artist));
  if (!objectId) return;
  await env.WKRP_DB.prepare('UPDATE playback_events SET vote_object_id = ? WHERE id = ?')
    .bind(objectId, playbackEventId).run();
}

/**
 * POST /api/sets/:id/tracks
 * The set's DJ logs the song now playing.
 * Body: { track_id: string } — any other field (a time included) is dropped by
 * the schema; started_at is server time.
 *
 * One D1 batch: close the set's open playback event, open a new one with a
 * fresh id, and keep the set_tracks row (INSERT OR IGNORE, once per song per
 * set). Logging the same song again opens a new event: a replay.
 * Returns { ok: true, playback_event: { id } }.
 */
export async function handleAddSetTrack(request: Request, env: Env, setId: string): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  // Verify ownership
  const set = await env.WKRP_DB.prepare(
    'SELECT id, dj_id, is_live, event_id FROM dj_sets WHERE id = ? AND is_live = 1'
  ).bind(setId).first<{ id: string; dj_id: string; is_live: number; event_id: string | null }>();

  if (!set) {
    return Response.json({ ok: false, error: 'Live set not found' }, { status: 404 });
  }
  if (set.dj_id !== auth.userId) {
    return Response.json({ ok: false, error: 'Not your set' }, { status: 403 });
  }

  const parsed = await validateBody(request, addSetTrackBodySchema);
  if (parsed instanceof Response) return parsed;

  const body = parsed;

  // Get next position
  const posResult = await env.WKRP_DB.prepare(
    `SELECT COALESCE(MAX(position), 0) as next_pos FROM set_tracks WHERE set_id = ?`
  ).bind(setId).first<{ next_pos: number }>();

  const playbackEventId = crypto.randomUUID();

  // The song playing now, whose vote on OurSharedEvents closes with it (OW-219).
  const previous = await openPlayVote(env, setId);

  const results = await env.WKRP_DB.batch([
    // 1. Close the song that was playing.
    env.WKRP_DB.prepare(
      "UPDATE playback_events SET ended_at = datetime('now') WHERE set_id = ? AND ended_at IS NULL"
    ).bind(setId),
    // 2. Open the new play. The set must still be live and this DJ's at write
    //    time; brand_id comes from the owning DJ's contributor row.
    env.WKRP_DB.prepare(`
      INSERT INTO playback_events (id, set_id, track_id, brand_id, started_at, ended_at)
      SELECT ?, s.id, ?, c.brand_id, datetime('now'), NULL
        FROM dj_sets s
        INNER JOIN contributors c ON c.id = s.dj_id
       WHERE s.id = ? AND s.dj_id = ? AND s.is_live = 1
    `).bind(playbackEventId, body.track_id, setId, auth.userId),
    // 3. The set's song list, as before (one row per song per set).
    env.WKRP_DB.prepare(`
      INSERT OR IGNORE INTO set_tracks (set_id, track_id, position, played_at)
      VALUES (?, ?, ?, datetime('now'))
    `).bind(setId, body.track_id, (posResult?.next_pos ?? 0) + 1),
  ]);

  // The set ended between the check above and the batch: no event was opened.
  if ((results[1]?.meta?.changes ?? 0) === 0) {
    return Response.json({ ok: false, error: 'Live set not found' }, { status: 404 });
  }

  await linkPlayVote(env, set.event_id, previous, playbackEventId, body.track_id);

  log('DJ_SET_TRACK_ADDED', { set_id: setId, track_id: body.track_id, playback_event_id: playbackEventId });
  await recordAudit(env, request, {
    action: 'set.track.add', resourceType: 'set', resourceId: setId,
    outcome: 'success', actorId: auth.userId,
    meta: { track_id: body.track_id, playback_event_id: playbackEventId },
  });

  return Response.json({ ok: true, playback_event: { id: playbackEventId } });
}

/**
 * POST /api/sets/:id/end
 * End a live set.
 */
export async function handleEndSet(request: Request, env: Env, setId: string): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const set = await env.WKRP_DB.prepare(
    'SELECT id, dj_id, event_id FROM dj_sets WHERE id = ? AND is_live = 1'
  ).bind(setId).first<{ id: string; dj_id: string; event_id: string | null }>();

  if (!set) {
    return Response.json({ ok: false, error: 'Live set not found' }, { status: 404 });
  }
  if (set.dj_id !== auth.userId) {
    return Response.json({ ok: false, error: 'Not your set' }, { status: 403 });
  }

  const previous = await openPlayVote(env, setId);

  // End the set and close its open playback event in one batch.
  await env.WKRP_DB.batch([
    env.WKRP_DB.prepare(
      "UPDATE playback_events SET ended_at = datetime('now') WHERE set_id = ? AND ended_at IS NULL"
    ).bind(setId),
    env.WKRP_DB.prepare(
      "UPDATE dj_sets SET is_live = 0, ended_at = datetime('now') WHERE id = ?"
    ).bind(setId),
  ]);

  await closeSongVote(env, set.event_id, previous);

  log('DJ_SET_ENDED', { set_id: setId });
  await recordAudit(env, request, {
    action: 'set.end', resourceType: 'set', resourceId: setId,
    outcome: 'success', actorId: auth.userId,
  });

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

  const parsed = await validateBody(request, createAttributionBodySchema);
  if (parsed instanceof Response) return parsed;

  const body = parsed;

  const id = crypto.randomUUID();

  // 1. Record attribution (the permanent record)
  await env.WKRP_DB.prepare(`
    INSERT INTO attributions (id, dj_id, listener_id, track_id, event_id, attributed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).bind(id, body.dj_id, listenerId, body.track_id, body.event_id ?? null).run();

  log('ATTRIBUTION_CREATED', {
    id, dj_id: body.dj_id, listener_id: listenerId, track_id: body.track_id,
  });
  // actorId is null for the anonymous identity rung — the attribution still
  // credits the DJ (resource) without binding a real listener.
  await recordAudit(env, request, {
    action: 'attribution.create', resourceType: 'attribution', resourceId: id,
    outcome: 'success', actorId: listenerId,
    meta: { dj_id: body.dj_id, track_id: body.track_id },
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
      env.WKRP_ENCRYPTION_KEY,
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
 *
 * Public route, so every listener-derived figure takes the uniform floor
 * (lib/count-floor.ts, K = 5, the same rule OSE applies). The DJ is the named
 * pole; listeners are counts, never individuals. "None" and "1 to 4" read the
 * same: null with `_suppressed: true`.
 *   - unique_listeners: one count of people, floored, over the taps on tracks
 *     that clear the floor only (the same taps as the total), so a listener
 *     who tapped only a track under the floor changes nothing.
 *   - top tracks: a track under the floor is dropped, never shown as "3".
 *   - total_attributions: the sum of the tracks that each clear the floor
 *     (drop before sum), so the total minus the listed tracks never gives a
 *     dropped track's count back.
 *   - total_sets: the DJ's own sets, exact (not listener-derived).
 */
export async function handleGetDjStats(_request: Request, env: Env, djId: string): Promise<Response> {
  const [listenersResult, tracksResult, setsResult] = await env.WKRP_DB.batch([
    env.WKRP_DB.prepare(
      `SELECT COUNT(DISTINCT listener_id) as count FROM attributions
       WHERE dj_id = ? AND listener_id IS NOT NULL
         AND track_id IN (
           SELECT track_id FROM attributions WHERE dj_id = ?
           GROUP BY track_id HAVING COUNT(*) >= ?
         )`
    ).bind(djId, djId, COUNT_FLOOR),
    env.WKRP_DB.prepare(
      `SELECT t.id, t.name, t.artist, COUNT(*) as attribution_count
       FROM attributions a
       INNER JOIN tracks t ON a.track_id = t.id
       WHERE a.dj_id = ?
       GROUP BY t.id ORDER BY attribution_count DESC, t.id ASC`
    ).bind(djId),
    env.WKRP_DB.prepare(
      'SELECT COUNT(*) as count FROM dj_sets WHERE dj_id = ?'
    ).bind(djId),
  ]);

  const countOf = (r: unknown): number => Number((r as Record<string, unknown>).attribution_count ?? 0);
  const tracks = tracksResult.results as Record<string, unknown>[];
  const uniqueListeners = applyCountFloor(Number((listenersResult.results[0] as Record<string, unknown>)?.count ?? 0));
  const totalAttributions = applyCountFloor(sumContributingBuckets(tracks, countOf));
  const topTracks = dropSubFloorRows(tracks, countOf);
  const totalSets = Number((setsResult.results[0] as Record<string, unknown>)?.count ?? 0);

  return Response.json({
    ok: true,
    dj_id: djId,
    privacy: 'floored_aggregate_listeners_named_djs',
    stats: {
      total_attributions: totalAttributions.count,
      total_attributions_suppressed: totalAttributions.suppressed,
      unique_listeners: uniqueListeners.count,
      unique_listeners_suppressed: uniqueListeners.suppressed,
      total_sets: totalSets,
      top_discovered_tracks: topTracks.rows.slice(0, 10),
      reporting_floor: uniqueListeners.floor,
    },
  });
}

/** The open playback event of a live set, as /dj/:id/live returns it. */
interface NowPlaying {
  playback_event_id: string;
  started_at: string;
  track: { id: string; name: string; artist: string; album: string | null; image_url: string | null };
}

/**
 * GET /dj/:id/live
 * Get the DJ's current live set with tracks (for the scan page).
 *
 * `live_set.now_playing` is the set's open playback event —
 * { playback_event_id, started_at, track: { id, name, artist, album, image_url } }
 * — or null when no song is open. It carries no count of anything.
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
  let nowPlaying: NowPlaying | null = null;
  if (liveSet) {
    const [trackResult, openResult] = await env.WKRP_DB.batch([
      env.WKRP_DB.prepare(`
        SELECT t.id, t.name, t.artist, t.album, t.image_url, t.genre, st.played_at
        FROM set_tracks st
        INNER JOIN tracks t ON st.track_id = t.id
        WHERE st.set_id = ?
        ORDER BY st.position DESC
      `).bind(liveSet.id),
      env.WKRP_DB.prepare(`
        SELECT pe.id AS playback_event_id, pe.started_at,
               t.id AS track_id, t.name, t.artist, t.album, t.image_url
        FROM playback_events pe
        INNER JOIN tracks t ON pe.track_id = t.id
        WHERE pe.set_id = ? AND pe.ended_at IS NULL
      `).bind(liveSet.id),
    ]);
    tracks = trackResult.results;
    const open = (openResult.results as Record<string, unknown>[])[0];
    if (open) {
      nowPlaying = {
        playback_event_id: open.playback_event_id as string,
        started_at: open.started_at as string,
        track: {
          id: open.track_id as string,
          name: open.name as string,
          artist: open.artist as string,
          album: (open.album ?? null) as string | null,
          image_url: (open.image_url ?? null) as string | null,
        },
      };
    }
  }

  return Response.json({
    ok: true,
    dj: { id: dj.id, name: dj.name },
    live_set: liveSet ? {
      id: liveSet.id,
      venue_name: liveSet.venue_name,
      started_at: liveSet.started_at,
      now_playing: nowPlaying,
      tracks,
    } : null,
  });
}

