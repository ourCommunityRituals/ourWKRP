/**
 * E2E — Signup / opt-in flow (the most critical flow)
 *
 * The make-or-break moment: a visitor either commits to the product or bounces.
 * "Bring Your Music" is the explicit opt-in — enter a name, become a named
 * contributor, land on /import able to bring a library. This spec covers it
 * most thoroughly: the happy path, every name-input fat-finger, the choice's
 * alternatives, and the guards that keep the flow flawless (no double
 * registration, session persistence, no dead-ends).
 */
import { test, expect } from '@playwright/test';

// Resolved relative to the repo root (Playwright's working directory).
const FIXTURE_CSV = 'tests/integration/fixtures/test-library.csv';

test.describe('Signup / opt-in — Bring Your Music', () => {
  test('a name + "Bring Your Music" registers a named contributor on /import', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Journey Jane');
    await page.getByTestId('btn-bring').click();

    // Flag planted: redirected to /import, signed in as a named contributor.
    await page.waitForURL(/\/import/);
    await expect(page.getByTestId('import-view')).toBeVisible();
    await expect(page.getByTestId('user-badge')).toHaveText('Journey Jane');
  });

  test('the new contributor can immediately bring their library', async ({ page }) => {
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

  test('an empty name is refused with a clear message and creates no account', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-bring').click();

    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/name/i);
    expect(new URL(page.url()).pathname).toBe('/');

    // The boundary: no deliberate action means no account.
    const session = await page.request.get('/auth/session/me');
    expect(session.status()).toBe(401);
  });

  test('a whitespace-only name is refused and creates no account', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('     ');
    await page.getByTestId('btn-bring').click();

    await expect(page.getByTestId('error-banner')).toBeVisible();
    const session = await page.request.get('/auth/session/me');
    expect(session.status()).toBe(401);
  });

  test('pressing Enter in the name field completes the opt-in', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Enter Ed');
    await page.getByTestId('input-name').press('Enter');

    await page.waitForURL(/\/import/);
    await expect(page.getByTestId('user-badge')).toHaveText('Enter Ed');
  });

  test('a name padded with whitespace is trimmed on the contributor record', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('  Trim Tina  ');
    await page.getByTestId('btn-bring').click();

    await page.waitForURL(/\/import/);
    await expect(page.getByTestId('user-badge')).toHaveText('Trim Tina');
  });

  test('markup typed into the name is sanitized, not stored raw', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Real<i>Name</i>');
    await page.getByTestId('btn-bring').click();

    // nameSchema strips <...> tags — the badge shows the cleaned name.
    await page.waitForURL(/\/import/);
    await expect(page.getByTestId('user-badge')).toHaveText('RealName');
  });

  test('the opt-in button locks during submit so a double tap cannot double-register', async ({ page }) => {
    // Slow the registration response so the in-flight busy state is observable.
    await page.route('**/auth/register', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

    await page.goto('/');
    await page.getByTestId('input-name').fill('Solo Sol');
    await page.getByTestId('btn-bring').click();

    // While the request is in flight the button is disabled — a second tap is a no-op.
    await expect(page.getByTestId('btn-bring')).toBeDisabled();
    await page.waitForURL(/\/import/);
  });
});

test.describe('Signup / opt-in — the alternatives', () => {
  test('entering a name then "Browse the Catalog" still registers the visitor', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Browser Bea');
    await page.getByTestId('btn-browse').click();

    await page.waitForURL(/\/catalog/);
    // A name + Browse opts the visitor in too, so later contributions attribute.
    const session = await page.request.get('/auth/session/me');
    expect(session.status()).toBe(200);
  });
});

test.describe('Signup / opt-in — guards and session', () => {
  test('an already signed-in visitor is taken straight to the catalog', async ({ page }) => {
    await page.request.post('/auth/register', { data: { name: 'Return Rita' } });
    await page.goto('/');
    // connect.html detects the live session and skips the signup screen.
    await page.waitForURL(/\/catalog/);
  });

  test('the session persists across pages after opt-in', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('input-name').fill('Sticky Steve');
    await page.getByTestId('btn-bring').click();
    await page.waitForURL(/\/import/);
    await expect(page.getByTestId('import-view')).toBeVisible();

    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-view')).toBeVisible();

    // Back to a gated page — still signed in, no bounce to the connect screen.
    await page.goto('/import');
    await expect(page.getByTestId('import-view')).toBeVisible();
    await expect(page.getByTestId('user-badge')).toHaveText('Sticky Steve');
  });

  test('the import page bounces an anonymous visitor back to connect', async ({ page }) => {
    await page.goto('/import');
    await page.waitForURL((url) => new URL(url).pathname === '/');
  });
});

test.describe('After opt-in — role landing', () => {
  test('a registered DJ reaches the dashboard', async ({ page }) => {
    const res = await page.request.post('/auth/register', {
      data: { name: 'Dash DJ', role: 'dj', generation: 'founder' },
    });
    expect(res.status()).toBe(201);

    await page.goto('/dashboard');
    await expect(page.getByTestId('start-set-btn')).toBeVisible();
  });
});
