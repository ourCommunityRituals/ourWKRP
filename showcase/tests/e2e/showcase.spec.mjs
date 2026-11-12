// Layer 5, end to end: the built page in a real browser, every width and theme.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/index.html');
  await page.waitForLoadState('load');
  test.info().annotations.push({ type: 'page errors', description: String(errors.length) });
  expect(errors, 'page script errors').toEqual([]);
});

test('exactly one <h1>', async ({ page }) => {
  await expect(page.locator('h1')).toHaveCount(1);
});

test('only the tuned station panel shows on load', async ({ page }) => {
  await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(1);
  await expect(page.locator('#panel-teach')).toBeVisible();
});

test('nothing scrolls sideways', async ({ page }) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});

test('every report image loads', async ({ page, request }) => {
  const urls = await page.evaluate(() => [
    ...[...document.querySelectorAll('img')].map((i) => i.getAttribute('src')),
    ...[...document.querySelectorAll('source')].map((s) => s.getAttribute('srcset')),
    ...[...document.querySelectorAll('figure a')].map((a) => a.getAttribute('href')),
  ]);
  expect(urls.length).toBeGreaterThan(0);
  for (const u of new Set(urls)) {
    const res = await request.get(new URL(u, page.url()).href);
    expect(res.status(), u).toBe(200);
    expect(res.headers()['content-type'], u).toMatch(/^image\//);
  }
  const shown = page.locator('#panel-teach img');
  await shown.scrollIntoViewIfNeeded();
  await expect.poll(() => shown.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('the tuner tunes by click', async ({ page }) => {
  const tab = page.locator('#tab-wear');
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-wear')).toBeVisible();
  await expect(page.locator('#panel-teach')).toBeHidden();
  await expect(page.locator('#freq')).toHaveText('100.9');
  expect(new URL(page.url()).hash).toBe('#wear');
});

test('the tuner tunes by arrow keys, Home and End', async ({ page }) => {
  const tabs = page.getByRole('tab');
  const count = await tabs.count();
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  // Exactly one station panel shows, the selected one.
  await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(1);
  await expect(page.locator('#panel-wear')).toBeVisible();
  await page.keyboard.press('End');
  await expect(tabs.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(count - 1)).toBeFocused();
});

test('a station link opens on its station', async ({ page }) => {
  await page.goto('/index.html#lead');
  await expect(page.locator('#tab-lead')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-lead')).toBeVisible();
});

test('axe finds no WCAG A/AA violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`);
  expect(summary).toEqual([]);
});
