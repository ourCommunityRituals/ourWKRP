/**
 * E2E tests — Connect flow (mobile viewport)
 *
 * Tests Screen 1 (contributor form) rendering and validation.
 * Spotify redirect is tested up to the redirect point.
 */
import { test, expect } from '@playwright/test';

test.describe('Connect Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders connect page with form', async ({ page }) => {
    await expect(page.getByTestId('connect-form')).toBeVisible();
    await expect(page.getByTestId('input-name')).toBeVisible();
    await expect(page.getByTestId('select-generation')).toBeVisible();
    await expect(page.getByTestId('btn-connect')).toBeVisible();
  });

  test('shows ourWKRP branding', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('ourWKRP');
  });

  test('name input accepts text', async ({ page }) => {
    const nameInput = page.getByTestId('input-name');
    await nameInput.fill('Matt');
    await expect(nameInput).toHaveValue('Matt');
  });

  test('generation dropdown has all options', async ({ page }) => {
    const select = page.getByTestId('select-generation');
    const options = select.locator('option');
    // 4 options: disabled placeholder + founder + gen2 + gen3
    await expect(options).toHaveCount(4);
  });

  test('connect button shows Spotify icon', async ({ page }) => {
    const btn = page.getByTestId('btn-connect');
    await expect(btn).toContainText('Connect with Spotify');
    // SVG should be present
    await expect(btn.locator('svg')).toBeVisible();
  });

  test('validates empty name on submit', async ({ page }) => {
    // Select generation but leave name empty
    await page.getByTestId('select-generation').selectOption('founder');
    await page.getByTestId('btn-connect').click();

    // HTML5 validation should prevent submit (required attribute)
    // The form should still be visible (not navigated away)
    await expect(page.getByTestId('connect-form')).toBeVisible();
  });

  test('redirects to /auth/start with correct params', async ({ page }) => {
    await page.getByTestId('input-name').fill('Matt');
    await page.getByTestId('select-generation').selectOption('founder');

    // Listen for navigation
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/auth/start')),
      page.getByTestId('btn-connect').click(),
    ]);

    expect(request.url()).toContain('name=Matt');
    expect(request.url()).toContain('gen=founder');
  });

  test('displays error banner when error param in URL', async ({ page }) => {
    await page.goto('/?error=spotify_denied');
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('denied');
  });

  test('redirects to catalog when session param exists', async ({ page }) => {
    await page.goto('/?session=test-session-123');
    // Should redirect to /catalog
    await page.waitForURL(/\/catalog/);
  });
});
