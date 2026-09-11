/**
 * Unit tests — cross-product music seam count floor (OSE-1295 / T-SEAM).
 *
 * GET /api/events/:id/music is a cross-product export to OSE. The contract:
 *   - DJs are the NAMED POLE (opted-in public attribution) → names stay.
 *   - Every listener-derived count takes the uniform floor OSE applies
 *     (count-floor.ts — OSE-665/683/711), so the seam can't disclose a small
 *     cohort OSE's own surfaces suppress.
 *   - Listener PII never crosses.
 *
 * Before the fix the handler returned distinct_listeners / attribution_count raw
 * under privacy:'aggregate_only' — the leak. These tests were born red on
 * distinct_listeners suppression, top-track drop, and the privacy label.
 */
import { describe, it, expect } from 'vitest';
import { handleGetEventMusic } from '../../src/handlers/events';
import { COUNT_FLOOR } from '../../src/lib/count-floor';
import type { Env } from '../../src/types';

type Row = Record<string, unknown>;

/** Mock WKRP_DB.batch: returns the three result sets the handler destructures. */
function makeEnv(sets: Row[], attributions: Row[], topTracks: Row[]): Env {
  return {
    WKRP_DB: {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [
        { results: sets },
        { results: attributions },
        { results: topTracks },
      ],
    },
  } as unknown as Env;
}

const req = () => new Request('https://ourwkrp.com/api/events/evt1/music');

async function musicOf(env: Env) {
  const res = await handleGetEventMusic(req(), env, 'evt1');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { privacy: string; music: Record<string, unknown> };
  return body;
}

const ABOVE = COUNT_FLOOR + 4; // safely at/above floor
const BELOW = COUNT_FLOOR - 1; // safely below floor

describe('T-SEAM music export — named pole preserved', () => {
  it('keeps dj_name on sets (DJs are the named pole)', async () => {
    const env = makeEnv(
      [{ id: 's1', dj_id: 'd1', dj_name: 'DJ Nova', venue_name: 'The Hall', track_count: 12 }],
      [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }],
      [],
    );
    const { music } = await musicOf(env);
    const sets = music.sets as Row[];
    expect(sets[0].dj_name).toBe('DJ Nova');
  });

  it('keeps attributed_dj on surviving top tracks', async () => {
    const env = makeEnv(
      [],
      [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }],
      [{ id: 't1', name: 'Song', artist: 'A', attribution_count: ABOVE, attributed_dj: 'DJ Nova' }],
    );
    const { music } = await musicOf(env);
    const tracks = music.top_tracks as Row[];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].attributed_dj).toBe('DJ Nova');
  });
});

describe('T-SEAM music export — listener-derived counts floored', () => {
  it('suppresses distinct_listeners below the floor', async () => {
    const env = makeEnv([], [{ total_attributions: ABOVE, distinct_listeners: BELOW, dj_count: 1 }], []);
    const { music } = await musicOf(env);
    const stats = music.stats as Row;
    expect(stats.distinct_listeners).toBeNull();
    expect(stats.distinct_listeners_suppressed).toBe(true);
    expect(stats.reporting_floor).toBe(COUNT_FLOOR);
  });

  it('publishes distinct_listeners at/above the floor exactly', async () => {
    const env = makeEnv([], [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }], []);
    const { music } = await musicOf(env);
    const stats = music.stats as Row;
    expect(stats.distinct_listeners).toBe(ABOVE);
    expect(stats.distinct_listeners_suppressed).toBe(false);
  });

  it('suppresses total_attributions below the floor', async () => {
    const env = makeEnv([], [{ total_attributions: BELOW, distinct_listeners: BELOW, dj_count: 1 }], []);
    const { music } = await musicOf(env);
    const stats = music.stats as Row;
    expect(stats.total_attributions).toBeNull();
    expect(stats.total_attributions_suppressed).toBe(true);
  });

  it('drops sub-floor top-track rows and reports the count without naming them', async () => {
    const env = makeEnv(
      [],
      [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }],
      [
        { id: 't1', name: 'Popular', attribution_count: ABOVE, attributed_dj: 'DJ Nova' },
        { id: 't2', name: 'Niche', attribution_count: BELOW, attributed_dj: 'DJ Ember' },
      ],
    );
    const { music } = await musicOf(env);
    const tracks = music.top_tracks as Row[];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe('t1');
    expect(music.top_tracks_below_floor).toBe(1);
  });
});

describe('T-SEAM music export — labels and listener PII', () => {
  it('labels the response as floored aggregates with named DJs', async () => {
    const env = makeEnv([], [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 0 }], []);
    const body = await musicOf(env);
    expect(body.privacy).toBe('floored_aggregate_listeners_named_djs');
  });

  it('never leaks listener identity fields that slip into a track row', async () => {
    const env = makeEnv(
      [],
      [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }],
      [{ id: 't1', name: 'Song', attribution_count: ABOVE, attributed_dj: 'DJ Nova', listener_id: 'L-secret' }],
    );
    const { music } = await musicOf(env);
    const tracks = music.top_tracks as Row[];
    expect(tracks[0]).not.toHaveProperty('listener_id');
  });
});
