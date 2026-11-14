/**
 * E2E: a withheld count reads "Fewer than 5" in the browser, never 0, NaN,
 * "null" or blank (owner rule 2026-11-14). /api/stats is answered by the test
 * so each page is seen with the count withheld and with it published.
 */
import { test, expect } from './fixtures';

function statsBody(contributors: number | null) {
  return JSON.stringify({
    ok: true,
    stats: {
      total_tracks: 12,
      total_contributors: contributors,
      total_contributors_suppressed: contributors === null,
      reporting_floor: 5,
      total_playlists: 1,
      top_genres: [],
      top_decades: [],
      has_audio_features: false,
    },
  });
}

test.describe('Withheld counts read in words', () => {
  test('stats page: a withheld contributor count reads "Fewer than 5"', async ({ page }) => {
    await page.route('**/api/stats', (route) => route.fulfill({ contentType: 'application/json', body: statsBody(null) }));
    await page.goto('/stats');
    await expect(page.locator('#total-contributors')).toHaveText('Fewer than 5');
    await expect(page.locator('#total-tracks')).toHaveText('12');
    // The tile that only ever showed a hardcoded 0 is gone.
    await expect(page.getByText('DJ Attributions')).toHaveCount(0);
    for (const id of ['#total-tracks', '#total-contributors', '#total-playlists']) {
      await expect(page.locator(id)).not.toHaveText(/^$|^0$|NaN|null|undefined/);
    }
  });

  test('stats page: a published contributor count reads as the number', async ({ page }) => {
    await page.route('**/api/stats', (route) => route.fulfill({ contentType: 'application/json', body: statsBody(7) }));
    await page.goto('/stats');
    await expect(page.locator('#total-contributors')).toHaveText('7');
  });

  test('catalog page: a withheld contributor count reads "Fewer than 5 contributors"', async ({ page }) => {
    await page.route('**/api/stats', (route) => route.fulfill({ contentType: 'application/json', body: statsBody(null) }));
    await page.goto('/catalog');
    await expect(page.locator('#sync-status')).toHaveText('12 tracks · Fewer than 5 contributors');
  });
});
