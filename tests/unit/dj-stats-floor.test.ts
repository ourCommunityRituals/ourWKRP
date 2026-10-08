/**
 * Unit tests: GET /dj/:id/stats takes the uniform count floor (K = 5).
 *
 * The route is public and listeners are counts, never individuals, so every
 * listener-derived figure is floored like OW's sponsor report and the OSE seam
 * (lib/count-floor.ts). Neighbour datasets one listener or one attribution
 * apart under the floor must give the same answer; a control above the floor
 * must move it. Owner ruling 2026-10-08: no exceptions to the under-5 rule.
 *
 * Born red against the handler on main at e4e2c16, which returned
 * unique_listeners, total_attributions and each track's count exactly.
 */
import { describe, it, expect } from 'vitest';
import { handleGetDjStats } from '../../src/handlers/dj';
import type { Env } from '../../src/types';

interface World {
  listeners: number;
  tracks: Record<string, number>;
  sets: number;
}

const BASE: World = { listeners: 7, tracks: { 'trk-a': 7, 'trk-b': 3, 'trk-c': 2 }, sets: 2 };

function envFor(w: World): Env {
  const trackRows = Object.entries(w.tracks)
    .map(([id, n]) => ({ id, name: `Track ${id}`, artist: 'Artist', attribution_count: n }))
    .sort((a, b) => b.attribution_count - a.attribution_count || a.id.localeCompare(b.id));
  return {
    WKRP_DB: {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [
        { results: [{ count: w.listeners }] },
        { results: trackRows },
        { results: [{ count: w.sets }] },
      ],
    },
  } as unknown as Env;
}

async function read(w: World): Promise<string> {
  const res = await handleGetDjStats(new Request('https://ourwkrp.com/dj/dj-1/stats'), envFor(w), 'dj-1');
  expect(res.status).toBe(200);
  return JSON.stringify(await res.json());
}

describe('GET /dj/:id/stats: one listener or attribution under the floor moves nothing', () => {
  const levers: Array<[string, World]> = [
    ['a track with 3 attributions gains a fourth', { ...BASE, tracks: { ...BASE.tracks, 'trk-b': 4 } }],
    ['a track with none gains its first', { ...BASE, tracks: { ...BASE.tracks, 'trk-d': 1 } }],
    ['a DJ with 3 listeners gains a fourth', { ...BASE, listeners: 3 }],
  ];
  for (const [name, world] of levers) {
    it(name, async () => {
      const before = await read(name.includes('listeners') ? { ...BASE, listeners: 4 } : BASE);
      const after = await read(world);
      expect(after).toBe(before);
    });
  }

  it('control: one more attribution on the track at 7 moves the answer', async () => {
    expect(await read({ ...BASE, tracks: { ...BASE.tracks, 'trk-a': 8 } })).not.toBe(await read(BASE));
  });

  it('the base publishes the track at 7 only, and its own sets exactly', async () => {
    const body = JSON.parse(await read(BASE)) as { stats: Record<string, unknown> };
    expect(body.stats.total_attributions).toBe(7);
    expect(body.stats.unique_listeners).toBe(7);
    expect((body.stats.top_discovered_tracks as { id: string }[]).map((t) => t.id)).toEqual(['trk-a']);
    expect(body.stats.total_sets).toBe(2);
    expect(body.stats.reporting_floor).toBe(5);
  });

  it('none and 1 to 4 read the same: null and suppressed', async () => {
    const zero = JSON.parse(await read({ listeners: 0, tracks: {}, sets: 0 })) as { stats: Record<string, unknown> };
    const few = JSON.parse(await read({ listeners: 4, tracks: { 'trk-x': 4 }, sets: 0 })) as { stats: Record<string, unknown> };
    for (const s of [zero.stats, few.stats]) {
      expect(s.unique_listeners).toBeNull();
      expect(s.unique_listeners_suppressed).toBe(true);
      expect(s.total_attributions).toBeNull();
      expect(s.total_attributions_suppressed).toBe(true);
      expect(s.top_discovered_tracks).toEqual([]);
    }
  });
});
