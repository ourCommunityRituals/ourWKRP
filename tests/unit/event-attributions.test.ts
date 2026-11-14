/**
 * Unit tests: lib/event-attributions.ts, the one reading of an event's taps
 * that the music route and the sponsor report both publish from.
 */
import { describe, it, expect } from 'vitest';
import { eventAttributionsQuery, summariseEventAttributions, type EventAttributionRow } from '../../src/lib/event-attributions';
import type { Env } from '../../src/types';
import { COUNT_FLOOR } from '../../src/lib/count-floor';

function taps(n: number, o: Partial<EventAttributionRow> & { named?: number } = {}): EventAttributionRow[] {
  const { named = 0, ...rest } = o;
  return Array.from({ length: n }, (_, i) => ({
    dj_id: 'd1',
    dj_name: 'DJ One',
    track_id: 't1',
    track_name: 'Song',
    artist: 'A',
    album: null,
    genre: null,
    image_url: null,
    hour: '2026-11-01 21:00',
    ...rest,
    listener_id: i < named ? `L-${rest.dj_id ?? 'd1'}-${rest.track_id ?? 't1'}-${rest.hour ?? 'h'}-${i}` : null,
  }));
}

describe('summariseEventAttributions', () => {
  it('withholds everything for an event with no taps', () => {
    const c = summariseEventAttributions([]);
    expect(c.total).toEqual({ count: null, suppressed: true, floor: COUNT_FLOOR });
    expect(c.distinctListeners.suppressed).toBe(true);
    expect(c.djs.suppressed).toBe(true);
    expect([c.byTrack, c.byDj, c.byHour]).toEqual([[], [], []]);
  });

  it('every cut sums to the total, and a small DJ is left out of all of them', () => {
    const c = summariseEventAttributions([
      ...taps(6, { dj_id: 'd1', track_id: 't1', hour: '2026-11-01 21:00', named: 6 }),
      ...taps(7, { dj_id: 'd2', dj_name: 'DJ Two', track_id: 't2', hour: '2026-11-01 22:00', named: 7 }),
      ...taps(3, { dj_id: 'dx', dj_name: 'DJ X', track_id: 't1', hour: '2026-11-01 21:00', named: 3 }),
    ]);
    const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
    expect(c.total.count).toBe(13);
    expect(sum(c.byTrack.map((t) => t.attribution_count))).toBe(13);
    expect(sum(c.byDj.map((d) => d.attribution_count))).toBe(13);
    expect(sum(c.byHour.map((h) => h.count))).toBe(13);
    expect(c.distinctListeners.count).toBe(13);
    expect(c.byDj.map((d) => d.dj_id)).toEqual(['d2', 'd1']);
    expect(c.djs).toEqual({ count: null, suppressed: true, floor: COUNT_FLOOR });
  });

  it('orders tracks by count then id, hours by time, and names the top DJ per track (ties: lowest id)', () => {
    const c = summariseEventAttributions([
      ...taps(5, { dj_id: 'd2', dj_name: 'DJ Two', track_id: 'tb', hour: '2026-11-01 22:00' }),
      ...taps(5, { dj_id: 'd1', dj_name: 'DJ One', track_id: 'tb', hour: '2026-11-01 21:00' }),
      ...taps(10, { dj_id: 'd1', dj_name: 'DJ One', track_id: 'ta', hour: '2026-11-01 21:00' }),
      ...taps(10, { dj_id: 'd2', dj_name: 'DJ Two', track_id: 'tc', hour: '2026-11-01 22:00' }),
    ]);
    expect(c.byTrack.map((t) => [t.track_id, t.attribution_count, t.attributed_dj])).toEqual([
      ['ta', 10, 'DJ One'],
      ['tb', 10, 'DJ One'],
      ['tc', 10, 'DJ Two'],
    ]);
    expect(c.byHour.map((h) => h.hour)).toEqual(['2026-11-01 21:00', '2026-11-01 22:00']);
  });

  it('the top DJ on a track is the one with more taps, whatever the order of the rows', () => {
    const more = taps(6, { dj_id: 'd9', dj_name: 'DJ Nine', track_id: 't1' });
    const fewer = taps(5, { dj_id: 'd1', dj_name: 'DJ One', track_id: 't1' });
    expect(summariseEventAttributions([...more, ...fewer]).byTrack[0].attributed_dj).toBe('DJ Nine');
    expect(summariseEventAttributions([...fewer, ...more]).byTrack[0].attributed_dj).toBe('DJ Nine');
  });

  it('a tie for top DJ goes to the lowest id, whatever the order of the rows', () => {
    const one = taps(5, { dj_id: 'd1', dj_name: 'DJ One', track_id: 't1' });
    const two = taps(5, { dj_id: 'd2', dj_name: 'DJ Two', track_id: 't1' });
    expect(summariseEventAttributions([...one, ...two]).byTrack[0].attributed_dj).toBe('DJ One');
    expect(summariseEventAttributions([...two, ...one]).byTrack[0].attributed_dj).toBe('DJ One');
  });

  it('ties in count are ordered by id, for tracks and for DJs, whatever the order of the rows', () => {
    const rows = [
      ...taps(5, { dj_id: 'dz', dj_name: 'DJ Z', track_id: 'tz', hour: '2026-11-01 23:00' }),
      ...taps(5, { dj_id: 'da', dj_name: 'DJ A', track_id: 'ta', hour: '2026-11-01 21:00' }),
      ...taps(5, { dj_id: 'dm', dj_name: 'DJ M', track_id: 'tm', hour: '2026-11-01 22:00' }),
    ];
    const c = summariseEventAttributions(rows);
    expect(c.byTrack.map((t) => t.track_id)).toEqual(['ta', 'tm', 'tz']);
    expect(c.byDj.map((d) => d.dj_id)).toEqual(['da', 'dm', 'dz']);
    expect(c.byHour.map((h) => h.hour)).toEqual(['2026-11-01 21:00', '2026-11-01 22:00', '2026-11-01 23:00']);
    const reversed = summariseEventAttributions([...rows].reverse());
    expect(reversed).toEqual(c);
  });

  it('keeps a null hour as its own bucket', () => {
    const c = summariseEventAttributions(taps(5, { hour: null }));
    expect(c.byHour).toEqual([{ hour: null, count: 5 }]);
  });

  it('counts anonymous taps but not as listeners', () => {
    const c = summariseEventAttributions(taps(9, { named: 4 }));
    expect(c.total.count).toBe(9);
    expect(c.distinctListeners).toEqual({ count: null, suppressed: true, floor: COUNT_FLOOR });
  });
});

describe('eventAttributionsQuery', () => {
  it('reads every attribution of the one event, with the hour bucket the timeline uses', () => {
    let sql = '';
    let bound: unknown[] = [];
    const env = {
      WKRP_DB: {
        prepare: (q: string) => {
          sql = q;
          return { bind: (...args: unknown[]) => ((bound = args), { sql: q }) };
        },
      },
    } as unknown as Env;
    const stmt = eventAttributionsQuery(env, 'evt-9') as unknown as { sql: string };
    expect(stmt.sql).toBe(sql);
    expect(bound).toEqual(['evt-9']);
    expect(sql).toMatch(/WHERE a\.event_id = \?/);
    expect(sql).toContain("strftime('%Y-%m-%d %H:00', a.attributed_at) AS hour");
    expect(sql).toMatch(/INNER JOIN tracks t ON a\.track_id = t\.id/);
    expect(sql).toMatch(/INNER JOIN contributors c ON a\.dj_id = c\.id/);
    expect(sql).toMatch(/ORDER BY a\.id ASC/);
    expect(sql).not.toMatch(/\bLIMIT\b/);
  });
});
