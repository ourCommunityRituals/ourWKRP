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
 *
 * OW-212: the handler now reads every attribution of the event and floors
 * them once across DJ, hour and track (lib/event-attributions.ts, shared with
 * the sponsor report), so the mock below returns tap rows, not counts.
 */
import { describe, it, expect } from 'vitest';
import { handleGetEventMusic } from '../../src/handlers/events';
import { COUNT_FLOOR } from '../../src/lib/count-floor';
import type { Env } from '../../src/types';

type Row = Record<string, unknown>;

const TOKEN = 'test-ose-integration-token';

/** One attribution row as eventAttributionsQuery returns it. */
function tap(o: { dj?: string; dj_name?: string; track?: string; track_name?: string; listener?: string | null; hour?: string } = {}): Row {
  return {
    dj_id: o.dj ?? 'd1',
    dj_name: o.dj_name ?? 'DJ Nova',
    listener_id: o.listener ?? null,
    track_id: o.track ?? 't1',
    track_name: o.track_name ?? `Song ${o.track ?? 't1'}`,
    artist: 'A',
    album: 'Album',
    genre: 'house',
    image_url: null,
    hour: o.hour ?? '2026-09-10 21:00',
  };
}

/** n taps on one track by one DJ in one hour; the first `named` from distinct listeners. */
function tapsOf(n: number, o: Parameters<typeof tap>[0] & { named?: number } = {}): Row[] {
  return Array.from({ length: n }, (_, i) =>
    tap({ ...o, listener: i < (o.named ?? 0) ? `L-${o.dj ?? 'd1'}-${o.track ?? 't1'}-${i}` : null })
  );
}

/** Mock WKRP_DB.batch: [sets, every attribution of the event]. */
function makeEnv(sets: Row[], taps: Row[]): Env {
  return {
    OSE_INTEGRATION_TOKEN: TOKEN,
    WKRP_DB: {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [{ results: sets }, { results: taps }],
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
      tapsOf(ABOVE, { named: ABOVE }),
    );
    const { music } = await musicOf(env);
    const sets = music.sets as Row[];
    expect(sets[0].dj_name).toBe('DJ Nova');
    expect(sets[0].dj_id).toBe('d1');
    expect(sets[0].id).toBe('s1');
  });

  it('keeps attributed_dj on surviving top tracks', async () => {
    const env = makeEnv([], tapsOf(ABOVE, { track: 't1', named: ABOVE }));
    const { music } = await musicOf(env);
    const tracks = music.top_tracks as Row[];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe('t1');
    expect(tracks[0].attributed_dj).toBe('DJ Nova');
  });

  it('names the DJ with the most counted taps on a track', async () => {
    const env = makeEnv([], [
      ...tapsOf(ABOVE, { dj: 'd1', dj_name: 'DJ Nova', track: 't1' }),
      ...tapsOf(ABOVE + 2, { dj: 'd2', dj_name: 'DJ Ember', track: 't1' }),
    ]);
    const { music } = await musicOf(env);
    expect((music.top_tracks as Row[])[0].attributed_dj).toBe('DJ Ember');
  });
});

describe('T-SEAM music export — listener-derived counts floored', () => {
  it('suppresses distinct_listeners below the floor', async () => {
    const env = makeEnv([], tapsOf(ABOVE, { named: BELOW }));
    const { music } = await musicOf(env);
    const stats = music.stats as Row;
    expect(stats.distinct_listeners).toBeNull();
    expect(stats.distinct_listeners_suppressed).toBe(true);
    expect(stats.reporting_floor).toBe(COUNT_FLOOR);
  });

  it('publishes distinct_listeners at/above the floor, rounded down to a multiple of 5', async () => {
    const env = makeEnv([], tapsOf(ABOVE, { named: ABOVE }));
    const { music } = await musicOf(env);
    const stats = music.stats as Row;
    expect(stats.distinct_listeners).toBe(ABOVE - (ABOVE % 5));
    expect(stats.distinct_listeners_suppressed).toBe(false);
  });

  it('suppresses total_attributions below the floor', async () => {
    const env = makeEnv([], tapsOf(BELOW, { named: BELOW }));
    const { music } = await musicOf(env);
    const stats = music.stats as Row;
    expect(stats.total_attributions).toBeNull();
    expect(stats.total_attributions_suppressed).toBe(true);
  });

  it('floors dj_count like every other count of people (OW-212)', async () => {
    const one = (await musicOf(makeEnv([], tapsOf(ABOVE)))).music.stats as Row;
    expect(one.dj_count).toBeNull();
    expect(one.dj_count_suppressed).toBe(true);

    const five = Array.from({ length: COUNT_FLOOR }, (_, d) => tapsOf(COUNT_FLOOR, { dj: `d${d}` })).flat();
    const many = (await musicOf(makeEnv([], five))).music.stats as Row;
    expect(many.dj_count).toBe(COUNT_FLOOR);
    expect(many.dj_count_suppressed).toBe(false);
  });

  it('drops sub-floor top-track rows and publishes no count of them (OW-212)', async () => {
    const env = makeEnv([], [
      ...tapsOf(ABOVE, { track: 't1', dj_name: 'DJ Nova' }),
      ...tapsOf(BELOW, { track: 't2', dj: 'd2', dj_name: 'DJ Ember' }),
    ]);
    const { music } = await musicOf(env);
    const tracks = music.top_tracks as Row[];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe('t1');
    expect(music).not.toHaveProperty('top_tracks_below_floor');
  });
});

describe('T-SEAM music export — labels and listener PII', () => {
  it('labels the response as floored aggregates with named DJs', async () => {
    const env = makeEnv([], tapsOf(ABOVE));
    const body = await musicOf(env);
    expect(body.privacy).toBe('floored_aggregate_listeners_named_djs');
  });

  it('never leaks listener identity fields', async () => {
    const env = makeEnv([], tapsOf(ABOVE, { named: ABOVE }));
    const res = await handleGetEventMusic(req(), env, 'evt1');
    const text = await res.text();
    expect(text).not.toContain('listener_id');
    expect(text).not.toContain('L-d1-t1-0');
  });
});

// ===========================================================================
// OSE-1299 FIX 1 — sets[] are coarsened (differencing vector against the
// sibling sponsor timeline).
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
    const env = makeEnv(oneSet(), tapsOf(ABOVE));
    const { music } = await musicOf(env);
    const sets = music.sets as Row[];
    expect(sets[0]).not.toHaveProperty('track_count');
  });

  it('coarsens started_at/ended_at to date granularity (no sub-date precision)', async () => {
    const env = makeEnv(oneSet(), tapsOf(ABOVE));
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
    const env = makeEnv(oneSet({ ended_at: null }), tapsOf(ABOVE));
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
      tapsOf(ABOVE),
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
  /** One DJ, one hour, track i gets counts[i] taps. */
  const envFor = (...counts: number[]) =>
    makeEnv([], counts.flatMap((n, i) => tapsOf(n, { track: `t${i}` })));

  it('neighbours one attribution apart on a sub-floor track publish the same thing', async () => {
    const a = await musicOf(envFor(ABOVE, BELOW - 1));
    const b = await musicOf(envFor(ABOVE, BELOW));
    expect(b).toEqual(a);
  });

  it('control: attributions on a track above the floor that cross a multiple of 5 change the total', async () => {
    const a = await musicOf(envFor(9, BELOW));
    const b = await musicOf(envFor(10, BELOW));
    expect((a.music.stats as Row).total_attributions).toBe(5);
    expect((b.music.stats as Row).total_attributions).toBe(10);
  });

  it('neighbours one attribution apart inside a step of 5 on a track above the floor publish the same thing', async () => {
    const a = await musicOf(envFor(6, BELOW));
    const b = await musicOf(envFor(7, BELOW));
    expect(b).toEqual(a);
  });

  it('total minus the listed tracks never gives a dropped track back', async () => {
    const { music } = await musicOf(envFor(ABOVE, ABOVE + 2, BELOW));
    const stats = music.stats as Row;
    const listed = (music.top_tracks as Row[]).reduce((s, t) => s + Number(t.attribution_count), 0);
    expect(stats.total_attributions).toBe(listed);
  });

  it('counts tracks beyond the top-25 list that clear the floor', async () => {
    const counts = Array.from({ length: 26 }, () => ABOVE);
    const { music } = await musicOf(envFor(...counts));
    expect(music.top_tracks as Row[]).toHaveLength(25);
    expect((music.stats as Row).total_attributions).toBe(26 * (ABOVE - (ABOVE % 5)));
  });

  it('is null and suppressed when no track clears the floor, even if the raw total would', async () => {
    const { music } = await musicOf(envFor(BELOW, BELOW, BELOW));
    const stats = music.stats as Row;
    expect(stats.total_attributions).toBeNull();
    expect(stats.total_attributions_suppressed).toBe(true);
  });
});
