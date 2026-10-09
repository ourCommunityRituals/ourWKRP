/**
 * OurSharedEvents integration handlers
 *
 * GET /api/events/:id/music — all music data for an OSE event
 *
 * Cross-product integration: ourWKRP provides the music layer,
 * OurSharedEvents provides the event context. This endpoint lets
 * OSE embed music data in event recaps and post-event summaries.
 */

import type { Env } from '../types';
import { sanitizeForExport, coarsenSets } from '../lib/privacy';
import { requireCrossProductToken } from '../lib/cross-product-auth';
import { applyCountFloor, dropSubFloorRows, sumContributingBuckets } from '../lib/count-floor';
import { log } from '../lib/logger';

/**
 * GET /api/events/:id/music
 * All attributions, sets, and tracks for an OurSharedEvents event.
 * OSE can call this to get the music layer for event recaps.
 */
export async function handleGetEventMusic(request: Request, env: Env, eventId: string): Promise<Response> {
  // Cross-product egress gate (OSE-1299): fail closed BEFORE any DB read, so
  // this seam is neither an unauthenticated export nor an existence oracle.
  const unauthorized = requireCrossProductToken(request, env);
  if (unauthorized) return unauthorized;

  log('EVENT_MUSIC_QUERY', { event_id: eventId });

  const [setsResult, attributionsResult, topTracksResult, trackCountsResult] = await env.WKRP_DB.batch([
    // All DJ sets for this event
    env.WKRP_DB.prepare(
      `SELECT ds.id, ds.dj_id, c.name as dj_name, ds.venue_name,
              ds.started_at, ds.ended_at,
              (SELECT COUNT(*) FROM set_tracks WHERE set_id = ds.id) as track_count
       FROM dj_sets ds
       INNER JOIN contributors c ON ds.dj_id = c.id
       WHERE ds.event_id = ?
       ORDER BY ds.started_at ASC, ds.id ASC`
    ).bind(eventId),

    // Listener and DJ counts (the attribution total is built below, OW-160)
    env.WKRP_DB.prepare(
      `SELECT COUNT(DISTINCT listener_id) as distinct_listeners,
              COUNT(DISTINCT dj_id) as dj_count
       FROM attributions WHERE event_id = ?`
    ).bind(eventId),

    // Top tracks discovered at this event
    env.WKRP_DB.prepare(
      `SELECT t.id, t.name, t.artist, t.album, t.genre, t.image_url,
              COUNT(*) as attribution_count,
              c.name as attributed_dj
       FROM attributions a
       INNER JOIN tracks t ON a.track_id = t.id
       INNER JOIN contributors c ON a.dj_id = c.id
       WHERE a.event_id = ?
       GROUP BY t.id ORDER BY attribution_count DESC, t.id ASC LIMIT 25`
    ).bind(eventId),

    // Per-track counts over EVERY track of the event (no LIMIT): the total is
    // built from these, so tracks past the top 25 still count (OW-160).
    env.WKRP_DB.prepare(
      `SELECT track_id, COUNT(*) as attribution_count
       FROM attributions WHERE event_id = ?
       GROUP BY track_id`
    ).bind(eventId),
  ]);

  const stats = attributionsResult.results[0] as Record<string, unknown> ?? {};
  const attributionCountOf = (r: unknown): number =>
    Number((r as Record<string, unknown>).attribution_count ?? 0);

  // Privacy boundary: this endpoint is a cross-product export to OSE. DJs are the
  // named pole (opted-in public attribution) and stay named; every listener-derived
  // count takes the SAME uniform floor OSE applies (count-floor.ts — OSE-665/683/711),
  // so this seam can't become the side channel that discloses a small cohort OSE's own
  // surfaces suppress. Listener PII never crosses (sanitizeForExport).
  //   - distinct_listeners: one count of people, floored.
  //   - total_attributions: the sum of the tracks that each clear the floor
  //     (drop before sum, OW-160), so the total minus the listed tracks never
  //     gives a dropped track's count back.
  const distinctListeners = applyCountFloor(Number(stats.distinct_listeners ?? 0));
  const totalAttributions = applyCountFloor(
    sumContributingBuckets((trackCountsResult?.results ?? []) as Record<string, unknown>[], attributionCountOf),
  );
  const topTracks = dropSubFloorRows(
    sanitizeForExport(topTracksResult.results as Record<string, unknown>[]),
    attributionCountOf,
  );

  // Coarsen sets before egress (OSE-1299): drop per-set track_count and reduce
  // started_at/ended_at to date granularity — they are a differencing vector
  // against the sibling sponsor attendance timeline. DJ name/id + set identity
  // (the named pole) are preserved.
  const sets = coarsenSets(setsResult.results as Record<string, unknown>[]);

  return Response.json({
    ok: true,
    event_id: eventId,
    privacy: 'floored_aggregate_listeners_named_djs',
    music: {
      sets,
      stats: {
        total_attributions: totalAttributions.count,
        total_attributions_suppressed: totalAttributions.suppressed,
        distinct_listeners: distinctListeners.count,
        distinct_listeners_suppressed: distinctListeners.suppressed,
        dj_count: stats.dj_count ?? 0,
        reporting_floor: distinctListeners.floor,
      },
      top_tracks: topTracks.rows,
      top_tracks_below_floor: topTracks.suppressed_rows,
    },
    links: {
      sponsor_report: `/api/sponsors/${eventId}/report`,
      event_page: `https://oursharedevents.com/events/${eventId}`,
    },
  });
}
