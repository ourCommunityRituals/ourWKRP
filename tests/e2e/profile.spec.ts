/**
 * E2E tests — Contributor Profile
 *
 * Tests the /contributor/:id page: loading, profile display,
 * stats, genres, playlists, and not-found state.
 */
import { test, expect } from '@playwright/test';
import { registerUser } from './helpers';

test.describe('Profile — Loading and Display', () => {
  test('valid contributor shows profile', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'ProfileUser',
      role: 'curator',
      generation: 'founder',
    });

    await page.goto(`/contributor/${user.contributorId}`);

    // Wait for profile to load
    await page.waitForSelector(
      '[data-testid="profile-view"]:not(.hidden), [data-testid="not-found"]:not(.hidden)',
      { timeout: 5000 },
    );

    await expect(page.getByTestId('profile-view')).toBeVisible();
  });

  test('shows contributor name', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'NameDisplay',
      role: 'contributor',
      generation: 'gen2',
    });

    await page.goto(`/contributor/${user.contributorId}`);
    await page.waitForSelector('[data-testid="profile-view"]:not(.hidden)', { timeout: 5000 });

    await expect(page.getByTestId('profile-name')).toContainText('NameDisplay');
  });

  test('shows avatar with first letter', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'AvatarTest',
      role: 'contributor',
      generation: 'gen3',
    });

    await page.goto(`/contributor/${user.contributorId}`);
    await page.waitForSelector('[data-testid="profile-view"]:not(.hidden)', { timeout: 5000 });

    await expect(page.getByTestId('profile-avatar')).toContainText('A');
  });

  test('shows generation', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'GenTest',
      role: 'contributor',
      generation: 'founder',
    });

    await page.goto(`/contributor/${user.contributorId}`);
    await page.waitForSelector('[data-testid="profile-view"]:not(.hidden)', { timeout: 5000 });

    await expect(page.getByTestId('profile-generation')).toContainText('founder');
  });

  test('shows role badge', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'RoleBadge',
      role: 'curator',
      generation: 'gen2',
    });

    await page.goto(`/contributor/${user.contributorId}`);
    await page.waitForSelector('[data-testid="profile-view"]:not(.hidden)', { timeout: 5000 });

    await expect(page.getByTestId('profile-roles')).toContainText('curator');
  });
});

test.describe('Profile — Stats Cards', () => {
  test('displays stats row with tracks, playlists, brands', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'StatsUser',
      role: 'contributor',
      generation: 'founder',
    });

    await page.goto(`/contributor/${user.contributorId}`);
    await page.waitForSelector('[data-testid="profile-view"]:not(.hidden)', { timeout: 5000 });

    await expect(page.getByTestId('stats-row')).toBeVisible();
    await expect(page.getByTestId('stat-tracks')).toBeVisible();
    await expect(page.getByTestId('stat-playlists')).toBeVisible();
    await expect(page.getByTestId('stat-brands')).toBeVisible();
  });

  test('new user has 0 tracks', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'ZeroTracks',
      role: 'contributor',
      generation: 'gen3',
    });

    await page.goto(`/contributor/${user.contributorId}`);
    await page.waitForSelector('[data-testid="profile-view"]:not(.hidden)', { timeout: 5000 });

    await expect(page.getByTestId('stat-tracks')).toContainText('0');
  });
});

test.describe('Profile — Not Found', () => {
  test('invalid UUID shows not found', async ({ page }) => {
    await page.goto('/contributor/00000000-0000-0000-0000-000000000000');

    await page.waitForSelector(
      '[data-testid="not-found"]:not(.hidden)',
      { timeout: 5000 },
    );

    await expect(page.getByTestId('not-found')).toBeVisible();
    await expect(page.getByTestId('not-found')).toContainText('not found');
  });

  test('random string ID shows not found', async ({ page }) => {
    await page.goto('/contributor/nonexistent-id');

    await page.waitForSelector(
      '[data-testid="not-found"]:not(.hidden)',
      { timeout: 5000 },
    );
    await expect(page.getByTestId('not-found')).toBeVisible();
  });
});

test.describe('Profile — Navigation', () => {
  test('bottom nav has catalog and create links', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'ProfileNav',
      role: 'contributor',
      generation: 'gen2',
    });

    await page.goto(`/contributor/${user.contributorId}`);
    await page.waitForSelector('[data-testid="profile-view"]:not(.hidden)', { timeout: 5000 });

    await expect(page.getByTestId('nav-catalog')).toBeVisible();
    await expect(page.getByTestId('nav-create')).toBeVisible();
  });

  test('updates page title with contributor name', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'TitleTest',
      role: 'contributor',
      generation: 'gen2',
    });

    await page.goto(`/contributor/${user.contributorId}`);
    await page.waitForSelector('[data-testid="profile-view"]:not(.hidden)', { timeout: 5000 });

    await expect(page).toHaveTitle(/TitleTest/);
  });
});

test.describe('Profile — No JS Errors', () => {
  test('profile page loads without JavaScript errors', async ({ page }) => {
    const user = await registerUser(page.request, {
      name: 'NoErrorProfile',
      role: 'contributor',
      generation: 'founder',
    });

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`/contributor/${user.contributorId}`);
    await page.waitForTimeout(2000);

    const critical = errors.filter(
      (e) =>
        !e.includes('fetch') &&
        !e.includes('NetworkError') &&
        !e.includes('Failed to fetch'),
    );
    expect(critical).toHaveLength(0);
  });
});
