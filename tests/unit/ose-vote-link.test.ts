/**
 * Unit: the switch and the label for each play's vote on OurSharedEvents
 * (OW-219, src/lib/ose-vote-link.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { voteLinkEnabled, songLabel, openSongVote, closeSongVote, LABEL_MAX } from '../../src/lib/ose-vote-link';

const ON = {
  OSE_VOTE_LINK: 'on',
  OSE_VOTE_API_BASE: 'https://stg.oursharedevents.test',
  OSE_SERVICE_TOKEN_ID: 'id',
  OSE_SERVICE_TOKEN_SECRET: 'secret',
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('voteLinkEnabled', () => {
  it('needs "on", an https origin and both halves of the service token', () => {
    expect(voteLinkEnabled(ON)).toBe(true);
    expect(voteLinkEnabled({ ...ON, OSE_VOTE_LINK: 'off' })).toBe(false);
    expect(voteLinkEnabled({ ...ON, OSE_VOTE_LINK: 'ON' })).toBe(false);
    expect(voteLinkEnabled({ ...ON, OSE_VOTE_API_BASE: 'http://stg.oursharedevents.test' })).toBe(false);
    expect(voteLinkEnabled({ ...ON, OSE_VOTE_API_BASE: 'not a url' })).toBe(false);
    expect(voteLinkEnabled({ ...ON, OSE_SERVICE_TOKEN_ID: '' })).toBe(false);
    expect(voteLinkEnabled({ ...ON, OSE_SERVICE_TOKEN_SECRET: undefined })).toBe(false);
    expect(voteLinkEnabled({})).toBe(false);
  });
});

describe('songLabel', () => {
  it('is "Title by Artist", single-spaced', () => {
    expect(songLabel('  Bring  It On   Home ', 'Sam  Cooke')).toBe('Bring It On Home by Sam Cooke');
    expect(songLabel('Instrumental', null)).toBe('Instrumental');
    expect(songLabel('Instrumental', '  ')).toBe('Instrumental');
  });

  it('is cut to the limit', () => {
    const label = songLabel('x'.repeat(300), 'y');
    expect(label.length).toBe(LABEL_MAX);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('the calls', () => {
  it('an object id in the wrong shape is not kept', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ object: { id: 'vobj_../../x' } }, { status: 201 }));
    expect(await openSongVote(ON, 'evt_a', 'Song')).toBeNull();
  });

  it('an event id in the wrong shape sends nothing', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await openSongVote(ON, '../admin', 'Song')).toBeNull();
    await closeSongVote(ON, 'evt a', `vobj_${'1'.padStart(32, '0')}`);
    expect(f).not.toHaveBeenCalled();
  });

  it('no redirect is followed, so the token never goes to another host', async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test/' } }));
    vi.stubGlobal('fetch', f);
    expect(await openSongVote(ON, 'evt_a', 'Song')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'manual' });
  });
});
