/**
 * Sponsor Reporting handlers
 *
 * GET /api/sponsors/:eventId/report — engagement report for a sponsored event
 *
 * Verified engagement data backed by real attributions:
 *   - Total attributions during event
 *   - Unique QR scans (unique listeners)
 *   - Top discovered tracks
 *   - DJ performance breakdown
 *   - Platform breakdown (Spotify vs Apple Music)
 */

import type { Env } from '../types';
import { log } from '../lib/logger';

/**
 * GET /api/sponsors/:eventId/report
 * Public endpoint — sponsors can view their event's engagement data.
 */
export async function handleSponsorReport(_request: Request, env: Env, eventId: string): Promise<Response> {
  log('SPONSOR_REPORT', { event_id: eventId });

  const [
    totalResult,
    listenersResult,
    topTracksResult,
    djBreakdownResult,
    timelineResult,
  ] = await env.WKRP_DB.batch([
    // Total attributions for this event
    env.WKRP_DB.prepare(
      'SELECT COUNT(*) as count FROM attributions WHERE event_id = ?'
    ).bind(eventId),

    // Unique listeners
    env.WKRP_DB.prepare(
      'SELECT COUNT(DISTINCT listener_id) as count FROM attributions WHERE event_id = ? AND listener_id IS NOT NULL'
    ).bind(eventId),

    // Top discovered tracks
    env.WKRP_DB.prepare(
      `SELECT t.name, t.artist, t.genre, COUNT(*) as attribution_count
       FROM attributions a
       INNER JOIN tracks t ON a.track_id = t.id
       WHERE a.event_id = ?
       GROUP BY t.id ORDER BY attribution_count DESC LIMIT 20`
    ).bind(eventId),

    // DJ performance breakdown
    env.WKRP_DB.prepare(
      `SELECT c.name as dj_name, c.id as dj_id, COUNT(*) as attribution_count,
              COUNT(DISTINCT a.listener_id) as unique_listeners
       FROM attributions a
       INNER JOIN contributors c ON a.dj_id = c.id
       WHERE a.event_id = ?
       GROUP BY c.id ORDER BY attribution_count DESC`
    ).bind(eventId),

    // Hourly timeline
    env.WKRP_DB.prepare(
      `SELECT strftime('%Y-%m-%d %H:00', attributed_at) as hour, COUNT(*) as count
       FROM attributions
       WHERE event_id = ?
       GROUP BY hour ORDER BY hour ASC`
    ).bind(eventId),
  ]);

  const totalAttributions = (totalResult.results[0] as Record<string, unknown>)?.count as number ?? 0;
  const uniqueListeners = (listenersResult.results[0] as Record<string, unknown>)?.count as number ?? 0;

  // Get event context from dj_sets if available
  const eventContext = await env.WKRP_DB.prepare(
    'SELECT venue_name, started_at FROM dj_sets WHERE event_id = ? ORDER BY started_at ASC LIMIT 1'
  ).bind(eventId).first<{ venue_name: string; started_at: string }>();

  // Privacy boundary: sponsor reports show aggregates, never individual identities.
  // DJs are named (they opted into public attribution). Listeners are counts only.
  return Response.json({
    ok: true,
    privacy: 'aggregate_listeners_named_djs',
    report: {
      event_id: eventId,
      venue: eventContext?.venue_name ?? null,
      event_date: eventContext?.started_at ?? null,
      summary: {
        total_attributions: totalAttributions,
        unique_listeners: uniqueListeners,
        total_djs: djBreakdownResult.results.length,
      },
      top_tracks: topTracksResult.results,
      dj_breakdown: djBreakdownResult.results,
      timeline: timelineResult.results,
      generated_at: new Date().toISOString(),
    },
  });
}
