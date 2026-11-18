/**
 * E2E — the DJ live page shows the song playing now (OW-219).
 *
 * `/dj/:id/live` returns `live_set.now_playing` (the set's open playback
 * event, or null), and live.html shows it above the set list. The unit layer
 * (tests/unit/live-now-playing.test.ts) runs the render function on a stub;
 * this spec drives the real page in a browser.
 *
 * Two parts:
 *   - Page behaviour, with the live JSON served by `page.route` and the
 *     15-second poll driven by Playwright's clock, so each case controls exactly
 *     what the poll returns (a hostile name, an unchanged id, a replay).
 *   - One full-stack journey against the local worker: a DJ starts a set, logs
 *     a song, replays it and ends the set, and the page follows each step.
 *
 * Track and artist names are made up and neutral.
 */
import type { Page, Route } from '@playwright/test';
import { test, expect, registerAs } from './fixtures';

const DJ_ID = '00000000-0000-4000-8000-00000000ab01';
const POLL_MS = 15_000;

type NowPlaying = {
  playback_event_id: string;
  started_at: string;
  track: { id: string; name: string; artist: string; album: string | null; image_url: string | null };
} | null;

const song = (playbackEventId: string, name: string, artist: string, trackId = 'trk-1'): NowPlaying => ({
  playback_event_id: playbackEventId,
  started_at: '2026-11-18 21:04:00',
  track: { id: trackId, name, artist, album: 'Quiet Album', image_url: null },
});

const SET_LIST = [
  { id: 'trk-2', name: 'Harbor Lights', artist: 'Paper Kites Collective', album: null, image_url: null, genre: null, played_at: '2026-11-18 21:08:00' },
  { id: 'trk-1', name: 'Lantern Walk', artist: 'The Quiet Hours', album: null, image_url: null, genre: null, played_at: '2026-11-18 21:04:00' },
];

/**
 * Serves /dj/:id/live from `state.nowPlaying` (and `state.live`), counting
 * every request so a test can wait for a poll to have landed.
 */
async function serveLive(page: Page, state: { nowPlaying: NowPlaying; live: boolean; hits: number }) {
  await page.route('**/auth/session/me', (route: Route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));
  await page.route(`**/dj/${DJ_ID}/live`, (route: Route) => {
    state.hits++;
    const body = {
      ok: true,
      dj: { id: DJ_ID, name: 'Neighbourhood DJ' },
      live_set: state.live ? {
        id: 'set-1', venue_name: 'Corner Hall', started_at: '2026-11-18 21:00:00',
        now_playing: state.nowPlaying, tracks: SET_LIST,
      } : null,
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** Advance the page clock by one poll and wait until the poll's request was served. */
async function nextPoll(page: Page, state: { hits: number }) {
  const before = state.hits;
  await page.clock.runFor(POLL_MS);
  await expect.poll(() => state.hits).toBeGreaterThan(before);
  // Let the poll's fetch/json resolve and render before the test reads the DOM.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  await page.waitForLoadState('domcontentloaded');
}

async function openLivePage(page: Page, state: { nowPlaying: NowPlaying; live: boolean; hits: number }) {
  await serveLive(page, state);
  await page.clock.install();
  await page.goto(`/dj/${DJ_ID}`);
  await expect(page.getByTestId('live-view')).toBeVisible();
}

test.describe('DJ live page — now playing (page behaviour)', () => {
  test('shows the song playing now above the set list, with words, name and artist', async ({ page }) => {
    const state = { nowPlaying: song('pe-aaa', 'Lantern Walk', 'The Quiet Hours'), live: true, hits: 0 };
    await openLivePage(page, state);

    const block = page.getByTestId('now-playing');
    await expect(block).toBeVisible();
    await expect(page.getByTestId('now-playing-label')).toHaveText('Now playing');
    await expect(page.getByTestId('now-playing-track')).toHaveText('Lantern Walk');
    await expect(page.getByTestId('now-playing-artist')).toHaveText('The Quiet Hours');
    await expect(block).toHaveAttribute('data-playback-event-id', 'pe-aaa');
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible();
    // A change is heard politely: the block sits inside a polite live region.
    await expect(page.getByTestId('now-playing-live')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('now-playing-live').getByTestId('now-playing')).toHaveCount(1);

    // Above the set list, and the set list is unchanged: every song, each with its tap button.
    const blockBox = await block.boundingBox();
    const listBox = await page.getByTestId('track-list').boundingBox();
    expect(blockBox!.y + blockBox!.height).toBeLessThanOrEqual(listBox!.y);
    await expect(page.getByTestId('track-card')).toHaveCount(2);
    await expect(page.getByTestId('attr-btn')).toHaveCount(2);
    await expect(block.getByRole('button')).toHaveCount(0);
  });

  test('is not shown when nothing is playing, and the list makes no claim either', async ({ page }) => {
    const state = { nowPlaying: null as NowPlaying, live: true, hits: 0 };
    await openLivePage(page, state);

    await expect(page.getByTestId('track-card')).toHaveCount(2);
    await expect(page.getByTestId('now-playing')).toBeHidden();
    // innerText, not toContainText: the hidden block's own label is in textContent.
    expect(await page.getByTestId('live-view').innerText()).not.toMatch(/now playing/i);
  });

  test('follows the poll: next song, the same song replayed, the song ending, the set ending', async ({ page }) => {
    const state = { nowPlaying: song('pe-aaa', 'Lantern Walk', 'The Quiet Hours'), live: true, hits: 0 };
    await openLivePage(page, state);
    const block = page.getByTestId('now-playing');
    await expect(block).toHaveAttribute('data-playback-event-id', 'pe-aaa');

    state.nowPlaying = song('pe-bbb', 'Harbor Lights', 'Paper Kites Collective', 'trk-2');
    await nextPoll(page, state);
    await expect(page.getByTestId('now-playing-track')).toHaveText('Harbor Lights');
    await expect(page.getByTestId('now-playing-artist')).toHaveText('Paper Kites Collective');
    await expect(block).toHaveAttribute('data-playback-event-id', 'pe-bbb');

    // A replay: same words, new playback event id.
    state.nowPlaying = song('pe-ccc', 'Harbor Lights', 'Paper Kites Collective', 'trk-2');
    await nextPoll(page, state);
    await expect(block).toHaveAttribute('data-playback-event-id', 'pe-ccc');
    await expect(page.getByTestId('now-playing-track')).toHaveText('Harbor Lights');

    state.nowPlaying = null;
    await nextPoll(page, state);
    await expect(block).toBeHidden();

    state.nowPlaying = song('pe-ddd', 'Lantern Walk', 'The Quiet Hours');
    await nextPoll(page, state);
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute('data-playback-event-id', 'pe-ddd');

    state.live = false;
    await nextPoll(page, state);
    await expect(block).toBeHidden();
  });

  test('a poll with the same playback event leaves the block untouched', async ({ page }) => {
    const state = { nowPlaying: song('pe-aaa', 'Lantern Walk', 'The Quiet Hours'), live: true, hits: 0 };
    await openLivePage(page, state);
    await expect(page.getByTestId('now-playing')).toBeVisible();

    await page.evaluate(() => {
      const w = window as unknown as { __npMutations: number };
      w.__npMutations = 0;
      new MutationObserver((records) => { w.__npMutations += records.length; })
        .observe(document.querySelector('[data-testid="now-playing-live"]')!, {
          subtree: true, childList: true, attributes: true, characterData: true,
        });
    });
    await nextPoll(page, state);
    await nextPoll(page, state);
    expect(state.hits).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => (window as unknown as { __npMutations: number }).__npMutations)).toBe(0);
  });

  test('API values render as text, never as markup', async ({ page }) => {
    const hostile = '<img src=x onerror="window.__npXss=1">';
    const state = { nowPlaying: song('pe-aaa', hostile, '<b>Loud</b> & "Quoted"'), live: true, hits: 0 };
    await openLivePage(page, state);

    await expect(page.getByTestId('now-playing-track')).toHaveText(hostile);
    await expect(page.getByTestId('now-playing-artist')).toHaveText('<b>Loud</b> & "Quoted"');
    await expect(page.getByTestId('now-playing').locator('img, b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __npXss?: number }).__npXss)).toBeUndefined();
  });

  test('shows no playback event id, no count and no time as text', async ({ page }) => {
    const state = { nowPlaying: song('pe-7f3a9c', 'Lantern Walk', 'The Quiet Hours'), live: true, hits: 0 };
    await openLivePage(page, state);

    const text = await page.getByTestId('now-playing').innerText();
    expect(text).not.toContain('pe-7f3a9c');
    expect(text).not.toContain('21:04');
    expect(text).not.toMatch(/\d/); // the fixture words carry no digits, so any digit is a count or a clock
    expect(text).not.toMatch(/\bago\b|\bmin\b|started/i);
    expect(await page.locator('body').innerText()).not.toContain('pe-7f3a9c');
  });

  test('at phone width (375) a long name wraps without sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const long = 'A Very Long Song Title That Keeps Going Past The Edge Of A Small Phone Screen';
    const state = { nowPlaying: song('pe-aaa', long, 'An Ensemble With A Rather Long Name As Well'), live: true, hits: 0 };
    await openLivePage(page, state);
    await expect(page.getByTestId('now-playing-track')).toHaveText(long);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});

/** Two neutral songs, imported so the full-stack journey has tracks to log. */
const JOURNEY_CSV = [
  'Track URI,Track Name,Artist Name(s),Album Name,ISRC,Album Release Date,Energy,Danceability,Valence,Artist Genres,Track Duration (ms)',
  'spotify:track:npj00000000000000001,Porchlight Waltz,Maple Street Band,Evening Songs,USNP00000001,2020-05-01,0.40,0.50,0.50,test-folk,200000',
  'spotify:track:npj00000000000000002,Rooftop Garden,Maple Street Band,Evening Songs,USNP00000002,2020-05-02,0.45,0.55,0.50,test-folk,210000',
].join('\n');

test.describe('DJ live page — now playing (full stack, local worker)', () => {
  test('follows the DJ: a song logged, the same song replayed, the set ended', async ({ page, request }) => {
    const { id: djId, cookie } = await registerAs(request, { name: 'Journey DJ', role: 'dj', generation: 'founder' });

    const imported = await request.post(`/import/${djId}`, {
      headers: { cookie },
      data: { csv: JOURNEY_CSV, source_type: 'manual', source_name: 'now-playing-fixture' },
    });
    expect(imported.ok()).toBe(true);
    const found = await request.get('/api/tracks?q=Porchlight');
    const { tracks } = await found.json() as { tracks: { id: string; name: string }[] };
    const porchlight = tracks.find((t) => t.name === 'Porchlight Waltz');
    expect(porchlight, 'the imported song is in the catalog').toBeTruthy();

    const started = await request.post('/api/sets', { headers: { cookie }, data: { venue_name: 'Corner Hall' } });
    expect(started.status()).toBe(201);
    const { set } = await started.json() as { set: { id: string } };

    const logSong = async () => {
      const res = await request.post(`/api/sets/${set.id}/tracks`, { headers: { cookie }, data: { track_id: porchlight!.id } });
      expect(res.status()).toBe(200);
      return (await res.json() as { playback_event: { id: string } }).playback_event.id;
    };
    const first = await logSong();

    await page.clock.install();
    await page.goto(`/dj/${djId}`);
    const block = page.getByTestId('now-playing');
    await expect(block).toBeVisible();
    await expect(page.getByTestId('now-playing-track')).toHaveText('Porchlight Waltz');
    await expect(page.getByTestId('now-playing-artist')).toHaveText('Maple Street Band');
    await expect(block).toHaveAttribute('data-playback-event-id', first);
    expect(await block.innerText()).not.toContain(first);

    const replay = await logSong();
    expect(replay).not.toBe(first);
    await page.clock.runFor(POLL_MS);
    await expect(block).toHaveAttribute('data-playback-event-id', replay);
    await expect(page.getByTestId('now-playing-track')).toHaveText('Porchlight Waltz');

    const ended = await request.post(`/api/sets/${set.id}/end`, { headers: { cookie } });
    expect(ended.ok()).toBe(true);
    await page.clock.runFor(POLL_MS);
    await expect(block).toBeHidden();
  });
});
