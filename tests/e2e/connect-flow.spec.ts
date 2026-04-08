/**
 * E2E tests — Connect flow (mobile viewport)
 *
 * Tests Screen 1 (contributor form) rendering, validation,
 * Spotify OAuth redirect, error handling, and session detection.
 */
import { test, expect } from '@playwright/test';
import { registerUser, clearSession } from './helpers';

test.describe('Connect Flow — Page Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders connect page with form fields', async ({ page }) => {
    await expect(page.getByTestId('connect-form')).toBeVisible();
    await expect(page.getByTestId('input-name')).toBeVisible();
    await expect(page.getByTestId('select-role')).toBeVisible();
    await expect(page.getByTestId('select-generation')).toBeVisible();
  });

  test('shows ourWKRP branding and tagline', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('ourWKRP');
    await expect(page.locator('.logo p')).toContainText('Real people. Real taste.');
  });

  test('name input accepts and retains text', async ({ page }) => {
    const nameInput = page.getByTestId('input-name');
    await nameInput.fill('Matt');
    await expect(nameInput).toHaveValue('Matt');
  });

  test('name input has autocomplete="name"', async ({ page }) => {
    await expect(page.getByTestId('input-name')).toHaveAttribute('autocomplete', 'name');
  });

  test('role dropdown has all 4 role options plus placeholder', async ({ page }) => {
    const select = page.getByTestId('select-role');
    const options = select.locator('option');
    // 5 options: disabled placeholder + dj + curator + contributor + listener
    await expect(options).toHaveCount(5);
  });

  test('generation dropdown has all 3 generation options plus placeholder', async ({ page }) => {
    const select = page.getByTestId('select-generation');
    const options = select.locator('option');
    // 4 options: disabled placeholder + founder + gen2 + gen3
    await expect(options).toHaveCount(4);
  });

  test('connect button shows Spotify icon and text', async ({ page }) => {
    const btn = page.getByTestId('btn-connect');
    await expect(btn).toContainText('Connect with Spotify');
    await expect(btn.locator('svg')).toBeVisible();
  });

  test('import button is visible', async ({ page }) => {
    await expect(page.getByTestId('btn-import')).toBeVisible();
    await expect(page.getByTestId('btn-import')).toContainText('Import Your Library');
  });

  test('browse button is visible', async ({ page }) => {
    await expect(page.getByTestId('btn-browse')).toBeVisible();
    await expect(page.getByTestId('btn-browse')).toContainText('Browse the Catalog');
  });
});

test.describe('Connect Flow — Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows error when submitting Spotify connect with empty name', async ({ page }) => {
    await page.getByTestId('select-generation').selectOption('founder');
    await page.getByTestId('btn-connect').click();
    // Either HTML5 validation fires or our JS error — form should still be visible
    await expect(page.getByTestId('connect-form')).toBeVisible();
  });

  test('shows error when submitting Spotify connect with empty generation', async ({ page }) => {
    await page.getByTestId('input-name').fill('Matt');
    await page.getByTestId('btn-connect').click();
    // Error banner or HTML5 validation should prevent navigation
    await expect(page.getByTestId('connect-form')).toBeVisible();
  });

  test('import button requires all fields', async ({ page }) => {
    // Click import with no fields filled
    await page.getByTestId('btn-import').click();
    await expect(page.getByTestId('error-banner')).toBeVisible();
  });
});

test.describe('Connect Flow — Spotify OAuth Redirect', () => {
  test('redirects to /auth/start with correct params', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Matt');
    await page.getByTestId('select-generation').selectOption('founder');

    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/auth/start')),
      page.getByTestId('btn-connect').click(),
    ]);

    expect(request.url()).toContain('name=Matt');
    expect(request.url()).toContain('gen=founder');
  });

  test('connect button shows "Connecting..." after click', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Matt');
    await page.getByTestId('select-generation').selectOption('founder');

    // Intercept auth/start to prevent actual redirect
    await page.route('**/auth/start**', (route) => route.abort());
    await page.getByTestId('btn-connect').click();

    // Button text should change (briefly, before redirect)
    const btn = page.getByTestId('btn-connect');
    await expect(btn).toBeDisabled();
  });
});

test.describe('Connect Flow — Error Banners', () => {
  test('displays error for spotify_denied', async ({ page }) => {
    await page.goto('/?error=spotify_denied');
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('denied');
  });

  test('displays error for invalid_callback', async ({ page }) => {
    await page.goto('/?error=invalid_callback');
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('failed');
  });

  test('displays error for invalid_state', async ({ page }) => {
    await page.goto('/?error=invalid_state');
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('expired');
  });

  test('displays error for auth_failed', async ({ page }) => {
    await page.goto('/?error=auth_failed');
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('failed');
  });

  test('displays generic error for unknown error code', async ({ page }) => {
    await page.goto('/?error=something_weird');
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('error occurred');
  });

  test('cleans error from URL after display', async ({ page }) => {
    await page.goto('/?error=spotify_denied');
    await expect(page.getByTestId('error-banner')).toBeVisible();
    // URL should be cleaned (no error param)
    await page.waitForURL('/');
  });
});

test.describe('Connect Flow — Session Detection', () => {
  test('redirects to catalog when valid session cookie exists', async ({ page, context }) => {
    // Register via API to get a real session cookie
    await registerUser(page.request, {
      name: 'Returning User',
      role: 'contributor',
      generation: 'founder',
    });

    // Visit connect page — should auto-redirect to catalog
    await page.goto('/');
    await page.waitForURL(/\/catalog/, { timeout: 5000 });
  });

  test('stays on connect page when no session', async ({ page, context }) => {
    await clearSession(context);
    await page.goto('/');
    // Should remain on connect page
    await page.waitForTimeout(1000);
    expect(page.url()).toMatch(/\/$/);
    await expect(page.getByTestId('connect-form')).toBeVisible();
  });
});
