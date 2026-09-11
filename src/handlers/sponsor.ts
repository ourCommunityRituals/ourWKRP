/**
 * Sponsor Reporting handlers
 *
 * GET /api/sponsors/:eventId/report — engagement report for a sponsored event
 *
 * Verified engagement data backed by real attributions, published under the
 * uniform count floor (lib/count-floor.ts — OW facet of OSE-665/683/711):
 *   - DJs stay named — presenters opted into public attribution (the named
 *     pole); listeners are counts only (the boundary in lib/privacy.ts)
 *   - every listener-derived count is floored server-side; sub-K rows are
 *     DROPPED, never marked (a present-but-suppressed row still discloses
 *     "a small cohort was here")
 *   - the total is the sum of SURVIVING hourly buckets, so no published total
 *     can be differenced against the row list the same reader sees (OSE-683)
 */

import type { Env } from '../types';
import { log } from '../lib/logger';
import { applyCountFloor, dropSubFloorRows, sumContributingBuckets } from '../lib/count-floor';

/**
 * GET /api/sponsors/:eventId/report
 * Public endpoint — sponsors can view their event's engagement data.
 */
export async function handleSponsorReport(_request: Request, env: Env, eventId: string): Promise<Response> {
  log('SPONSOR_REPORT', { event_id: eventId });

  const [
    listenersResult,
    topTracksResult,
    djBreakdownResult,
    timelineResult,
  ] = await env.WKRP_DB.batch([
    // Unique listeners (floored below before it leaves the building)
    env.WKRP_DB.prepare(
      'SELECT COUNT(DISTINCT listener_id) as count FROM attributions WHERE event_id = ? AND listener_id IS NOT NULL'
    ).bind(eventId),

    // Top discovered tracks
    env.WKRP_DB.prepare(
      `SELECT t.name, t.artist, t.genre, COUNT(*) as attribution_count
       FROM attributions a
       INNER JOIN tracks t ON a.track_id = t.id
       WHERE a.event_id = ?
       GROUP BY t.id ORDER BY attribution_count DESC, t.id ASC LIMIT 20`
    ).bind(eventId),

    // DJ performance breakdown (DJ names are public by design; their
    // listener-derived counts still take the floor)
    env.WKRP_DB.prepare(
      `SELECT c.name as dj_name, c.id as dj_id, COUNT(*) as attribution_count,
              COUNT(DISTINCT a.listener_id) as distinct_listeners
       FROM attributions a
       INNER JOIN contributors c ON a.dj_id = c.id
       WHERE a.event_id = ?
       GROUP BY c.id ORDER BY attribution_count DESC, c.id ASC`
    ).bind(eventId),

    // Hourly timeline (hour granularity mirrors OSE scan_bucket; sub-K hours drop)
    env.WKRP_DB.prepare(
      `SELECT strftime('%Y-%m-%d %H:00', attributed_at) as hour, COUNT(*) as count
       FROM attributions
       WHERE event_id = ?
       GROUP BY hour ORDER BY hour ASC`
    ).bind(eventId),
  ]);

  const countOf = (r: unknown): number =>
    Number((r as Record<string, unknown>).attribution_count ?? (r as Record<string, unknown>).count ?? 0);

  // Floor every listener-derived figure before it reaches the response.
  const distinctListeners = applyCountFloor(countOf(listenersResult.results[0] ?? {}));
  const timeline = dropSubFloorRows(timelineResult.results as Record<string, unknown>[], countOf);
  const topTracks = dropSubFloorRows(topTracksResult.results as Record<string, unknown>[], countOf);

  // DJ rows: drop sub-floor presenters (their attribution_count discloses a
  // small cohort), keep names on survivors, and floor each survivor's per-DJ
  // distinct-listener count so a named DJ can't leak a tiny listener cohort.
  const djDropped = dropSubFloorRows(djBreakdownResult.results as Record<string, unknown>[], countOf);
  const djBreakdown = djDropped.rows.map((r) => ({
    ...r,
    distinct_listeners: applyCountFloor(Number(r.distinct_listeners ?? 0)).count,
  }));

  // Differencing-safe total: sum of surviving hourly buckets only (OSE-683).
  const totalAttributions = sumContributingBuckets(timelineResult.results as Record<string, unknown>[], countOf);

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
        total_attributions: totalAttributions,
        distinct_listeners: distinctListeners.count,
        distinct_listeners_suppressed: distinctListeners.suppressed,
        total_djs: djBreakdown.length,
        reporting_floor: distinctListeners.floor,
      },
      top_tracks: topTracks.rows,
      top_tracks_below_floor: topTracks.suppressed_rows,
      dj_breakdown: djBreakdown,
      djs_below_floor: djDropped.suppressed_rows,
      timeline: timeline.rows,
      hours_below_floor: timeline.suppressed_rows,
      generated_at: new Date().toISOString(),
    },
  });
}
