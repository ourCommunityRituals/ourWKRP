/**
 * E2E tests — Catalog browse (mobile viewport)
 *
 * Catalog browsing is anonymous — no session required (the connect page's
 * "Browse the Catalog" action links straight here). The create page requires
 * a session whose role can curate (founder / curator / dj), so those tests
 * register a real curator via the API first.
 */
import { test, expect } from '@playwright/test';

test.describe('Catalog Browse', () => {
  test('is browsable without a session', async ({ page }) => {
    await page.goto('/catalog');
    // Anonymous browse: stays on /catalog, no redirect to the connect page.
    await expect(page).toHaveURL(/\/catalog/);
    await expect(page.getByTestId('catalog-view')).toBeVisible();
  });

  test('renders its core structure', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-view')).toBeVisible();
    await expect(page.getByTestId('search-input')).toBeVisible();
    await expect(page.getByTestId('track-list')).toBeVisible();
    await expect(page.getByTestId('bottom-nav')).toBeVisible();
  });

  test('audio-feature chips stay hidden when the catalog has no audio features (OW-120)', async ({ page }) => {
    await page.route('**/api/stats', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stats: {
            total_tracks: 12,
            total_contributors: 2,
            total_playlists: 1,
            top_genres: [],
            top_decades: [],
            has_audio_features: false,
          },
        }),
      });
    });

    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-view')).toBeVisible();
    // Filtering on features the catalog does not have only returns empty lists.
    await expect(page.getByTestId('audio-feature-chips')).toBeHidden();
    await expect(page.getByTestId('filter-all')).toBeVisible();
  });

  test('filter chips respond to interaction when audio features exist', async ({ page }) => {
    await page.route('**/api/stats', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stats: {
            total_tracks: 12,
            total_contributors: 2,
            total_playlists: 1,
            top_genres: [],
            top_decades: [],
            has_audio_features: true,
          },
        }),
      });
    });

    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-view')).toBeVisible();
    const highEnergy = page.getByTestId('filter-energy');
    await expect(highEnergy).toBeVisible();
    await highEnergy.click();
    await expect(highEnergy).toHaveClass(/active/);
  });

  test('bottom nav links to catalog, create, and import', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-view')).toBeVisible();
    await expect(page.getByTestId('nav-catalog')).toHaveAttribute('href', '/catalog');
    await expect(page.getByTestId('nav-create')).toHaveAttribute('href', '/create');
    await expect(page.getByTestId('nav-import')).toHaveAttribute('href', '/import');
  });
});

test.describe('Create Page', () => {
  // The create page redirects to / without a session; register a curator first.
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post('/auth/register', {
      data: { name: 'E2E Curator', role: 'curator', generation: 'gen2' },
    });
    expect(res.status()).toBe(201);
  });

  test('renders the playlist form for a curator session', async ({ page }) => {
    await page.goto('/create');
    await expect(page.getByTestId('create-form')).toBeVisible();
    await expect(page.getByTestId('input-playlist-name')).toBeVisible();
    await expect(page.getByTestId('btn-create')).toBeVisible();
  });

  test('range sliders are interactive when audio features exist', async ({ page }) => {
    await page.route('**/api/stats', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stats: {
            total_tracks: 12,
            total_contributors: 2,
            total_playlists: 1,
            top_genres: [],
            top_decades: [],
            has_audio_features: true,
          },
        }),
      });
    });

    await page.goto('/create');
    const energyRange = page.getByTestId('create-range-energy');
    await expect(energyRange).toBeVisible();
    await energyRange.fill('50');
    await expect(energyRange).toHaveValue('50');
  });

  test('audio-feature sliders stay hidden when the catalog has no audio features (OW-120)', async ({ page }) => {
    await page.route('**/api/stats', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stats: {
            total_tracks: 12,
            total_contributors: 2,
            total_playlists: 1,
            top_genres: [],
            top_decades: [],
            has_audio_features: false,
          },
        }),
      });
    });

    await page.goto('/create');
    await expect(page.getByTestId('create-form')).toBeVisible();
    await expect(page.getByTestId('audio-feature-section')).toBeHidden();
  });
});
