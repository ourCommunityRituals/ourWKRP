/**
 * Integration: each play's vote on OurSharedEvents (OW-219, OSE ADR-040,
 * migration 0012, src/lib/ose-vote-link.ts).
 *
 * The real router on a real D1 (Miniflare). OurSharedEvents is played by a
 * stubbed fetch that records every call. What must hold:
 *   - off by default: no call leaves ourWKRP;
 *   - on: logging a song adds it to the event's vote set there and opens it,
 *     closes the song that was playing, and keeps the link on the play;
 *   - a replay is a new object (one vote per play, never per track);
 *   - ending the set closes the open song's vote;
 *   - OurSharedEvents is sent the song's label only: no ourWKRP id, no name;
 *   - a refusal or no answer never fails the DJ's request.
 *
 * @born-red OW-219 | method: injected-fault, each removed after: the link
 *   switch ignored (off case red), the previous play not closed (close case
 *   red), the link keyed to the track instead of the play (replay case red),
 *   the DJ id added to the body (privacy case red), the refusal thrown (refusal
 *   case red) | date: 2026-11-19
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  startRig, resetRig, call, register, seedTracks, startSet, logTrack, playbackRows,
  type Rig,
} from '../support/playback-rig';
import type { Env } from '../../src/types';

let rig: Rig;
let baseEnv: Env;

const OSE = 'https://stg.oursharedevents.test';
const OSE_EVENT = 'evt_fist_of_five';

interface Sent { url: string; body: Record<string, unknown>; headers: Record<string, string> }
let sent: Sent[];
let refuse: number | null;
let seq: number;

function stubOse(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')), headers });
    if (refuse !== null) return new Response('{}', { status: refuse });
    if (url.endsWith('/votables/objects')) {
      const id = `vobj_${(++seq).toString(16).padStart(32, '0')}`;
      return Response.json({ ok: true, object: { id } }, { status: 201 });
    }
    return Response.json({ ok: true }, { status: 200 });
  });
}

function linkOn(): void {
  rig.env = {
    ...baseEnv,
    OSE_VOTE_LINK: 'on',
    OSE_VOTE_API_BASE: OSE,
    OSE_SERVICE_TOKEN_ID: 'client-id.access',
    OSE_SERVICE_TOKEN_SECRET: 'client-secret-test',
  } as Env;
}

async function startEventSet(dj: { cookie: string }): Promise<string> {
  const res = await call(rig, 'POST', '/api/sets', {
    cookie: dj.cookie,
    json: { venue_name: 'Eagles Hall', event_id: OSE_EVENT },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { set: { id: string } }).set.id;
}

type LinkRow = { id: string; vote_object_id: string | null; ended_at: string | null };
async function links(setId: string): Promise<LinkRow[]> {
  return (await rig.db.prepare(
    'SELECT id, vote_object_id, ended_at FROM playback_events WHERE set_id = ? ORDER BY rowid'
  ).bind(setId).all<LinkRow>()).results;
}

beforeAll(async () => { rig = await startRig(); baseEnv = rig.env; }, 60000);
afterAll(async () => { await rig?.mf.dispose(); });
beforeEach(async () => {
  rig.env = baseEnv;
  sent = [];
  refuse = null;
  seq = 0;
  stubOse();
  await resetRig(rig);
  await seedTracks(rig, ['trk-a', 'trk-b']);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('off by default', () => {
  it('logging songs sends nothing to OurSharedEvents and stores no link [switch ignored]', async () => {
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startEventSet(dj);
    await logTrack(rig, dj, setId, 'trk-a');
    await logTrack(rig, dj, setId, 'trk-b');
    expect(sent).toEqual([]);
    expect((await links(setId)).map((r) => r.vote_object_id)).toEqual([null, null]);
  }, 30000);

  it('"on" without the service token is still off', async () => {
    rig.env = { ...baseEnv, OSE_VOTE_LINK: 'on', OSE_VOTE_API_BASE: OSE } as Env;
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startEventSet(dj);
    await logTrack(rig, dj, setId, 'trk-a');
    expect(sent).toEqual([]);
  }, 30000);
});

describe('on', () => {
  it('a logged song is added and opened on the event, and the play keeps the link', async () => {
    linkOn();
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startEventSet(dj);
    const play = await logTrack(rig, dj, setId, 'trk-a');
    expect(sent.map((s) => s.url)).toEqual([
      `${OSE}/api/v2/admin/events/${OSE_EVENT}/votables/objects`,
      `${OSE}/api/v2/admin/events/${OSE_EVENT}/votables/objects/vobj_${'1'.padStart(32, '0')}/open`,
    ]);
    expect(sent[0]!.body).toEqual({ kind: 'song', label: 'Song trk-a by Artist trk-a' });
    expect(sent[0]!.headers['cf-access-client-id']).toBe('client-id.access');
    const rows = await links(setId);
    expect(rows).toEqual([
      { id: play, vote_object_id: `vobj_${'1'.padStart(32, '0')}`, ended_at: null },
    ]);
  }, 30000);

  it('the next song closes the last song\'s vote first [previous play not closed]', async () => {
    linkOn();
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startEventSet(dj);
    await logTrack(rig, dj, setId, 'trk-a');
    sent = [];
    await logTrack(rig, dj, setId, 'trk-b');
    expect(sent[0]!.url).toBe(
      `${OSE}/api/v2/admin/events/${OSE_EVENT}/votables/objects/vobj_${'1'.padStart(32, '0')}/close`
    );
    expect(sent.slice(1).map((s) => s.url.split('/votables')[1])).toEqual([
      '/objects',
      `/objects/vobj_${'2'.padStart(32, '0')}/open`,
    ]);
  }, 30000);

  it('a replay of the same song is a new object: one vote per play [link keyed to the track]', async () => {
    linkOn();
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startEventSet(dj);
    await logTrack(rig, dj, setId, 'trk-a');
    await logTrack(rig, dj, setId, 'trk-a');
    const ids = (await links(setId)).map((r) => r.vote_object_id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id !== null)).toBe(true);
  }, 30000);

  it('ending the set closes the open song\'s vote', async () => {
    linkOn();
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startEventSet(dj);
    await logTrack(rig, dj, setId, 'trk-a');
    sent = [];
    const res = await call(rig, 'POST', `/api/sets/${setId}/end`, { cookie: dj.cookie });
    expect(res.status).toBe(200);
    expect(sent.map((s) => s.url)).toEqual([
      `${OSE}/api/v2/admin/events/${OSE_EVENT}/votables/objects/vobj_${'1'.padStart(32, '0')}/close`,
    ]);
  }, 30000);

  it('OurSharedEvents is sent the label only: no ourWKRP id, no DJ, no name [DJ id in the body]', async () => {
    linkOn();
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startEventSet(dj);
    const play = await logTrack(rig, dj, setId, 'trk-a');
    for (const s of sent) {
      const text = `${s.url} ${JSON.stringify(s.body)}`;
      for (const secret of [dj.id, setId, play, 'Test Selector'])
        expect(text).not.toContain(secret);
      expect(Object.keys(s.body).every((k) => k === 'kind' || k === 'label')).toBe(true);
    }
  }, 30000);

  it('a set with no OurSharedEvents event sends nothing', async () => {
    linkOn();
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startSet(rig, dj);
    await logTrack(rig, dj, setId, 'trk-a');
    expect(sent).toEqual([]);
  }, 30000);

  it('a refusal (no open vote set there yet) leaves the play logged with no link [refusal thrown]', async () => {
    linkOn();
    refuse = 409;
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startEventSet(dj);
    const play = await logTrack(rig, dj, setId, 'trk-a');
    expect(await links(setId)).toEqual([{ id: play, vote_object_id: null, ended_at: null }]);
    expect((await playbackRows(rig, setId))).toHaveLength(1);
  }, 30000);

  it('no answer at all leaves the play logged with no link', async () => {
    linkOn();
    vi.stubGlobal('fetch', async () => { throw new TypeError('network down'); });
    const dj = await register(rig, 'Test Selector', 'dj');
    const setId = await startEventSet(dj);
    const play = await logTrack(rig, dj, setId, 'trk-a');
    expect(await links(setId)).toEqual([{ id: play, vote_object_id: null, ended_at: null }]);
  }, 30000);
});
