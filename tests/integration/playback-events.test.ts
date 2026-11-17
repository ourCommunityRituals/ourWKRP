/**
 * Integration: every play of a song in a live set is its own playback event
 * (OW-219, migration 0011).
 *
 * The scan-resolution law (docs/features/artist-attribution-five-surfaces.md)
 * says a scan resolves by a unit id carried in the code, never by a timestamp.
 * That needs one id per play: a replay of the same song is a new event, a set
 * has at most one open event, ending a set closes it, and every time is the
 * server's. These run the real router on a real D1 (Miniflare) with the schema
 * from migrations/.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startRig, resetRig, call, register, seedTracks, startSet, logTrack, playbackRows,
  type Rig,
} from '../support/playback-rig';

let rig: Rig;

beforeAll(async () => { rig = await startRig(); }, 60000);
afterAll(async () => { await rig?.mf.dispose(); });
beforeEach(async () => {
  await resetRig(rig);
  await seedTracks(rig, ['trk-a', 'trk-b', 'trk-c']);
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface LiveBody {
  ok: boolean;
  live_set: null | {
    id: string;
    now_playing: null | {
      playback_event_id: string;
      started_at: string;
      track: { id: string; name: string; artist: string; album: string | null; image_url: string | null };
    };
    tracks: Array<{ id: string }>;
  };
}

async function live(djId: string): Promise<LiveBody> {
  const res = await call(rig, 'GET', `/dj/${djId}/live`);
  expect(res.status).toBe(200);
  return res.json() as Promise<LiveBody>;
}

describe('POST /api/sets/:id/tracks opens a playback event', () => {
  it('returns the new event id and stores one open event for the set', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);

    const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, { cookie: dj.cookie, json: { track_id: 'trk-a' } });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; playback_event: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.playback_event.id).toMatch(UUID_RE);

    const rows = await playbackRows(rig, setId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: body.playback_event.id, set_id: setId, track_id: 'trk-a', ended_at: null });
  }, 30000);

  it('the next song closes the open event and opens a new one', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    const first = await logTrack(rig, dj, setId, 'trk-a');
    const second = await logTrack(rig, dj, setId, 'trk-b');

    expect(second).not.toBe(first);
    const rows = await playbackRows(rig, setId);
    expect(rows.map((r) => r.id)).toEqual([first, second]);
    expect(rows[0].ended_at).not.toBeNull();
    expect(rows[1].ended_at).toBeNull();
    expect(rows.filter((r) => r.ended_at === null)).toHaveLength(1);
  }, 30000);

  it('a replay of the same song is a new event with a new id; set_tracks still lists the song once', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    const a1 = await logTrack(rig, dj, setId, 'trk-a');
    const b = await logTrack(rig, dj, setId, 'trk-b');
    const a2 = await logTrack(rig, dj, setId, 'trk-a');

    expect(new Set([a1, b, a2]).size).toBe(3);
    const rows = await playbackRows(rig, setId);
    expect(rows.map((r) => [r.id, r.track_id, r.ended_at === null])).toEqual([
      [a1, 'trk-a', false],
      [b, 'trk-b', false],
      [a2, 'trk-a', true],
    ]);

    const st = await rig.db.prepare('SELECT track_id FROM set_tracks WHERE set_id = ? ORDER BY position').bind(setId).all<{ track_id: string }>();
    expect(st.results.map((r) => r.track_id)).toEqual(['trk-a', 'trk-b']);
  }, 30000);

  it('the same song logged twice in a row is still two plays', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    const a1 = await logTrack(rig, dj, setId, 'trk-a');
    const a2 = await logTrack(rig, dj, setId, 'trk-a');
    expect(a2).not.toBe(a1);
    const rows = await playbackRows(rig, setId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.ended_at === null).map((r) => r.id)).toEqual([a2]);
  }, 30000);

  it('times are server time: a client-supplied time is not stored', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, {
      cookie: dj.cookie,
      json: {
        track_id: 'trk-a',
        started_at: '2001-01-01 00:00:00',
        ended_at: '2001-01-01 00:00:00',
        played_at: '2001-01-01 00:00:00',
      },
    });
    expect(res.status).toBe(200);
    const [row] = await playbackRows(rig, setId);
    expect(row.ended_at).toBeNull();
    const now = await rig.db.prepare("SELECT datetime('now') AS now").first<{ now: string }>();
    const drift = Math.abs(Date.parse(`${now!.now}Z`) - Date.parse(`${row.started_at}Z`));
    expect(drift).toBeLessThan(60_000);
    const st = await rig.db.prepare('SELECT played_at FROM set_tracks WHERE set_id = ?').bind(setId).first<{ played_at: string }>();
    expect(st!.played_at.startsWith('2001')).toBe(false);
  }, 30000);

  it('is all or nothing: a song that fails to log leaves the open event open', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    const open = await logTrack(rig, dj, setId, 'trk-a');

    // A track id with no catalog row fails its foreign key inside the batch
    // (as the set_tracks insert always has); the worker answers 500.
    await expect(
      call(rig, 'POST', `/api/sets/${setId}/tracks`, { cookie: dj.cookie, json: { track_id: 'no-such-track' } }),
    ).rejects.toThrow(/FOREIGN KEY/i);
    expect((await playbackRows(rig, setId)).map((r) => [r.id, r.ended_at])).toEqual([[open, null]]);
  }, 30000);

  it("brand_id is the owning DJ's brand, not the request host", async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    await rig.db.prepare("INSERT INTO brands (id, name, subdomain) VALUES ('testbrand', 'Test Brand', 'testbrand')").run();
    await rig.db.prepare("UPDATE contributors SET brand_id = 'testbrand' WHERE id = ?").bind(dj.id).run();
    const setId = await startSet(rig, dj);

    const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, {
      cookie: dj.cookie, json: { track_id: 'trk-a' }, base: 'https://otherbrand.ourwkrp.com',
    });
    expect(res.status).toBe(200);
    const [row] = await playbackRows(rig, setId);
    expect(row.brand_id).toBe('testbrand');
  }, 30000);
});

describe('ending a set closes its open playback event', () => {
  it('POST /api/sets/:id/end leaves no open event', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    await logTrack(rig, dj, setId, 'trk-a');
    await logTrack(rig, dj, setId, 'trk-b');

    const res = await call(rig, 'POST', `/api/sets/${setId}/end`, { cookie: dj.cookie });
    expect(res.status).toBe(200);
    const rows = await playbackRows(rig, setId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ended_at !== null)).toBe(true);
  }, 30000);

  it("starting a new set closes the previous live set's open event", async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const firstSet = await startSet(rig, dj);
    await logTrack(rig, dj, firstSet, 'trk-a');

    const secondSet = await startSet(rig, dj);
    expect(secondSet).not.toBe(firstSet);
    const old = await playbackRows(rig, firstSet);
    expect(old).toHaveLength(1);
    expect(old[0].ended_at).not.toBeNull();

    // The new set starts with nothing open, and its first song opens one.
    expect(await playbackRows(rig, secondSet)).toHaveLength(0);
    const id = await logTrack(rig, dj, secondSet, 'trk-b');
    expect((await playbackRows(rig, secondSet)).map((r) => [r.id, r.ended_at])).toEqual([[id, null]]);
  }, 30000);

  it("closing one DJ's set leaves another DJ's open event alone", async () => {
    const dj1 = await register(rig, 'Test Selector One', 'dj');
    const dj2 = await register(rig, 'Test Selector Two', 'dj');
    const set1 = await startSet(rig, dj1);
    const set2 = await startSet(rig, dj2);
    await logTrack(rig, dj1, set1, 'trk-a');
    const open2 = await logTrack(rig, dj2, set2, 'trk-b');

    await call(rig, 'POST', `/api/sets/${set1}/end`, { cookie: dj1.cookie });
    await startSet(rig, dj1);
    expect((await playbackRows(rig, set2)).map((r) => [r.id, r.ended_at])).toEqual([[open2, null]]);
  }, 30000);
});

describe('GET /dj/:id/live now_playing', () => {
  it('is null while the set is live and no song is logged', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    await startSet(rig, dj);
    const body = await live(dj.id);
    expect(body.live_set).not.toBeNull();
    expect(body.live_set!.now_playing).toBeNull();
    expect(body.live_set!.tracks).toEqual([]);
  }, 30000);

  it('names the open event and its track, never a closed one', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    await logTrack(rig, dj, setId, 'trk-a');
    const open = await logTrack(rig, dj, setId, 'trk-b');

    const body = await live(dj.id);
    const [row] = (await playbackRows(rig, setId)).filter((r) => r.id === open);
    expect(body.live_set!.now_playing).toEqual({
      playback_event_id: open,
      started_at: row.started_at,
      track: {
        id: 'trk-b', name: 'Song trk-b', artist: 'Artist trk-b', album: 'Album trk-b',
        image_url: 'https://img.example/trk-b.jpg',
      },
    });
  }, 30000);

  it('follows a replay to the new event id', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    const a1 = await logTrack(rig, dj, setId, 'trk-a');
    await logTrack(rig, dj, setId, 'trk-b');
    const a2 = await logTrack(rig, dj, setId, 'trk-a');
    const np = (await live(dj.id)).live_set!.now_playing!;
    expect(np.playback_event_id).toBe(a2);
    expect(np.playback_event_id).not.toBe(a1);
    expect(np.track.id).toBe('trk-a');
  }, 30000);

  it('keeps the tracks list as before: one entry per song, newest first', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    await logTrack(rig, dj, setId, 'trk-a');
    await logTrack(rig, dj, setId, 'trk-b');
    await logTrack(rig, dj, setId, 'trk-a');
    const body = await live(dj.id);
    expect(body.live_set!.tracks.map((t) => t.id)).toEqual(['trk-b', 'trk-a']);
  }, 30000);

  it('an ended set is not live, so there is nothing playing', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    await logTrack(rig, dj, setId, 'trk-a');
    await call(rig, 'POST', `/api/sets/${setId}/end`, { cookie: dj.cookie });
    expect((await live(dj.id)).live_set).toBeNull();
  }, 30000);
});

describe('schema: migration 0011', () => {
  it('a set can hold at most one open event', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    await logTrack(rig, dj, setId, 'trk-a');
    await expect(
      rig.db.prepare(
        "INSERT INTO playback_events (id, set_id, track_id, brand_id) VALUES ('pe-second-open', ?, 'trk-b', 'wkrp')",
      ).bind(setId).run(),
    ).rejects.toThrow(/UNIQUE/i);
  }, 30000);

  it('closed events of one set may be many', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    for (const id of ['pe-1', 'pe-2', 'pe-3']) {
      await rig.db.prepare(
        "INSERT INTO playback_events (id, set_id, track_id, brand_id, ended_at) VALUES (?, ?, 'trk-a', 'wkrp', datetime('now'))",
      ).bind(id, setId).run();
    }
    expect(await playbackRows(rig, setId)).toHaveLength(3);
  }, 30000);

  it('an event must name a real set and a real track', async () => {
    await expect(
      rig.db.prepare(
        "INSERT INTO playback_events (id, set_id, track_id, brand_id) VALUES ('pe-x', 'no-such-set', 'trk-a', 'wkrp')",
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  }, 30000);
});

describe('right to erasure: playback events follow dj_sets and set_tracks', () => {
  // Erasure tombstones the contributor and keeps their sets and set_tracks
  // (lib/erasure.ts: contributions stay so the catalog's lineage holds). A
  // playback event names a set and a track, never a person, so it is kept the
  // same way and still resolves to its set: nothing orphaned, nothing personal
  // left on it.
  it('keeps every set, set track and playback event, all still linked', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const endedSet = await startSet(rig, dj);
    await logTrack(rig, dj, endedSet, 'trk-a');
    await call(rig, 'POST', `/api/sets/${endedSet}/end`, { cookie: dj.cookie });
    const liveSet = await startSet(rig, dj);
    await logTrack(rig, dj, liveSet, 'trk-b');
    await logTrack(rig, dj, liveSet, 'trk-b');

    const snapshot = async () => ({
      sets: (await rig.db.prepare('SELECT * FROM dj_sets ORDER BY id').all()).results,
      setTracks: (await rig.db.prepare('SELECT * FROM set_tracks ORDER BY set_id, track_id').all()).results,
      playback: await playbackRows(rig),
    });
    const before = await snapshot();
    expect(before.playback).toHaveLength(3);

    const res = await call(rig, 'DELETE', `/api/contributors/${dj.id}/identity`, { cookie: dj.cookie });
    expect(res.status).toBe(200);

    const c = await rig.db.prepare('SELECT name, status FROM contributors WHERE id = ?').bind(dj.id).first<{ name: string; status: string }>();
    expect(c).toEqual({ name: '[erased]', status: 'departed' });
    expect(await snapshot()).toEqual(before);

    const orphans = await rig.db.prepare(
      `SELECT COUNT(*) AS n FROM playback_events pe
         LEFT JOIN dj_sets s ON s.id = pe.set_id
         LEFT JOIN contributors c ON c.id = s.dj_id
        WHERE s.id IS NULL OR c.id IS NULL`,
    ).first<{ n: number }>();
    expect(orphans!.n).toBe(0);
  }, 30000);

  it('a playback event has no column that names a person', async () => {
    const cols = await rig.db.prepare("SELECT name FROM pragma_table_info('playback_events') ORDER BY cid").all<{ name: string }>();
    expect(cols.results.map((r) => r.name)).toEqual(['id', 'set_id', 'track_id', 'brand_id', 'started_at', 'ended_at']);
  }, 30000);
});
