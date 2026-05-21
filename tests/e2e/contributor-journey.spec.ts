/**
 * E2E — Contributor journey (the explicit opt-in)
 *
 * The deliberate "I want this" path: a visitor plants their flag — enters a
 * name, picks "Bring Your Music", becomes a named contributor, and brings their
 * library in. Asserts the choice is explicit and lands the user as a real,
 * non-anonymous contributor who can actually contribute.
 */
import { test, expect } from '@playwright/test';

// Resolved relative to the repo root (Playwright's working directory).
const FIXTURE_CSV = 'tests/integration/fixtures/test-library.csv';

test.describe('Contributor journey — explicit opt-in', () => {
  test('"Bring Your Music" registers a named contributor and lands on import', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Journey Jane');
    await page.getByTestId('btn-bring').click();

    // Flag planted: redirected to /import, signed in as a named contributor.
    await page.waitForURL(/\/import/);
    await expect(page.getByTestId('import-view')).toBeVisible();
    await expect(page.getByTestId('user-badge')).toHaveText('Journey Jane');
  });

  test('a contributor brings their library and the import succeeds', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Import Iris');
    await page.getByTestId('btn-bring').click();
    await page.waitForURL(/\/import/);
    await expect(page.getByTestId('import-view')).toBeVisible();

    // Bring the music: upload the CSV fixture through the import UI.
    await page.getByTestId('file-input').setInputFiles(FIXTURE_CSV);
    const uploadBtn = page.getByTestId('upload-btn');
    await expect(uploadBtn).toBeEnabled();
    await uploadBtn.click();

    await expect(page.getByTestId('result-success')).toBeVisible();
  });

  test('the import page bounces an anonymous visitor back to connect', async ({ page }) => {
    await page.goto('/import');
    // No session → import.html redirects to the connect page.
    await page.waitForURL((url) => new URL(url).pathname === '/');
  });

  test('a DJ reaches the dashboard', async ({ page }) => {
    // The dashboard needs a DJ session — register one into the page context.
    const res = await page.request.post('/auth/register', {
      data: { name: 'Dash DJ', role: 'dj', generation: 'founder' },
    });
    expect(res.status()).toBe(201);

    await page.goto('/dashboard');
    await expect(page.getByTestId('start-set-btn')).toBeVisible();
  });
});
