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

const TOKEN = 'test-ose-integration-token';

/**
 * Mock WKRP_DB.batch: returns the result sets the handler destructures, in
 * order. `trackCounts` is the per-track count over every track of the event
 * (no LIMIT), which the total is built from (OW-160).
 */
function makeEnv(sets: Row[], attributions: Row[], topTracks: Row[], trackCounts: Row[] = []): Env {
  return {
    OSE_INTEGRATION_TOKEN: TOKEN,
    WKRP_DB: {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [
        { results: sets },
        { results: attributions },
        { results: topTracks },
        { results: trackCounts },
      ],
    },
  } as unknown as Env;
}

/** Authorized cross-product request (OSE-1299): carries the service token. */
const req = () =>
  new Request('https://ourwkrp.com/api/events/evt1/music', {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

async function musicOf(env: Env) {
  const res = await handleGetEventMusic(req(), env, 'evt1');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { privacy: string; music: Record<string, unknown> };
  return body;
}

const ABOVE = COUNT_FLOOR + 4; // safely at/above floor
const BELOW = COUNT_FLOOR - 1; // safely below floor

describe('T-SEAM music export — named pole preserved', () => {
  it('keeps dj_name + set identity on sets (DJs are the named pole)', async () => {
    const env = makeEnv(
      [{ id: 's1', dj_id: 'd1', dj_name: 'DJ Nova', venue_name: 'The Hall', track_count: 12, started_at: '2026-09-10T21:30:00Z', ended_at: '2026-09-10T23:45:00Z' }],
      [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }],
      [],
    );
    const { music } = await musicOf(env);
    const sets = music.sets as Row[];
    expect(sets[0].dj_name).toBe('DJ Nova');
    expect(sets[0].dj_id).toBe('d1');
    expect(sets[0].id).toBe('s1');
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

// ===========================================================================
// OSE-1299 FIX 1 — sets[] are coarsened (differencing vector against the
// sibling sponsor attendance timeline).
// ===========================================================================
describe('T-SEAM music export — sets are coarsened before egress (OSE-1299)', () => {
  const oneSet = (over: Row = {}): Row[] => [
    {
      id: 's1',
      dj_id: 'd1',
      dj_name: 'DJ Nova',
      venue_name: 'The Hall',
      track_count: 12,
      started_at: '2026-09-10T21:30:00Z',
      ended_at: '2026-09-10T23:45:00Z',
      ...over,
    },
  ];

  it('drops track_count entirely (per-set small-integer fingerprint)', async () => {
    const env = makeEnv(oneSet(), [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }], []);
    const { music } = await musicOf(env);
    const sets = music.sets as Row[];
    expect(sets[0]).not.toHaveProperty('track_count');
  });

  it('coarsens started_at/ended_at to date granularity (no sub-date precision)', async () => {
    const env = makeEnv(oneSet(), [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }], []);
    const { music } = await musicOf(env);
    const sets = music.sets as Row[];
    // Exactly YYYY-MM-DD — no time component survives.
    expect(sets[0].started_at).toBe('2026-09-10');
    expect(sets[0].ended_at).toBe('2026-09-10');
    expect(String(sets[0].started_at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(sets[0].started_at)).not.toMatch(/[T:]/);
    expect(String(sets[0].ended_at)).not.toMatch(/[T:]/);
  });

  it('nulls a missing timestamp rather than widening precision', async () => {
    const env = makeEnv(oneSet({ ended_at: null }), [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }], []);
    const { music } = await musicOf(env);
    const sets = music.sets as Row[];
    expect(sets[0].ended_at).toBeNull();
  });
});

// ===========================================================================
// OSE-1299 FIX 3 — the seam requires the cross-product service token.
// ===========================================================================
describe('T-SEAM music export — requires the cross-product service token (OSE-1299)', () => {
  const dbEnv = () =>
    makeEnv(
      [{ id: 's1', dj_id: 'd1', dj_name: 'DJ Nova', track_count: 3, started_at: '2026-09-10T21:00:00Z', ended_at: '2026-09-10T22:00:00Z' }],
      [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }],
      [],
    );

  it('401 UNAUTHORIZED when no token is presented', async () => {
    const res = await handleGetEventMusic(
      new Request('https://ourwkrp.com/api/events/evt1/music'),
      dbEnv(),
      'evt1',
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('401 when the presented token does not match the secret', async () => {
    const res = await handleGetEventMusic(
      new Request('https://ourwkrp.com/api/events/evt1/music', {
        headers: { Authorization: 'Bearer wrong-token' },
      }),
      dbEnv(),
      'evt1',
    );
    expect(res.status).toBe(401);
  });

  it('fails closed (401) when OSE_INTEGRATION_TOKEN is unset in the env', async () => {
    const env = dbEnv();
    delete (env as { OSE_INTEGRATION_TOKEN?: string }).OSE_INTEGRATION_TOKEN;
    const res = await handleGetEventMusic(
      new Request('https://ourwkrp.com/api/events/evt1/music', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      env,
      'evt1',
    );
    expect(res.status).toBe(401);
  });

  it('accepts the token via the X-OSE-Integration header too', async () => {
    const res = await handleGetEventMusic(
      new Request('https://ourwkrp.com/api/events/evt1/music', {
        headers: { 'X-OSE-Integration': TOKEN },
      }),
      dbEnv(),
      'evt1',
    );
    expect(res.status).toBe(200);
  });
});

/**
 * OW-160 — the total is the sum of the tracks that each clear the floor.
 *
 * Before: total_attributions was the raw COUNT(*) floored as one number, next
 * to a top-track list with sub-floor tracks dropped. With exactly one track
 * dropped, total minus the listed tracks gave that track's count back. Now the
 * total sums only per-track counts that are each >= the floor, over every
 * track of the event (not just the top 25), the rule OW-158 applies to
 * /dj/:id/stats and OSE applies with floorTotalOfParts.
 */
describe('T-SEAM music export — total is the sum of floored tracks (OW-160)', () => {
  const tracksOf = (...counts: number[]) =>
    counts.map((n, i) => ({ id: `t${i}`, name: `Song ${i}`, artist: 'A', attribution_count: n, attributed_dj: 'DJ Nova' }));
  const perTrack = (...counts: number[]) => counts.map((n, i) => ({ track_id: `t${i}`, attribution_count: n }));
  const envFor = (...counts: number[]) => {
    const raw = counts.reduce((a, b) => a + b, 0);
    return makeEnv([], [{ total_attributions: raw, distinct_listeners: ABOVE, dj_count: 1 }], tracksOf(...counts), perTrack(...counts));
  };
  const publishedOf = async (env: Env) => {
    const { music } = await musicOf(env);
    return { stats: music.stats, top_tracks: music.top_tracks, below: music.top_tracks_below_floor };
  };

  it('neighbours one attribution apart on a sub-floor track publish the same thing', async () => {
    const a = await publishedOf(envFor(ABOVE, BELOW - 1));
    const b = await publishedOf(envFor(ABOVE, BELOW));
    expect(b).toEqual(a);
  });

  it('control: one attribution more on a track above the floor changes the total', async () => {
    const a = await publishedOf(envFor(ABOVE, BELOW));
    const b = await publishedOf(envFor(ABOVE + 1, BELOW));
    expect((b.stats as Row).total_attributions).toBe((a.stats as Row).total_attributions as number + 1);
  });

  it('total minus the listed tracks never gives a dropped track back', async () => {
    const { music } = await musicOf(envFor(ABOVE, ABOVE + 2, BELOW));
    const stats = music.stats as Row;
    const listed = (music.top_tracks as Row[]).reduce((s, t) => s + Number(t.attribution_count), 0);
    expect(stats.total_attributions).toBe(listed);
  });

  it('counts tracks beyond the top-25 list that clear the floor', async () => {
    const counts = Array.from({ length: 26 }, () => ABOVE);
    const env = makeEnv(
      [],
      [{ total_attributions: 26 * ABOVE, distinct_listeners: ABOVE, dj_count: 1 }],
      tracksOf(...counts.slice(0, 25)),
      perTrack(...counts),
    );
    const { music } = await musicOf(env);
    expect((music.stats as Row).total_attributions).toBe(26 * ABOVE);
  });

  it('is null and suppressed when no track clears the floor, even if the raw total would', async () => {
    const { music } = await musicOf(envFor(BELOW, BELOW, BELOW));
    const stats = music.stats as Row;
    expect(stats.total_attributions).toBeNull();
    expect(stats.total_attributions_suppressed).toBe(true);
  });
});
