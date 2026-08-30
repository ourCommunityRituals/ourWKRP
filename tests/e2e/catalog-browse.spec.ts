/**
 * E2E tests — Catalog browse (mobile viewport)
 *
 * Catalog browsing is anonymous — no session required (the connect page's
 * "Browse the Catalog" action links straight here). The create page requires
 * a session whose role can curate (founder / curator / dj), so those tests
 * register a real curator via the API first.
 */
import { test, expect } from './fixtures';

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

  test('filter chips respond to interaction', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-view')).toBeVisible();
    const highEnergy = page.getByTestId('filter-energy');
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

  test('range sliders are interactive', async ({ page }) => {
    await page.goto('/create');
    const energyRange = page.getByTestId('create-range-energy');
    await expect(energyRange).toBeVisible();
    await energyRange.fill('50');
    await expect(energyRange).toHaveValue('50');
  });
});
