/**
 * Architectural invariant — cross-product boundary (OSE-1299).
 *
 * BEHAVIORAL de-vacuuming of the OSE<->WKRP seam. The count-floor invariant
 * spec claims to "mirror cross-product-boundary.invariant.spec.ts", but that
 * spec did not exist and the only egress assertion anywhere was a string grep
 * for `sanitizeForExport` (presence, not behavior). This file asserts the seam
 * BEHAVIOR by driving the real handlers — mirroring count-floor.invariant.spec.ts
 * / ccr-invariants.test.ts CCR #9:
 *
 *   1. sets[] carry NO track_count and NO sub-date timestamp precision (FIX 1);
 *   2. listener-derived counts that cross are floored (K=5) / sub-K suppressed;
 *   3. both seams REQUIRE the service token — an unauthenticated call is 401
 *      BEFORE any DB read (FIX 3), so no venue/event_date existence oracle.
 *
 * Each assertion was born-red-verified by reverting its fix (see OSE-1299 PR).
 */
import { describe, it, expect } from 'vitest';
import { handleGetEventMusic } from '../../src/handlers/events';
import { handleSponsorReport } from '../../src/handlers/sponsor';
import { COUNT_FLOOR } from '../../src/lib/count-floor';
import type { Env } from '../../src/types';

type Row = Record<string, unknown>;
const TOKEN = 'test-ose-integration-token';
const ABOVE = COUNT_FLOOR + 4;
const BELOW = COUNT_FLOOR - 1;

/** Env whose WKRP_DB.batch returns the given result sets in order, then .first(). */
function musicEnv(sets: Row[], attributions: Row[], topTracks: Row[]): Env {
  return {
    OSE_INTEGRATION_TOKEN: TOKEN,
    WKRP_DB: {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [{ results: sets }, { results: attributions }, { results: topTracks }],
    },
  } as unknown as Env;
}

/** Sponsor env: 4-result batch + a .first() for the event context row. */
function sponsorEnv(
  listeners: Row[],
  topTracks: Row[],
  djBreakdown: Row[],
  timeline: Row[],
  context: Row | null,
): Env {
  return {
    OSE_INTEGRATION_TOKEN: TOKEN,
    WKRP_DB: {
      prepare: () => ({ bind: () => ({ first: async () => context }) }),
      batch: async () => [
        { results: listeners },
        { results: topTracks },
        { results: djBreakdown },
        { results: timeline },
      ],
    },
  } as unknown as Env;
}

const authed = (url: string) => new Request(url, { headers: { Authorization: `Bearer ${TOKEN}` } });

// ===========================================================================
// (1) sets[] coarsening — no track_count, no sub-date precision.
// ===========================================================================
describe('cross-product boundary (1) — sets are coarsened', () => {
  it('the music seam sets carry NO track_count and NO sub-date timestamp precision', async () => {
    const env = musicEnv(
      [{ id: 's1', dj_id: 'd1', dj_name: 'DJ Nova', track_count: 9, started_at: '2026-09-10T21:30:00Z', ended_at: '2026-09-10T23:59:59Z' }],
      [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }],
      [],
    );
    const res = await handleGetEventMusic(authed('https://ourwkrp.com/api/events/evt1/music'), env, 'evt1');
    const body = (await res.json()) as { music: { sets: Row[] } };
    const set = body.music.sets[0];
    expect(set).not.toHaveProperty('track_count');
    expect(String(set.started_at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(set.started_at)).not.toMatch(/[T:]/);
    expect(String(set.ended_at)).not.toMatch(/[T:]/);
    // Named pole survives.
    expect(set.dj_name).toBe('DJ Nova');
  });
});

// ===========================================================================
// (2) listener-derived counts cross floored / sub-K suppressed.
// ===========================================================================
describe('cross-product boundary (2) — listener counts are floored / suppressed', () => {
  it('music seam suppresses sub-K distinct_listeners and drops sub-K track rows', async () => {
    const env = musicEnv(
      [],
      [{ total_attributions: ABOVE, distinct_listeners: BELOW, dj_count: 1 }],
      [
        { id: 't1', name: 'Popular', attribution_count: ABOVE, attributed_dj: 'DJ Nova' },
        { id: 't2', name: 'Niche', attribution_count: BELOW, attributed_dj: 'DJ Ember' },
      ],
    );
    const res = await handleGetEventMusic(authed('https://ourwkrp.com/api/events/evt1/music'), env, 'evt1');
    const body = (await res.json()) as { music: { stats: Row; top_tracks: Row[]; top_tracks_below_floor: number } };
    expect(body.music.stats.distinct_listeners).toBeNull();
    expect(body.music.stats.distinct_listeners_suppressed).toBe(true);
    expect(body.music.top_tracks).toHaveLength(1);
    expect(body.music.top_tracks_below_floor).toBe(1);
  });

  it('sponsor report suppresses sub-K distinct_listeners', async () => {
    const env = sponsorEnv(
      [{ count: BELOW }],
      [],
      [],
      [{ hour: '2026-09-10 21:00', count: ABOVE }],
      { venue_name: 'The Hall', started_at: '2026-09-10T21:00:00Z' },
    );
    const res = await handleSponsorReport(authed('https://ourwkrp.com/api/sponsors/evt1/report'), env, 'evt1');
    const body = (await res.json()) as { report: { summary: Row } };
    expect(body.report.summary.distinct_listeners).toBeNull();
    expect(body.report.summary.distinct_listeners_suppressed).toBe(true);
  });
});

// ===========================================================================
// (3) both seams REQUIRE the service token — 401 before any DB read.
// ===========================================================================
describe('cross-product boundary (3) — the seam requires the service token', () => {
  it('music seam: unauthenticated request is 401 UNAUTHORIZED', async () => {
    const env = musicEnv([], [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }], []);
    const res = await handleGetEventMusic(new Request('https://ourwkrp.com/api/events/evt1/music'), env, 'evt1');
    expect(res.status).toBe(401);
    expect((await res.json() as { code: string }).code).toBe('UNAUTHORIZED');
  });

  it('sponsor report: unauthenticated request is 401 — no venue/event_date oracle', async () => {
    const env = sponsorEnv([{ count: ABOVE }], [], [], [], { venue_name: 'The Hall', started_at: '2026-09-10T21:00:00Z' });
    const res = await handleSponsorReport(new Request('https://ourwkrp.com/api/sponsors/evt1/report'), env, 'evt1');
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('UNAUTHORIZED');
    // The 401 body must not carry event context (no existence oracle).
    expect(JSON.stringify(body)).not.toContain('The Hall');
    expect(JSON.stringify(body)).not.toContain('report');
  });

  it('both seams fail closed (401) when OSE_INTEGRATION_TOKEN is unset', async () => {
    const mEnv = musicEnv([], [{ total_attributions: ABOVE, distinct_listeners: ABOVE, dj_count: 1 }], []);
    delete (mEnv as { OSE_INTEGRATION_TOKEN?: string }).OSE_INTEGRATION_TOKEN;
    const mRes = await handleGetEventMusic(authed('https://ourwkrp.com/api/events/evt1/music'), mEnv, 'evt1');
    expect(mRes.status).toBe(401);

    const sEnv = sponsorEnv([{ count: ABOVE }], [], [], [], null);
    delete (sEnv as { OSE_INTEGRATION_TOKEN?: string }).OSE_INTEGRATION_TOKEN;
    const sRes = await handleSponsorReport(authed('https://ourwkrp.com/api/sponsors/evt1/report'), sEnv, 'evt1');
    expect(sRes.status).toBe(401);
  });
});
