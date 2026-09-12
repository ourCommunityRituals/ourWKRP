/**
 * E2E — Preferred-playlists portfolio
 *
 * A contributor points at Spotify playlist URLs from their profile to build a
 * portfolio of preferred playlists. Covers the owner add/remove flow, the
 * fat-finger case (a non-Spotify link), and the visitor case (no add control).
 */
import { test, expect, registerAs } from './fixtures';

const SPOTIFY_PLAYLIST = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

test.describe('Portfolio — preferred playlists', () => {
  test('a contributor adds a Spotify playlist and it appears as an embed', async ({ page }) => {
    const { id } = await registerAs(page.request, { name: 'Portfolio Pat', role: 'curator', generation: 'gen2' });

    await page.goto(`/contributor/${id}`);
    await expect(page.getByTestId('portfolio-section')).toBeVisible();
    await expect(page.getByTestId('portfolio-add')).toBeVisible();

    await page.getByTestId('portfolio-url').fill(SPOTIFY_PLAYLIST);
    await page.getByTestId('portfolio-add-btn').click();

    await expect(page.getByTestId('portfolio-embed')).toBeVisible();
  });

  test('a contributor removes a playlist from their portfolio', async ({ page }) => {
    const { id } = await registerAs(page.request, { name: 'Remove Rita', role: 'curator', generation: 'gen2' });

    await page.goto(`/contributor/${id}`);
    await page.getByTestId('portfolio-url').fill(SPOTIFY_PLAYLIST);
    await page.getByTestId('portfolio-add-btn').click();
    await expect(page.getByTestId('portfolio-item')).toBeVisible();

    await page.getByTestId('portfolio-remove').click();
    await expect(page.getByTestId('portfolio-item')).toHaveCount(0);
  });

  test('a non-Spotify link is refused with a clear error', async ({ page }) => {
    const { id } = await registerAs(page.request, { name: 'Error Ed', role: 'curator', generation: 'gen2' });

    await page.goto(`/contributor/${id}`);
    await page.getByTestId('portfolio-url').fill('https://example.com/not-a-playlist');
    await page.getByTestId('portfolio-add-btn').click();

    await expect(page.getByTestId('portfolio-error')).toBeVisible();
    await expect(page.getByTestId('portfolio-item')).toHaveCount(0);
  });

  test('the add control is hidden for a visitor who is not the owner', async ({ page, request }) => {
    // Register via the request fixture's own context so the page stays anonymous.
    const { id } = await registerAs(request, { name: 'Someone Else', role: 'curator', generation: 'gen2' });

    await page.goto(`/contributor/${id}`);
    await expect(page.getByTestId('profile-view')).toBeVisible();
    await expect(page.getByTestId('portfolio-add')).toBeHidden();
  });
});
