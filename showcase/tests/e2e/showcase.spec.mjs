// Layer 5, end to end: the built pages in a real browser, every width and theme.
// The creator page is the dial; each station has its own page (owner, 2026-11-12).
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const STATIONS = ['teach', 'wear', 'lead'];
// The default site, then the layout and display menu's variants (tests/e2e/build-site.mjs).
const SITES = ['', '/list', '/grid'];
const PAGES = SITES.flatMap((site) => [
  [`${site || 'default'}: the creator page`, `${site}/index.html`, site],
  ...STATIONS.map((s) => [`${site || 'default'}: the ${s} page`, `${site}/${s}/index.html`, site]),
]);
PAGES.push(['/list: the TV board', '/list/tv/index.html', '/list']);
const isTv = (path) => path.endsWith('/tv/index.html');

async function open(page, path) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(path);
  await page.waitForLoadState('load');
  expect(errors, 'page script errors').toEqual([]);
}

for (const [name, path, site] of PAGES) {
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
      test.skip(isTv(path), 'a TV board has no tuner: nobody taps a wall');
      const links = page.locator('.channels a.ch');
      await expect(links).toHaveCount(STATIONS.length);
      const current = page.locator('.channels a[aria-current="page"]');
      if (path === `${site}/index.html`) await expect(current).toHaveCount(0);
      else await expect(current).toHaveAttribute('href', `..${path.slice(site.length)}`);
    });

    test('every tap target outside running text is at least 44 px tall', async ({ page }) => {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('.ch, .back, .code a, .places a, .ledger li a, .event p a, .tv-pause')]
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

// ── S10: the layout and display menu ─────────────────────────────────────────

test('the list layout is a column of stations with no dial, soonest station first', async ({ page }) => {
  await open(page, '/list/index.html');
  await expect(page.locator('svg.dial')).toHaveCount(0);
  await expect(page.locator('.channels.list a.ch')).toHaveCount(STATIONS.length);
  const boxes = await page.locator('.channels.list a.ch').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.top)]));
  expect(new Set(boxes.map((b) => b[0])).size, 'one column').toBe(1);
  expect(boxes.map((b) => b[1])).toEqual([...boxes.map((b) => b[1])].sort((a, b) => a - b));
  await expect(page.locator('.channels.list a.ch').first()).toContainText('Teach');
  await expect(page.locator('.channels.list a.ch').first()).toContainText('Evening workshops');
});

test('the grid layout is cards, and a card opens its station', async ({ page }) => {
  await open(page, '/grid/index.html');
  await expect(page.locator('svg.dial')).toHaveCount(0);
  await page.locator('.channels.grid a.ch', { hasText: 'Wear' }).click();
  await expect(page).toHaveURL(/\/grid\/wear\/index\.html$/);
  await expect(page.locator('.channels.grid a[aria-current="page"]')).toContainText('Wear');
});

test('a hidden section is gone, and the others stay', async ({ page }) => {
  await open(page, '/list/index.html');
  await expect(page.locator('#scatter-title')).toHaveCount(0);
  await expect(page.locator('#reports-title')).toHaveCount(1);
  await expect(page.locator('#now-title')).toHaveCount(1);
  await open(page, '/grid/index.html');
  await expect(page.locator('#scatter-title')).toHaveCount(1);
  await expect(page.locator('#now-title')).toHaveCount(0);
  await expect(page.locator('#reports-title')).toHaveText('Reports');
});

// ── S11: the TV board ────────────────────────────────────────────────────────

const visiblePanels = (page) => page.locator('.panel:visible');

test('the TV board shows one station at a time and moves on by itself', async ({ page }) => {
  await page.clock.install();
  await open(page, '/list/tv/index.html');
  await expect(page.locator('.panel')).toHaveCount(2);
  await expect(visiblePanels(page)).toHaveCount(1);
  const first = await visiblePanels(page).locator('h2').textContent();
  const dwell = Number(await visiblePanels(page).getAttribute('data-dwell'));
  expect(dwell).toBeGreaterThanOrEqual(14);
  await expect(page.locator('.tv-left')).toHaveText(`Next in ${dwell} s`);
  await page.clock.runFor((dwell - 1) * 1000);
  await expect(visiblePanels(page).locator('h2')).toHaveText(first);
  await page.clock.runFor(1000);
  await expect(visiblePanels(page)).toHaveCount(1);
  await expect(visiblePanels(page).locator('h2')).not.toHaveText(first);
});

test('a key holds the TV panel for 20 seconds, with the time left on screen', async ({ page }) => {
  await page.clock.install();
  await open(page, '/list/tv/index.html');
  const first = await visiblePanels(page).locator('h2').textContent();
  const dwell = Number(await visiblePanels(page).getAttribute('data-dwell'));
  await page.keyboard.press('Shift');
  await expect(page.locator('.tv-left')).toHaveText('Holding for 20 s');
  await page.clock.runFor(19_000);
  await expect(page.locator('.tv-left')).toHaveText('Holding for 1 s');
  // The hold is over only after its 20 s; the panel then still has its whole dwell.
  await page.clock.runFor((dwell - 1) * 1000);
  await expect(visiblePanels(page).locator('h2')).toHaveText(first);
});

test('Pause stops the TV board until Resume', async ({ page }) => {
  await page.clock.install();
  await open(page, '/list/tv/index.html');
  const first = await visiblePanels(page).locator('h2').textContent();
  const pause = page.getByRole('button', { name: 'Pause' });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tv-left')).toHaveText('Paused');
  await page.clock.runFor(300_000);
  await expect(visiblePanels(page).locator('h2')).toHaveText(first);
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.clock.runFor(120_000);
  await expect(visiblePanels(page)).toHaveCount(1);
});

test('with reduced motion the TV board does not rotate: every panel shows', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await open(page, '/list/tv/index.html');
  await page.clock.runFor(120_000);
  await expect(visiblePanels(page)).toHaveCount(2);
  await expect(page.locator('.tv-pause')).toBeHidden();
});

test('the TV board shows codes and no report or count', async ({ page }) => {
  await open(page, '/list/tv/index.html');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  expect(await page.locator('figure.code').count()).toBeGreaterThan(0);
  await expect(page.locator('figure.shot, img, table')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/scanners|Fewer than/);
});
