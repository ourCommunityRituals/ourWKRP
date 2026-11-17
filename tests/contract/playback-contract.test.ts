/**
 * Contract: the JSON shapes of a song change and of now_playing (OW-219).
 *
 * Driven through the real router on a real D1 (Miniflare), so the shapes are
 * the ones the handlers actually send, not a hand-written copy of them.
 *   - POST /api/sets/:id/tracks → { ok, playback_event: { id } }
 *   - GET /dj/:id/live → live_set gains `now_playing`
 *     ({ playback_event_id, started_at, track: { id, name, artist, album,
 *     image_url } } or null); `tracks` and the other keys are unchanged.
 * Neither carries a count of anything: a public count under 5 is withheld
 * (lib/count-floor.ts), and this slice adds none to withhold.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startRig, resetRig, call, register, seedTracks, startSet, logTrack,
  type Rig,
} from '../support/playback-rig';

let rig: Rig;

beforeAll(async () => { rig = await startRig(); }, 60000);
afterAll(async () => { await rig?.mf.dispose(); });
beforeEach(async () => {
  await resetRig(rig);
  await seedTracks(rig, ['trk-a', 'trk-b']);
});

/** Every key at every depth, as dotted paths (array items as `[]`). */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => keyPaths(v, `${prefix}[]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => {
      const p = prefix ? `${prefix}.${k}` : k;
      return [p, ...keyPaths(v, p)];
    });
  }
  return [];
}

describe('POST /api/sets/:id/tracks response', () => {
  it('is exactly { ok, playback_event: { id } }', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    const res = await call(rig, 'POST', `/api/sets/${setId}/tracks`, { cookie: dj.cookie, json: { track_id: 'trk-a' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json() as { ok: boolean; playback_event: { id: string } };
    expect(keyPaths(body).sort()).toEqual(['ok', 'playback_event', 'playback_event.id']);
    expect(body.ok).toBe(true);
    expect(typeof body.playback_event.id).toBe('string');
  }, 30000);
});

describe('GET /dj/:id/live live_set', () => {
  it('with a song open: the agreed keys, and now_playing names the open event', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    await logTrack(rig, dj, setId, 'trk-a');
    const open = await logTrack(rig, dj, setId, 'trk-b');

    const body = await (await call(rig, 'GET', `/dj/${dj.id}/live`)).json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['dj', 'live_set', 'ok']);
    const liveSet = body.live_set as Record<string, unknown>;
    expect(Object.keys(liveSet).sort()).toEqual(['id', 'now_playing', 'started_at', 'tracks', 'venue_name']);

    const np = liveSet.now_playing as Record<string, unknown>;
    expect(keyPaths(np).sort()).toEqual([
      'playback_event_id', 'started_at', 'track',
      'track.album', 'track.artist', 'track.id', 'track.image_url', 'track.name',
    ]);
    expect(np.playback_event_id).toBe(open);
    expect(typeof np.started_at).toBe('string');

    // The tracks list keeps its shape.
    const tracks = liveSet.tracks as Array<Record<string, unknown>>;
    expect(tracks).toHaveLength(2);
    for (const t of tracks) {
      expect(Object.keys(t).sort()).toEqual(['album', 'artist', 'genre', 'id', 'image_url', 'name', 'played_at']);
    }
  }, 30000);

  it('with nothing open: now_playing is null', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    await startSet(rig, dj);
    const body = await (await call(rig, 'GET', `/dj/${dj.id}/live`)).json() as { live_set: Record<string, unknown> };
    expect('now_playing' in body.live_set).toBe(true);
    expect(body.live_set.now_playing).toBeNull();
  }, 30000);

  it('carries no count of anything', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    await logTrack(rig, dj, setId, 'trk-a');
    await logTrack(rig, dj, setId, 'trk-a');
    const body = await (await call(rig, 'GET', `/dj/${dj.id}/live`)).json();
    for (const p of keyPaths(body)) expect(p).not.toMatch(/count|total|plays|votes|listeners/i);
  }, 30000);
});
