/**
 * Sponsor Reporting handlers
 *
 * GET /api/sponsors/:eventId/report — engagement report for a sponsored event
 *
 * Verified engagement data backed by real attributions, published under the
 * uniform count floor (lib/count-floor.ts — OW facet of OSE-665/683/711):
 *   - DJs stay named — presenters opted into public attribution (the named
 *     pole); listeners are counts only (the boundary in lib/privacy.ts)
 *   - the report cuts the same taps three ways (per DJ, per hour, per track).
 *     Every cut, total and count of people is built from one set of counted
 *     taps: those in a group of at least K under all three cuts at once
 *     (lib/event-attributions.ts, shared with GET /api/events/:id/music). So
 *     every cut sums to the published total, and a tap in a group under the
 *     floor changes nothing in the report
 *   - rows under the floor are left out, never marked, and the report does not
 *     say how many were left out
 *   - a count under the floor (0 included) is { <name>: null,
 *     <name>_suppressed: true }
 */

import type { Env } from '../types';
import { log } from '../lib/logger';
import { requireCrossProductToken } from '../lib/cross-product-auth';
import { applyCountFloor, dropSubFloorRows, flooredFields, sumContributingBuckets, COUNT_FLOOR } from '../lib/count-floor';
import {
  eventAttributionsQuery,
  summariseEventAttributions,
  type EventAttributionRow,
} from '../lib/event-attributions';

/** Length of the top-track list. */
const TOP_TRACKS = 20;

/**
 * GET /api/sponsors/:eventId/report
 * Cross-product endpoint (service token) — the sponsor-facing engagement data.
 */
export async function handleSponsorReport(request: Request, env: Env, eventId: string): Promise<Response> {
  // Cross-product egress gate (OSE-1299): fail closed BEFORE any DB read, so
  // venue/event_date is no longer a bare existence oracle for arbitrary eventId.
  const unauthorized = requireCrossProductToken(request, env);
  if (unauthorized) return unauthorized;

  log('SPONSOR_REPORT', { event_id: eventId });

  const [attributionsResult] = await env.WKRP_DB.batch([eventAttributionsQuery(env, eventId)]);
  const counts = summariseEventAttributions((attributionsResult?.results ?? []) as unknown as EventAttributionRow[]);

  // Each list is built from the counted taps, so every row already clears the
  // floor; dropSubFloorRows stays as a second guard.
  const timeline = dropSubFloorRows(
    counts.byHour.map((h) => ({ hour: h.hour, count: h.count })),
    (r) => r.count,
  );
  const topTracks = dropSubFloorRows(
    counts.byTrack.slice(0, TOP_TRACKS).map((t) => ({
      name: t.track_name,
      artist: t.artist,
      genre: t.genre,
      attribution_count: t.attribution_count,
    })),
    (r) => r.attribution_count,
  );
  // DJ names are public by design; each DJ's count is a count of taps and
  // clears the floor. No per-DJ listener count is published: next to the
  // event's distinct_listeners, two of them would give the number of
  // listeners who tapped for both DJs, which can be under the floor.
  const djBreakdown = dropSubFloorRows(
    counts.byDj.map((d) => ({ dj_name: d.dj_name, dj_id: d.dj_id, attribution_count: d.attribution_count })),
    (r) => r.attribution_count,
  );

  // The total is the sum of the hourly rows that cleared the floor, floored
  // again; with every row built from the same counted taps it equals the sum
  // of the DJ rows and of all track rows too.
  const totalAttributions = applyCountFloor(sumContributingBuckets(timeline.rows, (r) => r.count));

  // Get event context from dj_sets if available
  const eventContext = await env.WKRP_DB.prepare(
    'SELECT venue_name, started_at FROM dj_sets WHERE event_id = ? ORDER BY started_at ASC, id ASC LIMIT 1'
  ).bind(eventId).first<{ venue_name: string; started_at: string }>();

  // Privacy boundary: sponsor reports show floored aggregates, never individual
  // identities. DJs are named (they opted into public attribution).
  return Response.json({
    ok: true,
    privacy: 'floored_aggregate_listeners_named_djs',
    report: {
      event_id: eventId,
      venue: eventContext?.venue_name ?? null,
      event_date: eventContext?.started_at ?? null,
      summary: {
        ...flooredFields('total_attributions', totalAttributions),
        ...flooredFields('distinct_listeners', counts.distinctListeners),
        ...flooredFields('total_djs', counts.djs),
        reporting_floor: COUNT_FLOOR,
      },
      top_tracks: topTracks.rows,
      dj_breakdown: djBreakdown.rows,
      timeline: timeline.rows,
      generated_at: new Date().toISOString(),
    },
  });
}
