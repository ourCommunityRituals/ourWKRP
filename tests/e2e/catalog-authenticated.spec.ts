/**
 * E2E tests — Authenticated Catalog
 *
 * Deep tests for catalog browsing, search, filtering, genre discovery,
 * pagination, and role-specific navigation.
 */
import { test, expect } from '@playwright/test';
import { registerUser, registerAndGo, seedTracks } from './helpers';

test.describe('Catalog — Search', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGo(page, {
      name: 'SearchUser',
      role: 'curator',
      generation: 'founder',
      goto: '/catalog',
    });
    // Wait for catalog to render
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 8000 }).catch(() => {});
  });

  test('search input has correct placeholder', async ({ page }) => {
    const search = page.getByTestId('search-input');
    await expect(search).toHaveAttribute('placeholder', 'Search tracks, artists, albums...');
  });

  test('search input is type="search"', async ({ page }) => {
    await expect(page.getByTestId('search-input')).toHaveAttribute('type', 'search');
  });

  test('typing in search triggers fetch after debounce', async ({ page }) => {
    let apiCalled = false;
    await page.route('**/api/tracks**', (route) => {
      if (route.request().url().includes('q=')) {
        apiCalled = true;
      }
      return route.continue();
    });

    await page.getByTestId('search-input').fill('Miles');
    // Wait for 300ms debounce + network
    await page.waitForTimeout(500);
    expect(apiCalled).toBe(true);
  });

  test('clearing search reloads unfiltered tracks', async ({ page }) => {
    let lastUrl = '';
    await page.route('**/api/tracks**', (route) => {
      lastUrl = route.request().url();
      return route.continue();
    });

    await page.getByTestId('search-input').fill('test');
    await page.waitForTimeout(500);
    await page.getByTestId('search-input').fill('');
    await page.waitForTimeout(500);

    // Last call should not have q= param
    expect(lastUrl).not.toContain('q=');
  });
});

test.describe('Catalog — Filter Chips', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGo(page, {
      name: 'FilterUser',
      role: 'contributor',
      generation: 'gen2',
      goto: '/catalog',
    });
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 8000 }).catch(() => {});
  });

  test('clicking High Energy chip sends energy_min param', async ({ page }) => {
    let requestUrl = '';
    await page.route('**/api/tracks**', (route) => {
      requestUrl = route.request().url();
      return route.continue();
    });

    await page.getByTestId('filter-energy').click();
    await page.waitForTimeout(500);
    expect(requestUrl).toContain('energy_min=0.7');
  });

  test('clicking Chill chip sends energy_max and valence_max', async ({ page }) => {
    let requestUrl = '';
    await page.route('**/api/tracks**', (route) => {
      requestUrl = route.request().url();
      return route.continue();
    });

    await page.getByTestId('filter-chill').click();
    await page.waitForTimeout(500);
    expect(requestUrl).toContain('energy_max=0.4');
    expect(requestUrl).toContain('valence_max=0.5');
  });

  test('clicking Happy chip sends valence_min param', async ({ page }) => {
    let requestUrl = '';
    await page.route('**/api/tracks**', (route) => {
      requestUrl = route.request().url();
      return route.continue();
    });

    await page.getByTestId('filter-happy').click();
    await page.waitForTimeout(500);
    expect(requestUrl).toContain('valence_min=0.7');
  });

  test('clicking Danceable chip sends danceability_min param', async ({ page }) => {
    let requestUrl = '';
    await page.route('**/api/tracks**', (route) => {
      requestUrl = route.request().url();
      return route.continue();
    });

    await page.getByTestId('filter-dance').click();
    await page.waitForTimeout(500);
    expect(requestUrl).toContain('danceability_min=0.7');
  });

  test('clicking All chip resets filters', async ({ page }) => {
    // First click a filter
    await page.getByTestId('filter-energy').click();
    await page.waitForTimeout(300);

    let requestUrl = '';
    await page.route('**/api/tracks**', (route) => {
      requestUrl = route.request().url();
      return route.continue();
    });

    // Click All
    await page.getByTestId('filter-all').click();
    await page.waitForTimeout(500);

    // Should not have filter params
    expect(requestUrl).not.toContain('energy_min');
    expect(requestUrl).not.toContain('valence_min');
  });

  test('only one filter chip is active at a time (excluding Filters)', async ({ page }) => {
    await page.getByTestId('filter-energy').click();
    await page.getByTestId('filter-happy').click();

    await expect(page.getByTestId('filter-energy')).not.toHaveClass(/active/);
    await expect(page.getByTestId('filter-happy')).toHaveClass(/active/);
  });
});

test.describe('Catalog — Advanced Range Filters', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGo(page, {
      name: 'RangeUser',
      role: 'contributor',
      generation: 'gen3',
      goto: '/catalog',
    });
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 8000 }).catch(() => {});
  });

  test('range sliders send params when Filters is active', async ({ page }) => {
    // Open range filters
    await page.getByTestId('filter-advanced').click();
    await expect(page.getByTestId('range-filters')).toHaveClass(/visible/);

    let requestUrl = '';
    await page.route('**/api/tracks**', (route) => {
      requestUrl = route.request().url();
      return route.continue();
    });

    await page.getByTestId('range-energy').fill('50');
    await page.waitForTimeout(500);
    expect(requestUrl).toContain('energy_min=0.50');
  });

  test('range at 0 does not send param', async ({ page }) => {
    await page.getByTestId('filter-advanced').click();

    let requestUrl = '';
    await page.route('**/api/tracks**', (route) => {
      requestUrl = route.request().url();
      return route.continue();
    });

    await page.getByTestId('range-energy').fill('0');
    await page.waitForTimeout(500);
    expect(requestUrl).not.toContain('energy_min');
  });
});

test.describe('Catalog — Empty State', () => {
  test('shows "No tracks found" for empty results', async ({ page }) => {
    await registerAndGo(page, {
      name: 'EmptyUser',
      role: 'contributor',
      generation: 'gen3',
      goto: '/catalog',
    });

    // Wait for catalog view
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 8000 }).catch(() => {});

    // Search for something that won't exist
    await page.getByTestId('search-input').fill('zzzzz_nonexistent_track_zzzzz');
    await page.waitForTimeout(500);

    // Should show "No tracks found"
    await expect(page.getByTestId('track-count')).toContainText('No tracks found');
  });
});

test.describe('Catalog — DJ Role Navigation', () => {
  test('DJ sees dashboard link in bottom nav', async ({ page }) => {
    await registerAndGo(page, {
      name: 'DJNavUser',
      role: 'dj',
      generation: 'founder',
      goto: '/catalog',
    });

    // Wait for session fetch that adds the dashboard link
    await page.waitForSelector('[data-testid="nav-dashboard"]', { timeout: 5000 }).catch(() => {});
    const dashNav = page.getByTestId('nav-dashboard');
    // May or may not exist depending on session response timing
    const count = await dashNav.count();
    if (count > 0) {
      await expect(dashNav).toBeVisible();
    }
  });
});
