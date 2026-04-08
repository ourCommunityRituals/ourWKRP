/**
 * E2E tests — Catalog browse (mobile viewport)
 *
 * Tests catalog page rendering, search, filters, and navigation.
 * Uses real HttpOnly session cookies via /auth/register.
 */
import { test, expect } from '@playwright/test';
import { registerAndGo, clearSession } from './helpers';

test.describe('Catalog — Unauthenticated', () => {
  test('catalog page loads without session (public browsing)', async ({ page }) => {
    await page.goto('/catalog');
    // Catalog should still load — it's public, just without user badge
    await expect(page.getByTestId('loading-view')).toBeVisible();
  });

  test('loading state shows spinner and text', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.getByTestId('loading-text')).toBeVisible();
    await expect(page.getByTestId('loading-text')).toContainText('Loading');
  });
});

test.describe('Catalog — Authenticated Browse', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGo(page, {
      name: 'CatalogTestUser',
      role: 'curator',
      generation: 'founder',
      goto: '/catalog',
    });
  });

  test('shows user badge with contributor name', async ({ page }) => {
    // Wait for session fetch to complete
    await page.waitForFunction(
      () => document.getElementById('user-badge')?.textContent !== '',
      { timeout: 5000 },
    ).catch(() => {});
    const badge = page.getByTestId('user-badge');
    await expect(badge).toContainText('CatalogTestUser');
  });

  test('search bar is visible and accepts input', async ({ page }) => {
    // Wait for catalog view to appear
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 5000 }).catch(() => {});
    const search = page.getByTestId('search-input');
    await expect(search).toBeVisible();
    await search.fill('Miles');
    await expect(search).toHaveValue('Miles');
  });

  test('filter chips are all visible', async ({ page }) => {
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 5000 }).catch(() => {});
    await expect(page.getByTestId('filter-all')).toBeVisible();
    await expect(page.getByTestId('filter-energy')).toBeVisible();
    await expect(page.getByTestId('filter-chill')).toBeVisible();
    await expect(page.getByTestId('filter-happy')).toBeVisible();
    await expect(page.getByTestId('filter-dance')).toBeVisible();
    await expect(page.getByTestId('filter-acoustic')).toBeVisible();
    await expect(page.getByTestId('filter-advanced')).toBeVisible();
  });

  test('"All" filter is active by default', async ({ page }) => {
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 5000 }).catch(() => {});
    await expect(page.getByTestId('filter-all')).toHaveClass(/active/);
  });

  test('clicking filter chip changes active state', async ({ page }) => {
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 5000 }).catch(() => {});
    const energyChip = page.getByTestId('filter-energy');
    await energyChip.click();
    await expect(energyChip).toHaveClass(/active/);
    await expect(page.getByTestId('filter-all')).not.toHaveClass(/active/);
  });

  test('"Filters" chip toggles range sliders', async ({ page }) => {
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 5000 }).catch(() => {});
    // Range filters hidden by default
    await expect(page.getByTestId('range-filters')).not.toHaveClass(/visible/);
    // Click "Filters" chip
    await page.getByTestId('filter-advanced').click();
    await expect(page.getByTestId('range-filters')).toHaveClass(/visible/);
    // Click again to hide
    await page.getByTestId('filter-advanced').click();
    await expect(page.getByTestId('range-filters')).not.toHaveClass(/visible/);
  });

  test('range slider updates displayed value', async ({ page }) => {
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 5000 }).catch(() => {});
    await page.getByTestId('filter-advanced').click();
    const energyRange = page.getByTestId('range-energy');
    await energyRange.fill('75');
    await expect(page.locator('#energy-value')).toContainText('75');
  });

  test('bottom nav has catalog, create, and import links', async ({ page }) => {
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 5000 }).catch(() => {});
    await expect(page.getByTestId('nav-catalog')).toBeVisible();
    await expect(page.getByTestId('nav-create')).toBeVisible();
    await expect(page.getByTestId('nav-import')).toBeVisible();
  });

  test('catalog nav item is active', async ({ page }) => {
    await page.waitForSelector('[data-testid="catalog-view"]:not(.hidden)', { timeout: 5000 }).catch(() => {});
    await expect(page.getByTestId('nav-catalog')).toHaveClass(/active/);
  });

  test('no JavaScript errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(2000);
    // Filter expected errors (API calls may fail in test env)
    const unexpectedErrors = errors.filter(
      (e) => !e.includes('fetch') && !e.includes('NetworkError') && !e.includes('Failed to fetch'),
    );
    expect(unexpectedErrors).toHaveLength(0);
  });
});

test.describe('Catalog — Create Page Link', () => {
  test('navigating to /create shows create form', async ({ page }) => {
    await registerAndGo(page, {
      name: 'CreateTestUser',
      role: 'contributor',
      generation: 'gen2',
      goto: '/create',
    });
    await expect(page.getByTestId('create-form')).toBeVisible();
    await expect(page.getByTestId('input-playlist-name')).toBeVisible();
    await expect(page.getByTestId('btn-create')).toBeVisible();
  });

  test('create page range sliders are interactive', async ({ page }) => {
    await registerAndGo(page, {
      name: 'SliderTestUser',
      role: 'contributor',
      generation: 'gen2',
      goto: '/create',
    });
    const energyRange = page.getByTestId('create-range-energy');
    await expect(energyRange).toBeVisible();
    await energyRange.fill('60');
    await expect(page.locator('#min-energy-val')).toContainText('60');
  });
});
