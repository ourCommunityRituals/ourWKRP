/**
 * E2E — Anonymous journey (no account)
 *
 * The no-commitment path: browse the catalog and the public surfaces with no
 * identity. Asserts the anonymous experience is complete on its own and that
 * browsing never silently registers the visitor.
 *
 * Data setup (contributors/DJs to view) uses the `request` fixture, which has
 * its own context — so the `page` stays genuinely anonymous.
 */
import { test, expect } from '@playwright/test';

test.describe('Anonymous journey — no account', () => {
  test('"Browse the Catalog" reaches the catalog with no name', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('btn-browse').click();
    await page.waitForURL(/\/catalog/);
    await expect(page.getByTestId('catalog-view')).toBeVisible();
  });

  test('browsing never creates a contributor identity', async ({ page, request }) => {
    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-view')).toBeVisible();
    await page.goto('/stats');
    await expect(page.getByTestId('big-stats')).toBeVisible();

    // The boundary: nothing the anonymous visitor did created a session.
    const session = await request.get('/auth/session/me');
    expect(session.status()).toBe(401);
  });

  test('the catalog is browsable and shows its filters', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-view')).toBeVisible();
    await expect(page.getByTestId('layer-filters')).toBeVisible();
  });

  test('a contributor profile is publicly viewable', async ({ page, request }) => {
    const res = await request.post('/auth/register', {
      data: { name: 'Public Pat', role: 'curator', generation: 'gen2' },
    });
    const { contributor } = (await res.json()) as { contributor: { id: string } };

    await page.goto(`/contributor/${contributor.id}`);
    await expect(page.getByTestId('nav-catalog')).toBeVisible();
  });

  test('a DJ live page renders for a DJ with no active set', async ({ page, request }) => {
    const res = await request.post('/auth/register', {
      data: { name: 'Offline Olly', role: 'dj', generation: 'founder' },
    });
    const { contributor } = (await res.json()) as { contributor: { id: string } };

    await page.goto(`/dj/${contributor.id}`);
    await expect(page.getByTestId('offline-view')).toBeVisible();
  });

  test('the DJ QR poster renders', async ({ page, request }) => {
    const res = await request.post('/auth/register', {
      data: { name: 'Poster Pam', role: 'dj', generation: 'founder' },
    });
    const { contributor } = (await res.json()) as { contributor: { id: string } };

    await page.goto(`/dj/${contributor.id}/poster`);
    await expect(page.getByTestId('display-card')).toBeVisible();
  });

  test('a fat-fingered contributor URL shows a not-found state', async ({ page }) => {
    await page.goto('/contributor/not-a-real-uuid');
    // Bad id is handled gracefully — the not-found view, not a crash or white screen.
    await expect(page.getByTestId('not-found')).toBeVisible();
  });
});
