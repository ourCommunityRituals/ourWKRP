/**
 * Unit: the statements behind a song change, a set end and a set start
 * (OW-219, playback events).
 *
 * Against a D1 stub that records every statement and every batch, these hold
 * the shape the integration suite cannot see directly: closing the old event
 * and opening the new one are in ONE batch (so no reader sees two open, or a
 * closed one with nothing after it), the insert is guarded by the set's owner
 * and liveness at write time, every time is `datetime('now')` and no bound
 * value is a client time, and a stale live check (the set ended in between)
 * opens nothing and says so.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../../src/types';

vi.mock('../../src/lib/require-session', () => ({
  requireSession: vi.fn(async () => ({ userId: 'dj-user-1' })),
}));
vi.mock('../../src/lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }));

const { handleAddSetTrack, handleEndSet, handleStartSet, handleGetLiveSet } = await import('../../src/handlers/dj');

interface Stmt { sql: string; args: unknown[] }

interface Recorder {
  env: Env;
  /** Statements run on their own (outside any batch). */
  single: Stmt[];
  /** Each batch, as the list of its statements. */
  batches: Stmt[][];
}

function recorder(opts: { insertChanges?: number; openRow?: Record<string, unknown> | null } = {}): Recorder {
  const single: Stmt[] = [];
  const batches: Stmt[][] = [];
  const firstFor = (sql: string): Record<string, unknown> | null => {
    if (sql.includes('FROM contributors')) return { id: 'dj-user-1', name: 'Test Selector', role: 'dj' };
    if (sql.includes('FROM dj_sets')) return { id: 'set-1', dj_id: 'dj-user-1', is_live: 1, venue_name: null, started_at: 'x' };
    if (sql.includes('set_tracks')) return { next_pos: 0 };
    return null;
  };
  const resultFor = (sql: string) => {
    if (/INSERT INTO playback_events/.test(sql)) return { success: true, results: [], meta: { changes: opts.insertChanges ?? 1 } };
    if (/FROM playback_events/.test(sql)) return { success: true, results: opts.openRow ? [opts.openRow] : [], meta: {} };
    return { success: true, results: [], meta: { changes: 1 } };
  };
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const stmt: Stmt = { sql, args };
          return {
            _stmt: stmt,
            run: async () => { single.push(stmt); return resultFor(sql); },
            first: async () => { single.push(stmt); return firstFor(sql); },
            all: async () => { single.push(stmt); return resultFor(sql); },
          };
        },
      };
    },
    async batch(stmts: Array<{ _stmt: Stmt }>) {
      batches.push(stmts.map((s) => s._stmt));
      return stmts.map((s) => resultFor(s._stmt.sql));
    },
  };
  return { env: { WKRP_DB: db } as unknown as Env, single, batches };
}

function post(path: string, body?: unknown): Request {
  return new Request(`https://ourwkrp.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const CLIENT_TIME = '2001-01-01 00:00:00';
const isClose = (s: Stmt) => /UPDATE playback_events SET ended_at = datetime\('now'\)/.test(s.sql) && /ended_at IS NULL/.test(s.sql);
const isOpen = (s: Stmt) => /INSERT INTO playback_events/.test(s.sql);
const touchesPlayback = (s: Stmt) => /playback_events/.test(s.sql);

describe('handleAddSetTrack', () => {
  it('closes the open event, opens the new one and writes set_tracks in one batch, in that order', async () => {
    const r = recorder();
    const res = await handleAddSetTrack(post('/api/sets/set-1/tracks', { track_id: 'trk-a' }), r.env, 'set-1');
    expect(res.status).toBe(200);
    expect(r.batches).toHaveLength(1);
    const [close, open, setTrack] = r.batches[0];
    expect(r.batches[0]).toHaveLength(3);
    expect(isClose(close)).toBe(true);
    expect(close.args).toEqual(['set-1']);
    expect(isOpen(open)).toBe(true);
    expect(setTrack.sql).toMatch(/INSERT OR IGNORE INTO set_tracks/);
    // Nothing about playback runs outside the batch.
    expect(r.single.filter(touchesPlayback)).toEqual([]);
  });

  it('opens the event with a fresh id, guarded by owner and liveness at write time', async () => {
    const r = recorder();
    const res = await handleAddSetTrack(post('/api/sets/set-1/tracks', { track_id: 'trk-a' }), r.env, 'set-1');
    const body = await res.json() as { ok: boolean; playback_event: { id: string } };
    const open = r.batches[0][1];
    expect(open.args).toEqual([body.playback_event.id, 'trk-a', 'set-1', 'dj-user-1']);
    expect(open.sql).toMatch(/s\.dj_id = \?/);
    expect(open.sql).toMatch(/s\.is_live = 1/);
    expect(open.sql).toMatch(/c\.brand_id/);
  });

  it('a replay of the same song gets a new id each time', async () => {
    const r = recorder();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await handleAddSetTrack(post('/api/sets/set-1/tracks', { track_id: 'trk-a' }), r.env, 'set-1');
      ids.push((await res.json() as { playback_event: { id: string } }).playback_event.id);
    }
    expect(new Set(ids).size).toBe(3);
    for (const b of r.batches) expect(isClose(b[0])).toBe(true);
  });

  it('uses server time only: a client time in the body reaches no statement', async () => {
    const r = recorder();
    await handleAddSetTrack(
      post('/api/sets/set-1/tracks', { track_id: 'trk-a', started_at: CLIENT_TIME, ended_at: CLIENT_TIME, played_at: CLIENT_TIME }),
      r.env, 'set-1',
    );
    const all = [...r.single, ...r.batches.flat()];
    expect(all.flatMap((s) => s.args)).not.toContain(CLIENT_TIME);
    expect(r.batches[0][1].sql).toMatch(/datetime\('now'\)/);
  });

  it('answers 404 and reports no event when the set ended before the write', async () => {
    const r = recorder({ insertChanges: 0 });
    const res = await handleAddSetTrack(post('/api/sets/set-1/tracks', { track_id: 'trk-a' }), r.env, 'set-1');
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.playback_event).toBeUndefined();
  });

  it('returns ok and the new playback event id', async () => {
    const r = recorder();
    const res = await handleAddSetTrack(post('/api/sets/set-1/tracks', { track_id: 'trk-a' }), r.env, 'set-1');
    const body = await res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['ok', 'playback_event']);
    expect(body.ok).toBe(true);
    expect(Object.keys(body.playback_event as object)).toEqual(['id']);
  });
});

describe('handleEndSet', () => {
  it('ends the set and closes its open event in one batch', async () => {
    const r = recorder();
    const res = await handleEndSet(post('/api/sets/set-1/end'), r.env, 'set-1');
    expect(res.status).toBe(200);
    expect(r.batches).toHaveLength(1);
    const [close, end] = r.batches[0];
    expect(isClose(close)).toBe(true);
    expect(close.args).toEqual(['set-1']);
    expect(end.sql).toMatch(/UPDATE dj_sets SET is_live = 0/);
    expect(r.single.filter(touchesPlayback)).toEqual([]);
  });
});

describe('handleStartSet', () => {
  it("closes the DJ's live sets' open events before ending those sets, in one batch", async () => {
    const r = recorder();
    const res = await handleStartSet(post('/api/sets', { venue_name: 'Test Room' }), r.env);
    expect(res.status).toBe(201);
    expect(r.batches).toHaveLength(1);
    const [close, end] = r.batches[0];
    expect(isClose(close)).toBe(true);
    expect(close.sql).toMatch(/SELECT id FROM dj_sets WHERE dj_id = \? AND is_live = 1/);
    expect(close.args).toEqual(['dj-user-1']);
    expect(end.sql).toMatch(/UPDATE dj_sets SET is_live = 0/);
    expect(r.single.filter(touchesPlayback)).toEqual([]);
  });
});

describe('handleGetLiveSet now_playing', () => {
  it('reads only the open event', async () => {
    const r = recorder();
    await handleGetLiveSet(new Request('https://ourwkrp.com/dj/dj-user-1/live'), r.env, 'dj-user-1');
    const read = r.batches.flat().find((s) => /FROM playback_events/.test(s.sql));
    expect(read).toBeDefined();
    expect(read!.sql).toMatch(/pe\.ended_at IS NULL/);
    expect(read!.args).toEqual(['set-1']);
  });

  it('maps the open row to { playback_event_id, started_at, track }', async () => {
    const r = recorder({
      openRow: {
        playback_event_id: 'pe-1', started_at: '2026-11-17 20:00:00', track_id: 'trk-a',
        name: 'Song A', artist: 'Artist A', album: 'Album A', image_url: null,
      },
    });
    const res = await handleGetLiveSet(new Request('https://ourwkrp.com/dj/dj-user-1/live'), r.env, 'dj-user-1');
    const body = await res.json() as { live_set: { now_playing: unknown } };
    expect(body.live_set.now_playing).toEqual({
      playback_event_id: 'pe-1',
      started_at: '2026-11-17 20:00:00',
      track: { id: 'trk-a', name: 'Song A', artist: 'Artist A', album: 'Album A', image_url: null },
    });
  });

  it('is null when no event is open', async () => {
    const r = recorder({ openRow: null });
    const res = await handleGetLiveSet(new Request('https://ourwkrp.com/dj/dj-user-1/live'), r.env, 'dj-user-1');
    const body = await res.json() as { live_set: { now_playing: unknown } };
    expect(body.live_set.now_playing).toBeNull();
  });
});
