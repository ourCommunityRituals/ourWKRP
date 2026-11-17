/**
 * Security: only the set's own DJ changes the song (OW-219).
 *
 * "The song playing now" is what a scan or vote resolves to, by its playback
 * event id. So the song may change only from the authoritative playback source
 * — the DJ who owns the live set — never from anyone else: no session is 401,
 * another DJ is 403, a plain listener is 403, and a listener's own actions
 * (opening the live page, tapping a track) never open, close or move an event.
 * Each refused call is checked twice: by its status and by the table being
 * exactly as it was.
 *
 * Erasing the set's DJ ends the set (OW-219): their sessions are revoked, so
 * the set must not stay live with nobody able to end it. After erasure the set
 * is not live, its open event is closed and kept, and no one (the old session
 * or another DJ) can log a song to it or reopen it.
 *
 * Real router, real D1 (Miniflare), schema from migrations/.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startRig, resetRig, call, register, seedTracks, startSet, logTrack, playbackRows,
  type Rig, type Person, type PlaybackRow,
} from '../support/playback-rig';

let rig: Rig;
let owner: Person;
let setId: string;
let before: PlaybackRow[];

beforeAll(async () => { rig = await startRig(); }, 60000);
afterAll(async () => { await rig?.mf.dispose(); });

beforeEach(async () => {
  await resetRig(rig);
  await seedTracks(rig, ['trk-a', 'trk-b']);
  owner = await register(rig, 'Owner Selector', 'dj');
  setId = await startSet(rig, owner);
  await logTrack(rig, owner, setId, 'trk-a');
  before = await playbackRows(rig);
});

async function expectUnchanged(): Promise<void> {
  expect(await playbackRows(rig)).toEqual(before);
}

describe('POST /api/sets/:id/tracks: who may change the song', () => {
  it('no session: 401, nothing changes', async () => {
    const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, { json: { track_id: 'trk-b' } });
    expect(res.status).toBe(401);
    await expectUnchanged();
  }, 30000);

  it('an unknown session token: 401, nothing changes', async () => {
    const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, {
      cookie: 'wkrp_session=not-a-real-session', json: { track_id: 'trk-b' },
    });
    expect(res.status).toBe(401);
    await expectUnchanged();
  }, 30000);

  it('another DJ: 403, nothing changes', async () => {
    const other = await register(rig, 'Other Selector', 'dj');
    await startSet(rig, other); // a DJ with a live set of their own
    before = await playbackRows(rig);
    const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, { cookie: other.cookie, json: { track_id: 'trk-b' } });
    expect(res.status).toBe(403);
    await expectUnchanged();
  }, 30000);

  it('a plain listener: 403, nothing changes', async () => {
    const listener = await register(rig, 'Room Listener', 'listener');
    const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, { cookie: listener.cookie, json: { track_id: 'trk-b' } });
    expect(res.status).toBe(403);
    await expectUnchanged();
  }, 30000);

  it('the owner: 200, and the song changes', async () => {
    const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, { cookie: owner.cookie, json: { track_id: 'trk-b' } });
    expect(res.status).toBe(200);
    const open = (await playbackRows(rig, setId)).filter((r) => r.ended_at === null);
    expect(open.map((r) => r.track_id)).toEqual(['trk-b']);
  }, 30000);
});

describe('POST /api/sets/:id/end: who may close the open event', () => {
  it('no session: 401; another DJ: 403; a listener: 403 — the event stays open', async () => {
    const other = await register(rig, 'Other Selector', 'dj');
    const listener = await register(rig, 'Room Listener', 'listener');
    expect((await call(rig, 'POST', `/api/sets/${setId}/end`)).status).toBe(401);
    expect((await call(rig, 'POST', `/api/sets/${setId}/end`, { cookie: other.cookie })).status).toBe(403);
    expect((await call(rig, 'POST', `/api/sets/${setId}/end`, { cookie: listener.cookie })).status).toBe(403);
    await expectUnchanged();
  }, 30000);

  it('a listener starting a set is refused and closes nothing', async () => {
    const listener = await register(rig, 'Room Listener', 'listener');
    expect((await call(rig, 'POST', '/api/sets', { cookie: listener.cookie, json: {} })).status).toBe(403);
    await expectUnchanged();
  }, 30000);
});

describe("a listener's own actions never move the song", () => {
  it('reading the live page and tapping the track leave the events as they were', async () => {
    const listener = await register(rig, 'Room Listener', 'listener');
    expect((await call(rig, 'GET', `/dj/${owner.id}/live`, { cookie: listener.cookie })).status).toBe(200);
    expect((await call(rig, 'GET', `/dj/${owner.id}/live`)).status).toBe(200);
    const tap = await call(rig, 'POST', '/api/attributions', {
      cookie: listener.cookie, json: { dj_id: owner.id, track_id: 'trk-b' },
    });
    expect(tap.status).toBe(201);
    await expectUnchanged();
  }, 30000);
});

describe("erasing the set's DJ ends the set", () => {
  it('the set stops being live, its open event closes, and nobody can move it after', async () => {
    const other = await register(rig, 'Other Selector', 'dj');
    const res = await call(rig, 'DELETE', `/api/contributors/${owner.id}/identity`, { cookie: owner.cookie });
    expect(res.status).toBe(200);

    // The open event is closed and kept: same row, only ended_at set.
    const rows = await playbackRows(rig);
    expect(rows.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(rows[0].ended_at).toEqual(expect.any(String));
    expect(rows).toEqual([{ ...before[0], ended_at: rows[0].ended_at }]);
    const set = await rig.db.prepare('SELECT is_live, ended_at FROM dj_sets WHERE id = ?').bind(setId)
      .first<{ is_live: number; ended_at: string | null }>();
    expect(set!.is_live).toBe(0);
    expect(set!.ended_at).toEqual(expect.any(String));

    const liveBody = (await (await call(rig, 'GET', `/dj/${owner.id}/live`)).json()) as { live_set: unknown };
    expect(liveBody.live_set).toBeNull();

    // The erased session is gone: 401. Another DJ finds no live set: 404.
    const after = await playbackRows(rig);
    expect((await call(rig, 'POST', `/api/sets/${setId}/tracks`, { cookie: owner.cookie, json: { track_id: 'trk-b' } })).status).toBe(401);
    expect((await call(rig, 'POST', `/api/sets/${setId}/end`, { cookie: owner.cookie })).status).toBe(401);
    expect((await call(rig, 'POST', '/api/sets', { cookie: owner.cookie, json: {} })).status).toBe(401);
    expect((await call(rig, 'POST', `/api/sets/${setId}/tracks`, { cookie: other.cookie, json: { track_id: 'trk-b' } })).status).toBe(404);
    expect((await call(rig, 'POST', `/api/sets/${setId}/end`, { cookie: other.cookie })).status).toBe(404);
    expect(await playbackRows(rig)).toEqual(after);
  }, 30000);
});
