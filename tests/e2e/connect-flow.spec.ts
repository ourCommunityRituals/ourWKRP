/**
 * E2E tests — Connect flow (mobile viewport)
 *
 * Simplified one-field flow: name input + three actions.
 *   - Browse the Catalog (anonymous read)
 *   - Bring Your Music (register + redirect to /import)
 *   - Connect Spotify (OAuth — tertiary, 5-seat dev cap)
 */
import { test, expect } from './fixtures';

test.describe('Connect Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders connect page with name input and three actions', async ({ page }) => {
    await expect(page.getByTestId('connect-form')).toBeVisible();
    await expect(page.getByTestId('input-name')).toBeVisible();
    await expect(page.getByTestId('btn-bring')).toBeVisible();
    await expect(page.getByTestId('btn-browse')).toBeVisible();
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

  test('Browse the Catalog navigates without a name', async ({ page }) => {
    await Promise.all([
      page.waitForURL(/\/catalog/),
      page.getByTestId('btn-browse').click(),
    ]);
  });

  test('Bring Your Music surfaces an error when name is empty', async ({ page }) => {
    await page.getByTestId('btn-bring').click();
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('name');
  });

  test('Spotify link surfaces an error when name is empty', async ({ page }) => {
    await page.getByTestId('btn-connect').click();
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('name');
  });

  test('Connect Spotify redirects to /auth/start with name + gen=founder', async ({ page }) => {
    await page.getByTestId('input-name').fill('Matt');

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
});
