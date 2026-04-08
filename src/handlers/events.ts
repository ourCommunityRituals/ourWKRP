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
import { sanitizeForExport } from '../lib/privacy';
import { log } from '../lib/logger';

/**
 * GET /api/events/:id/music
 * All attributions, sets, and tracks for an OurSharedEvents event.
 * OSE can call this to get the music layer for event recaps.
 */
export async function handleGetEventMusic(_request: Request, env: Env, eventId: string): Promise<Response> {
  log('EVENT_MUSIC_QUERY', { event_id: eventId });

  const [setsResult, attributionsResult, topTracksResult] = await env.WKRP_DB.batch([
    // All DJ sets for this event
    env.WKRP_DB.prepare(
      `SELECT ds.id, ds.dj_id, c.name as dj_name, ds.venue_name,
              ds.started_at, ds.ended_at,
              (SELECT COUNT(*) FROM set_tracks WHERE set_id = ds.id) as track_count
       FROM dj_sets ds
       INNER JOIN contributors c ON ds.dj_id = c.id
       WHERE ds.event_id = ?
       ORDER BY ds.started_at ASC`
    ).bind(eventId),

    // Total attribution stats
    env.WKRP_DB.prepare(
      `SELECT COUNT(*) as total_attributions,
              COUNT(DISTINCT listener_id) as unique_listeners,
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
       GROUP BY t.id ORDER BY attribution_count DESC LIMIT 25`
    ).bind(eventId),
  ]);

  const stats = attributionsResult.results[0] as Record<string, unknown> ?? {};

  // Privacy boundary: this endpoint crosses to OSE.
  // Strip listener PII — only aggregates and music data cross the boundary.
  const sanitizedTracks = sanitizeForExport(topTracksResult.results as Record<string, unknown>[]);

  return Response.json({
    ok: true,
    event_id: eventId,
    privacy: 'aggregate_only',
    music: {
      sets: setsResult.results,
      stats: {
        total_attributions: stats.total_attributions ?? 0,
        unique_listeners: stats.unique_listeners ?? 0,
        dj_count: stats.dj_count ?? 0,
      },
      top_tracks: sanitizedTracks,
    },
    links: {
      sponsor_report: `/api/sponsors/${eventId}/report`,
      event_page: `https://oursharedevents.com/events/${eventId}`,
    },
  });
}
