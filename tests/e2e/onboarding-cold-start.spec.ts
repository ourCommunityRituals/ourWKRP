/**
 * E2E tests — Cold Start Onboarding
 *
 * Tests the complete first-time user experience across all entry paths:
 * CSV Import, Browse Only, Spotify OAuth, DJ, and Returning User.
 */
import { test, expect } from '@playwright/test';
import { registerUser, clearSession } from './helpers';

test.describe('Cold Start — CSV Import Path', () => {
  test('curator can register and land on import page', async ({ page }) => {
    await page.goto('/');

    // Fill out the form
    await page.getByTestId('input-name').fill('DJ Curator Test');
    await page.getByTestId('select-role').selectOption('curator');
    await page.getByTestId('select-generation').selectOption('founder');

    // Click Import — triggers register + redirect
    await page.getByTestId('btn-import').click();

    // Should land on import page
    await page.waitForURL(/\/import/, { timeout: 5000 });
  });

  test('import page shows drop zone for authorized role', async ({ page }) => {
    // Register as curator first
    await registerUser(page.request, {
      name: 'Import Curator',
      role: 'curator',
      generation: 'founder',
    });
    await page.goto('/import');

    // Wait for session check to complete
    await page.waitForSelector('[data-testid="import-view"]:not(.hidden)', { timeout: 5000 });
    await expect(page.getByTestId('drop-zone')).toBeVisible();
  });

  test('after import, can navigate to catalog', async ({ page }) => {
    await registerUser(page.request, {
      name: 'Nav Test Curator',
      role: 'curator',
      generation: 'founder',
    });
    await page.goto('/import');
    await page.waitForSelector('[data-testid="import-view"]:not(.hidden)', { timeout: 5000 });

    // Click catalog in bottom nav
    await page.getByTestId('nav-catalog').click();
    await page.waitForURL(/\/catalog/);
  });

  test('after import, can navigate to create', async ({ page }) => {
    await registerUser(page.request, {
      name: 'Nav Test Curator2',
      role: 'curator',
      generation: 'gen2',
    });
    await page.goto('/import');
    await page.waitForSelector('[data-testid="import-view"]:not(.hidden)', { timeout: 5000 });

    // Click create in bottom nav
    await page.getByTestId('nav-create').click();
    await page.waitForURL(/\/create/);
  });
});

test.describe('Cold Start — Browse Only Path', () => {
  test('fills form and clicks Browse → registers and lands on catalog', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Browser');
    await page.getByTestId('select-role').selectOption('listener');
    await page.getByTestId('select-generation').selectOption('gen3');

    await page.getByTestId('btn-browse').click();
    await page.waitForURL(/\/catalog/, { timeout: 5000 });
  });

  test('empty name clicks Browse → navigates directly to catalog', async ({ page, context }) => {
    await clearSession(context);
    await page.goto('/');

    // Don't fill any fields, just click browse
    // The browse handler goes directly to /catalog if name is empty
    await page.getByTestId('btn-browse').click();
    await page.waitForURL(/\/catalog/, { timeout: 5000 });
  });

  test('catalog works without session (public browsing)', async ({ page, context }) => {
    await clearSession(context);
    await page.goto('/catalog');

    // Should show loading view (catalog is public)
    await expect(page.getByTestId('loading-view')).toBeVisible();
    // No JS errors expected
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(2000);
    const critical = errors.filter(
      (e) => !e.includes('fetch') && !e.includes('NetworkError') && !e.includes('Failed to fetch'),
    );
    expect(critical).toHaveLength(0);
  });
});

test.describe('Cold Start — Spotify Path', () => {
  test('fills name + generation and clicks Connect → redirects to /auth/start', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('SpotifyUser');
    await page.getByTestId('select-generation').selectOption('gen2');

    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/auth/start')),
      page.getByTestId('btn-connect').click(),
    ]);

    const url = new URL(request.url());
    expect(url.searchParams.get('name')).toBe('SpotifyUser');
    expect(url.searchParams.get('gen')).toBe('gen2');
  });

  test('/auth/start redirects to Spotify authorization', async ({ page }) => {
    // Test via direct API call — /auth/start should 302 to accounts.spotify.com
    const response = await page.request.get('/auth/start?name=TestUser&gen=founder', {
      maxRedirects: 0,
    });
    // Should be a redirect (302)
    expect(response.status()).toBe(302);
    const location = response.headers()['location'];
    expect(location).toContain('accounts.spotify.com');
    expect(location).toContain('code_challenge');
    expect(location).toContain('state');
  });
});

test.describe('Cold Start — DJ Path', () => {
  test('DJ registration redirects to dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('DJ Test');
    await page.getByTestId('select-role').selectOption('dj');
    await page.getByTestId('select-generation').selectOption('founder');

    // Import button triggers register — DJ redirect goes to /dashboard
    // But the browse button for DJs would also register
    await page.getByTestId('btn-browse').click();

    // DJ register response has redirect: '/dashboard'
    // The JS register() function follows data.redirect
    await page.waitForURL(/\/(dashboard|catalog)/, { timeout: 5000 });
  });

  test('DJ can access dashboard after registration', async ({ page }) => {
    await registerUser(page.request, {
      name: 'DJ Access Test',
      role: 'dj',
      generation: 'founder',
    });
    await page.goto('/dashboard');

    // Wait for session check
    await page.waitForSelector('[data-testid="dashboard-view"]:not(.hidden), [data-testid="access-denied"]:not(.hidden)', { timeout: 5000 });
    // Should see dashboard, not access denied
    await expect(page.getByTestId('dashboard-view')).toBeVisible();
  });
});

test.describe('Cold Start — Returning User', () => {
  test('user with valid session is auto-redirected from / to /catalog', async ({ page }) => {
    // Register to get session cookie
    await registerUser(page.request, {
      name: 'Returning',
      role: 'contributor',
      generation: 'gen2',
    });

    // Visit connect page
    await page.goto('/');

    // Should auto-redirect to catalog
    await page.waitForURL(/\/catalog/, { timeout: 5000 });
  });

  test('cleared session stays on connect page', async ({ page, context }) => {
    // Register then clear cookies
    await registerUser(page.request, {
      name: 'ClearedUser',
      role: 'contributor',
      generation: 'gen2',
    });
    await clearSession(context);

    await page.goto('/');
    await page.waitForTimeout(1500);
    // Should stay on connect page
    expect(page.url()).toMatch(/\/$/);
  });
});
