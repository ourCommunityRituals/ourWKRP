/**
 * E2E — rendered output is deterministic (thin slice).
 *
 * WHY THIS EXISTS AT ALL, GIVEN LEVELS 3/4 ALREADY COVER DETERMINISM
 * The unit level proves the scanners work. The integration level proves SQLite
 * returns stable rows. Neither touches the FRONTEND — and "FE, BE, and DB are
 * deterministic" is a three-layer claim. Everything between the D1 result set
 * and the pixels (JSON serialisation, the client render loop, any sort or
 * dedupe in template JS) is unproven below this level.
 *
 * DELIBERATELY THIN — per the pyramid: as much as possible low down, then
 * integration, then SOME e2e. This is the "some". Two page loads, compare the
 * rendered order. No filter permutations, no cross-browser matrix, no
 * per-endpoint sweep — that is gravy, and gravy at this level is slow and
 * flaky. If this spec ever grows a third case, push it down to level 4 first
 * and ask whether the browser is really adding anything.
 *
 * Scope: the anonymous catalog surface, which is also the one every visitor
 * hits without a session.
 */
import { test, expect, rateLimitHeaders, registerAs } from './fixtures';

/**
 * Seeds its own tracks, deliberately.
 *
 * The first draft of this spec relied on whatever happened to be in the local
 * catalog and skipped when it was empty. It passed locally only because an
 * earlier full-suite run had left 4 rows behind — in clean CI it would have
 * skipped and reported green while asserting nothing. Seeding here makes the
 * spec independent of suite order and of ambient database state.
 *
 * The names are chosen so that alphabetical, insertion, and reverse order are
 * all different — a render that silently re-sorts cannot coincidentally match.
 */
const SEED_CSV = [
  'Track URI,Track Name,Artist Name(s),Album Name,ISRC,Album Release Date,Energy,Danceability,Valence,Artist Genres,Track Duration (ms)',
  'spotify:track:det000000000000000001,Zulu Determinism,Order Test Trio,Stable Sort,USDT00000001,2020-01-01,0.51,0.50,0.50,test-order,200000',
  'spotify:track:det000000000000000002,Alpha Determinism,Order Test Trio,Stable Sort,USDT00000002,2020-01-02,0.52,0.50,0.50,test-order,200000',
  'spotify:track:det000000000000000003,Mike Determinism,Order Test Trio,Stable Sort,USDT00000003,2020-01-03,0.53,0.50,0.50,test-order,200000',
  'spotify:track:det000000000000000004,Bravo Determinism,Order Test Trio,Stable Sort,USDT00000004,2020-01-04,0.54,0.50,0.50,test-order,200000',
].join('\n');

// beforeEach, not beforeAll: the per-test rate-limit identity is a test-scoped
// option, so a worker-scoped hook cannot see it. The import is idempotent —
// re-running matches the existing tracks rather than duplicating them.
test.beforeEach(async ({ request }) => {
  const { id, cookie } = await registerAs(request, { name: 'Determinism Seeder', role: 'curator', generation: 'founder' });

  const imported = await request.post(`/import/${id}`, {
    headers: { cookie },
    data: { csv: SEED_CSV, source_type: 'manual', source_name: 'determinism-fixture' },
  });
  expect(imported.ok()).toBe(true);
});

/**
 * Rendered track order as the user actually sees it.
 *
 * Reads the visible track names rather than an id attribute: the cards carry
 * `data-testid="track-card"` and no id, and adding one purely so a test could
 * read it would be changing product markup for test convenience. The visible
 * sequence is also the stronger assertion — it is the thing the claim is about.
 */
async function renderedTrackOrder(page: import('@playwright/test').Page): Promise<string[]> {
  await page.goto('/catalog');
  await expect(page.getByTestId('catalog-view')).toBeVisible();
  await expect(page.getByTestId('track-list')).toBeVisible();
  return page
    .getByTestId('track-list')
    .locator('[data-testid="track-card"] .track-name')
    .allTextContents();
}

test.describe('Determinism — rendered output', () => {
  test('the catalog renders the same track order on repeat visits', async ({ page }) => {
    const first = await renderedTrackOrder(page);
    const second = await renderedTrackOrder(page);

    // Non-vacuity: the hook seeded 4 tracks, so an empty list is a failure,
    // never a skip. A test that can silently assert nothing is not coverage.
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  test('a second independent browser context sees the same order', async ({ browser }, testInfo) => {
    // Same data, different session/cache. Catches per-session ordering — a
    // shuffle keyed on session id would survive the repeat-visit case above.
    // Hand-built contexts do not inherit the fixture's header override, so the
    // rate-limit identity is passed explicitly — otherwise these two fall back
    // to the shared default bucket the whole suite used to collide in.
    const extraHTTPHeaders = rateLimitHeaders(testInfo);
    const ctxA = await browser.newContext({ extraHTTPHeaders });
    const ctxB = await browser.newContext({ extraHTTPHeaders });
    try {
      const a = await renderedTrackOrder(await ctxA.newPage());
      const b = await renderedTrackOrder(await ctxB.newPage());
      expect(a.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
