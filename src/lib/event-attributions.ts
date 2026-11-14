/**
 * One event's attributions, floored once for every route that publishes them.
 *
 * GET /api/events/:id/music and GET /api/sponsors/:id/report both go to the
 * same reader (the OurSharedEvents service) and publish counts of the same
 * taps cut three ways: per DJ, per hour, per track. Flooring each cut on its
 * own is not enough, because a tap dropped from one cut still counts in
 * another (the per-hour sum minus the per-DJ sum would give back a dropped
 * DJ's taps). So both routes start from the same rows:
 *
 *   1. load every attribution of the event (one query, below);
 *   2. keep only the taps that sit in a group of at least COUNT_FLOOR under
 *      every cut at once (floorAcrossCuts in count-floor.ts);
 *   3. build every row list, total and count of people from those taps only.
 *
 * Every published cut then sums to the same total, and a tap in a group under
 * the floor changes nothing either route publishes.
 */

import type { Env } from '../types';
import {
  applyCountFloor,
  floorAcrossCuts,
  floorTotalOfParts,
  groupSizes,
  type FlooredCount,
} from './count-floor';

export interface EventAttributionRow {
  dj_id: string;
  dj_name: string;
  listener_id: string | null;
  track_id: string;
  track_name: string;
  artist: string;
  album: string | null;
  genre: string | null;
  image_url: string | null;
  /** Hour bucket, 'YYYY-MM-DD HH:00' (the timeline's granularity). */
  hour: string | null;
}

/** Every attribution of one event, with the names the routes publish. */
export function eventAttributionsQuery(env: Env, eventId: string): D1PreparedStatement {
  return env.WKRP_DB.prepare(
    `SELECT a.dj_id, c.name AS dj_name, a.listener_id, a.track_id,
            t.name AS track_name, t.artist, t.album, t.genre, t.image_url,
            strftime('%Y-%m-%d %H:00', a.attributed_at) AS hour
     FROM attributions a
     INNER JOIN tracks t ON a.track_id = t.id
     INNER JOIN contributors c ON a.dj_id = c.id
     WHERE a.event_id = ?
     ORDER BY a.id ASC`
  ).bind(eventId);
}

export interface EventTrackCount {
  track_id: string;
  track_name: string;
  artist: string;
  album: string | null;
  genre: string | null;
  image_url: string | null;
  attribution_count: number;
  /** The DJ with the most counted taps on this track (ties: lowest dj_id). */
  attributed_dj: string;
}

export interface EventDjCount {
  dj_id: string;
  dj_name: string;
  attribution_count: number;
}

export interface EventHourCount {
  hour: string | null;
  count: number;
}

export interface EventCounts {
  /** Sum of the counted taps (every cut below sums to it). */
  total: FlooredCount;
  /** Distinct signed-in listeners among the counted taps. */
  distinctListeners: FlooredCount;
  /** DJs with counted taps. */
  djs: FlooredCount;
  /** Per track, most taps first, then track id. */
  byTrack: EventTrackCount[];
  /** Per DJ, most taps first, then DJ id. */
  byDj: EventDjCount[];
  /** Per hour, in time order. */
  byHour: EventHourCount[];
}

const byDjKey = (r: EventAttributionRow): string => r.dj_id;
const byHourKey = (r: EventAttributionRow): string => String(r.hour);
const byTrackKey = (r: EventAttributionRow): string => r.track_id;

/** Floor one event's taps across the three cuts and build what the routes publish. */
export function summariseEventAttributions(raw: readonly EventAttributionRow[]): EventCounts {
  const rows = floorAcrossCuts(raw, [byDjKey, byHourKey, byTrackKey]);

  // Per track, with the DJ who drove the most counted taps on it.
  const trackMeta = new Map<string, EventAttributionRow>();
  const trackDjTaps = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!trackMeta.has(r.track_id)) trackMeta.set(r.track_id, r);
    const perDj = trackDjTaps.get(r.track_id) ?? new Map<string, number>();
    perDj.set(r.dj_id, (perDj.get(r.dj_id) ?? 0) + 1);
    trackDjTaps.set(r.track_id, perDj);
  }
  const djNames = new Map(rows.map((r) => [r.dj_id, r.dj_name]));
  const byTrack: EventTrackCount[] = [...groupSizes(rows, byTrackKey)].map(([trackId, n]) => {
    const meta = trackMeta.get(trackId) as EventAttributionRow;
    let topDj = '';
    let topTaps = 0;
    for (const [djId, taps] of trackDjTaps.get(trackId) ?? []) {
      if (taps > topTaps || (taps === topTaps && compare(djId, topDj) < 0)) {
        topDj = djId;
        topTaps = taps;
      }
    }
    return {
      track_id: trackId,
      track_name: meta.track_name,
      artist: meta.artist,
      album: meta.album,
      genre: meta.genre,
      image_url: meta.image_url,
      attribution_count: n,
      attributed_dj: djNames.get(topDj) as string,
    };
  });
  byTrack.sort((a, b) => b.attribution_count - a.attribution_count || compare(a.track_id, b.track_id));

  const byDj: EventDjCount[] = [...groupSizes(rows, byDjKey)].map(([djId, n]) => ({
    dj_id: djId,
    dj_name: djNames.get(djId) as string,
    attribution_count: n,
  }));
  byDj.sort((a, b) => b.attribution_count - a.attribution_count || compare(a.dj_id, b.dj_id));

  const hourOf = new Map(rows.map((r) => [byHourKey(r), r.hour]));
  const byHour: EventHourCount[] = [...groupSizes(rows, byHourKey)].map(([key, n]) => ({
    hour: hourOf.get(key) ?? null,
    count: n,
  }));
  byHour.sort((a, b) => compare(String(a.hour), String(b.hour)));

  const listeners = new Set(rows.map((r) => r.listener_id).filter((id): id is string => id !== null));

  return {
    total: floorTotalOfParts(byTrack.map((t) => t.attribution_count)),
    distinctListeners: applyCountFloor(listeners.size),
    djs: applyCountFloor(byDj.length),
    byTrack,
    byDj,
    byHour,
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
