/**
 * E2E tests — Import flow
 *
 * Tests the CSV import page: access control, file selection,
 * preview, upload, results, and reset.
 */
import { test, expect } from '@playwright/test';
import { registerUser, registerAndGo, clearSession, fixturePath } from './helpers';

test.describe('Import — Access Control', () => {
  test('no session → redirected to connect page', async ({ page, context }) => {
    await clearSession(context);
    await page.goto('/import');
    await page.waitForURL(/\/\?/, { timeout: 5000 });
  });

  test('listener sees "Import Restricted" message', async ({ page }) => {
    await registerUser(page.request, {
      name: 'ListenerImport',
      role: 'listener',
      generation: 'gen3',
    });
    await page.goto('/import');

    // Wait for access check
    await page.waitForSelector('[data-testid="access-denied"]:not(.hidden), [data-testid="import-view"]:not(.hidden)', { timeout: 5000 });
    await expect(page.getByTestId('access-denied')).toBeVisible();
    await expect(page.getByTestId('access-denied')).toContainText('Import Restricted');
  });

  test('contributor sees "Import Restricted" message', async ({ page }) => {
    await registerUser(page.request, {
      name: 'ContributorImport',
      role: 'contributor',
      generation: 'gen2',
    });
    await page.goto('/import');

    await page.waitForSelector('[data-testid="access-denied"]:not(.hidden), [data-testid="import-view"]:not(.hidden)', { timeout: 5000 });
    await expect(page.getByTestId('access-denied')).toBeVisible();
  });

  test('curator sees import view (not restricted)', async ({ page }) => {
    await registerUser(page.request, {
      name: 'CuratorImport',
      role: 'curator',
      generation: 'founder',
    });
    await page.goto('/import');

    await page.waitForSelector('[data-testid="import-view"]:not(.hidden)', { timeout: 5000 });
    await expect(page.getByTestId('import-view')).toBeVisible();
    await expect(page.getByTestId('drop-zone')).toBeVisible();
  });

  test('DJ sees import view (not restricted)', async ({ page }) => {
    await registerUser(page.request, {
      name: 'DJImport',
      role: 'dj',
      generation: 'gen2',
    });
    await page.goto('/import');

    await page.waitForSelector('[data-testid="import-view"]:not(.hidden)', { timeout: 5000 });
    await expect(page.getByTestId('import-view')).toBeVisible();
  });
});

test.describe('Import — Page Elements', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGo(page, {
      name: 'ImportTester',
      role: 'curator',
      generation: 'founder',
      goto: '/import',
    });
    await page.waitForSelector('[data-testid="import-view"]:not(.hidden)', { timeout: 5000 });
  });

  test('shows user badge with name', async ({ page }) => {
    await expect(page.getByTestId('user-badge')).toContainText('ImportTester');
  });

  test('drop zone shows tap and drag hints', async ({ page }) => {
    await expect(page.getByTestId('drop-zone')).toContainText('Tap to select');
    await expect(page.getByTestId('drop-zone')).toContainText('drag and drop');
  });

  test('upload button is disabled before file selection', async ({ page }) => {
    await expect(page.getByTestId('upload-btn')).toBeDisabled();
  });

  test('bottom nav has catalog, import, and create links', async ({ page }) => {
    await expect(page.getByTestId('nav-catalog')).toBeVisible();
    await expect(page.getByTestId('nav-import')).toBeVisible();
    await expect(page.getByTestId('nav-create')).toBeVisible();
  });

  test('import nav item is active', async ({ page }) => {
    await expect(page.getByTestId('nav-import')).toHaveClass(/active/);
  });
});

test.describe('Import — File Selection and Preview', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGo(page, {
      name: 'FileTestUser',
      role: 'curator',
      generation: 'founder',
      goto: '/import',
    });
    await page.waitForSelector('[data-testid="import-view"]:not(.hidden)', { timeout: 5000 });
  });

  test('selecting CSV shows file name and enables upload', async ({ page }) => {
    const fileInput = page.getByTestId('file-input');
    await fileInput.setInputFiles(fixturePath('test-tracks.csv'));

    // File name should be displayed
    await expect(page.getByTestId('file-name')).toBeVisible();
    await expect(page.getByTestId('file-name')).toContainText('test-tracks.csv');

    // Upload button should be enabled
    await expect(page.getByTestId('upload-btn')).toBeEnabled();
  });

  test('CSV preview shows table with first rows', async ({ page }) => {
    const fileInput = page.getByTestId('file-input');
    await fileInput.setInputFiles(fixturePath('test-tracks.csv'));

    // Preview section should appear
    await expect(page.getByTestId('preview-section')).toHaveClass(/visible/);
    await expect(page.getByTestId('preview-table')).toBeVisible();

    // Should show row count
    await expect(page.getByTestId('preview-count')).toContainText('10 rows');
  });

  test('preview table has header row', async ({ page }) => {
    const fileInput = page.getByTestId('file-input');
    await fileInput.setInputFiles(fixturePath('test-tracks.csv'));

    // Check header columns exist
    const headers = page.locator('#preview-thead th');
    const count = await headers.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Import — Upload Flow', () => {
  test('clicking upload sends CSV and shows progress', async ({ page }) => {
    const result = await registerUser(page.request, {
      name: 'UploadFlowUser',
      role: 'curator',
      generation: 'founder',
    });
    await page.goto('/import');
    await page.waitForSelector('[data-testid="import-view"]:not(.hidden)', { timeout: 5000 });

    // Select file
    await page.getByTestId('file-input').setInputFiles(fixturePath('test-tracks.csv'));
    await expect(page.getByTestId('upload-btn')).toBeEnabled();

    // Click upload
    await page.getByTestId('upload-btn').click();

    // Progress section should appear
    await expect(page.getByTestId('progress-section')).toHaveClass(/visible/);

    // Wait for result (success or error)
    await page.waitForSelector('[data-testid="result-section"].visible', { timeout: 10000 });
    await expect(page.getByTestId('result-section')).toHaveClass(/visible/);
  });

  test('reset button allows importing another file', async ({ page }) => {
    await registerAndGo(page, {
      name: 'ResetTestUser',
      role: 'curator',
      generation: 'founder',
      goto: '/import',
    });
    await page.waitForSelector('[data-testid="import-view"]:not(.hidden)', { timeout: 5000 });

    // Select and upload
    await page.getByTestId('file-input').setInputFiles(fixturePath('test-tracks.csv'));
    await page.getByTestId('upload-btn').click();

    // Wait for result
    await page.waitForSelector('[data-testid="result-section"].visible', { timeout: 10000 });

    // Click reset
    await page.getByTestId('reset-btn').click();

    // Drop zone should be visible again
    await expect(page.getByTestId('drop-zone')).toBeVisible();
    await expect(page.getByTestId('upload-btn')).toBeDisabled();
  });
});
