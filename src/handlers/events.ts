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
import { dropSubFloorRows, flooredFields, roundForPublish, COUNT_FLOOR } from '../lib/count-floor';
import {
  eventAttributionsQuery,
  summariseEventAttributions,
  type EventAttributionRow,
} from '../lib/event-attributions';
import { log } from '../lib/logger';

/** Length of the top-track list. */
const TOP_TRACKS = 25;

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

  const [setsResult, attributionsResult] = await env.WKRP_DB.batch([
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

    // Every attribution of the event; floored below, the same way the sponsor
    // report floors them.
    eventAttributionsQuery(env, eventId),
  ]);

  // Privacy boundary: this endpoint is a cross-product export to OSE. DJs are the
  // named pole (opted-in public attribution) and stay named; every count of
  // listeners, taps or DJs takes the uniform floor (count-floor.ts, K = 5).
  // Every figure below is built from the same counted taps as the sponsor
  // report (lib/event-attributions.ts): taps that sit in a group of at least K
  // per DJ, per hour and per track. So:
  //   - total_attributions is the sum of the listed tracks' counts (plus any
  //     tracks past the top 25, each at least K);
  //   - distinct_listeners and dj_count count the same taps;
  //   - a tap in a group under the floor changes nothing in the response, and
  //     no count of the groups left out is published.
  // A count under the floor is { <name>: null, <name>_suppressed: true }; 0 reads
  // the same as 1 to 4. Listener PII never crosses (sanitizeForExport).
  const counts = summariseEventAttributions((attributionsResult?.results ?? []) as unknown as EventAttributionRow[]);
  const topTracks = dropSubFloorRows(
    sanitizeForExport(
      counts.byTrack.slice(0, TOP_TRACKS).map((t) => ({
        id: t.track_id,
        name: t.track_name,
        artist: t.artist,
        album: t.album,
        genre: t.genre,
        image_url: t.image_url,
        attribution_count: t.attribution_count,
        attributed_dj: t.attributed_dj,
      })),
    ),
    (r) => Number(r.attribution_count),
  );

  // Coarsen sets before egress (OSE-1299): drop per-set track_count and reduce
  // started_at/ended_at to date granularity — they are a differencing vector
  // against the sibling sponsor timeline. DJ name/id + set identity (the named
  // pole) are preserved.
  const sets = coarsenSets(setsResult.results as Record<string, unknown>[]);

  return Response.json({
    ok: true,
    event_id: eventId,
    privacy: 'floored_aggregate_listeners_named_djs',
    music: {
      sets,
      stats: {
        ...flooredFields('total_attributions', counts.total),
        ...flooredFields('distinct_listeners', counts.distinctListeners),
        ...flooredFields('dj_count', counts.djs),
        reporting_floor: COUNT_FLOOR,
      },
      // Each listed track's count is rounded down to a multiple of 5, like every
      // count above (owner ruling 2026-11-18).
      top_tracks: topTracks.rows.map((t) => ({ ...t, attribution_count: roundForPublish(Number(t.attribution_count)) })),
    },
    links: {
      sponsor_report: `/api/sponsors/${eventId}/report`,
      event_page: `https://oursharedevents.com/events/${eventId}`,
    },
  });
}
