// Layer 5, end to end: the built pages in a real browser, every width and theme.
// The creator page is the dial; each station has its own page (owner, 2026-11-12).
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const STATIONS = ['teach', 'wear', 'lead'];
const PAGES = [['the creator page', '/index.html'], ...STATIONS.map((s) => [`the ${s} page`, `/${s}/index.html`])];

async function open(page, path) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(path);
  await page.waitForLoadState('load');
  expect(errors, 'page script errors').toEqual([]);
}

for (const [name, path] of PAGES) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => open(page, path));

    test('exactly one <h1>', async ({ page }) => {
      await expect(page.locator('h1')).toHaveCount(1);
    });

    test('nothing scrolls sideways', async ({ page }) => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over).toBeLessThanOrEqual(0);
    });

    test('every image loads', async ({ page, request }) => {
      const urls = await page.evaluate(() => [
        ...[...document.querySelectorAll('img')].map((i) => i.getAttribute('src')),
        ...[...document.querySelectorAll('source')].map((s) => s.getAttribute('srcset')),
        ...[...document.querySelectorAll('figure.shot a')].map((a) => a.getAttribute('href')),
      ]);
      for (const u of new Set(urls)) {
        const res = await request.get(new URL(u, page.url()).href);
        expect(res.status(), u).toBe(200);
        expect(res.headers()['content-type'], u).toMatch(/^image\//);
      }
    });

    test('the tuner links every station, and marks this one', async ({ page }) => {
      const links = page.locator('.channels a.ch');
      await expect(links).toHaveCount(STATIONS.length);
      const current = page.locator('.channels a[aria-current="page"]');
      if (path === '/index.html') await expect(current).toHaveCount(0);
      else await expect(current).toHaveAttribute('href', `..${path}`);
    });

    test('every tap target outside running text is at least 44 px tall', async ({ page }) => {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('.ch, .back, .code a, .places a, .ledger li a, .event p a')]
          .map((el) => ({ text: el.textContent.trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height) }))
          .filter((x) => x.h > 0 && x.h < 44),
      );
      expect(small).toEqual([]);
    });

    test('axe finds no WCAG A/AA violations', async ({ page }) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`);
      expect(summary).toEqual([]);
    });
  });
}

test('a channel opens its station page, and the back link returns', async ({ page }) => {
  await open(page, '/index.html');
  await page.locator('.channels a.ch', { hasText: 'Wear' }).click();
  await expect(page).toHaveURL(/\/wear\/index\.html$/);
  await expect(page.locator('h1')).toHaveText('Market stall');
  await page.locator('a.back').click();
  await expect(page).toHaveURL(/\/index\.html$/);
});

test('an old station link (#wear) opens the station page', async ({ page }) => {
  await open(page, '/index.html#wear');
  await expect(page).toHaveURL(/\/wear\/index\.html$/);
});

test('a station shows its programme On air, with a next date or "to be announced"', async ({ page }) => {
  await open(page, '/teach/index.html');
  const onAir = page.getByRole('list', { name: 'On air' }).getByRole('listitem');
  await expect(onAir).toHaveCount(2);
  await expect(onAir.first()).toContainText('Every Thursday, 6 pm');
  await expect(onAir.first()).toContainText('Next:');
  await expect(onAir.nth(1)).toContainText('Next date to be announced');
});

test('each code shows a QR and a link carrying the same OSE /q or /s URL', async ({ page }) => {
  await open(page, '/teach/index.html');
  const figures = page.locator('figure.code');
  expect(await figures.count()).toBeGreaterThan(0);
  for (const f of await figures.all()) {
    const url = await f.getAttribute('data-code-url');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8917\/(q|s)\/[A-Za-z0-9_-]+$/);
    await expect(f.locator('svg.qr')).toBeVisible();
    await expect(f.getByRole('link')).toHaveAttribute('href', url);
    await expect(f.getByRole('link')).toHaveText(url);
  }
});

test('Lead shows every frequency and sends codes to their station pages', async ({ page }) => {
  await open(page, '/lead/index.html');
  await expect(page.locator('article.event')).toHaveCount(5);
  await expect(page.locator('figure.code')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Codes on the Wear page' }).first()).toHaveAttribute('href', '../wear/index.html');
});
