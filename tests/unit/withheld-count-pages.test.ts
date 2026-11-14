/**
 * Unit tests: a withheld count reads "Fewer than 5" on the pages, never 0,
 * NaN, "null" or blank (owner rule 2026-11-14).
 *
 * The pages are served through the real handlePages, so the words come from
 * lib/count-floor.ts (withheldText), and the stats page's own script is run
 * against a small stand-in DOM with /api/stats answering each way.
 *
 * Born red on main at cab0c28: stats.html set its "DJ Attributions" tile to a
 * hardcoded '0', and called total_contributors.toLocaleString(), which throws
 * on a withheld (null) count and leaves the tile at its placeholder.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handlePages } from '../../src/handlers/pages';
import { withheldText } from '../../src/lib/count-floor';
import type { Env } from '../../src/types';

const env = {
  WKRP_DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
} as unknown as Env;

async function page(path: string): Promise<string> {
  const res = await handlePages(new Request(`https://ourwkrp.com${path}`), env);
  expect(res.status).toBe(200);
  return res.text();
}

describe('served pages carry the withheld words from the floor library', () => {
  for (const path of ['/stats', '/catalog', '/dashboard']) {
    it(`${path} has no unfilled placeholder and says "${withheldText()}"`, async () => {
      const html = await page(path);
      expect(html).not.toContain('__COUNT_WITHHELD_TEXT__');
      expect(html).toContain(withheldText());
    });
  }

  it('no template writes its own copy of the words', () => {
    for (const name of ['stats.html', 'catalog.html', 'dashboard.html']) {
      const raw = readFileSync(join(__dirname, '../../src/templates', name), 'utf-8');
      expect(raw, name).not.toContain('Fewer than');
    }
  });
});

interface StubElement {
  id: string;
  textContent: string;
  innerHTML: string;
}

/** Run a page's inline script against a stand-in DOM; return the elements it wrote. */
async function runPageScript(html: string, responses: Record<string, unknown>): Promise<Map<string, StubElement>> {
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const els = new Map<string, StubElement>();
  for (const m of html.matchAll(/\sid="([^"]+)"[^>]*>([^<]*)</g)) {
    els.set(m[1], { id: m[1], textContent: m[2], innerHTML: m[2] });
  }
  const document = {
    getElementById: (id: string) => (ids.has(id) ? els.get(id) ?? null : null),
    createElement: () => {
      let text = '';
      return {
        set textContent(v: string) {
          text = String(v);
        },
        get innerHTML() {
          return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
      };
    },
  };
  const fetch = async (url: string) => ({ json: async () => responses[url] ?? { ok: false } });
  new Function('document', 'fetch', script as string)(document, fetch);
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  return els;
}

const statsBody = (contributors: number | null) => ({
  ok: true,
  stats: {
    total_tracks: 120,
    total_contributors: contributors,
    total_contributors_suppressed: contributors === null,
    reporting_floor: 5,
    total_playlists: 9,
    top_genres: [],
    top_decades: [],
    has_audio_features: false,
  },
});

describe('the stats page renders what /api/stats publishes', () => {
  it('a withheld contributor count reads in words', async () => {
    const els = await runPageScript(await page('/stats'), {
      '/api/stats': statsBody(null),
      '/api/contributors': { ok: true, contributors: [] },
    });
    expect(els.get('total-contributors')?.textContent).toBe(withheldText());
    expect(els.get('total-tracks')?.textContent).toBe('120');
  });

  it('a published contributor count reads as the number', async () => {
    const els = await runPageScript(await page('/stats'), {
      '/api/stats': statsBody(7),
      '/api/contributors': { ok: true, contributors: [] },
    });
    expect(els.get('total-contributors')?.textContent).toBe('7');
  });

  it('no stat tile reads 0, NaN, null or blank where no count exists', async () => {
    const html = await page('/stats');
    expect(html).not.toContain('total-attributions');
    expect(html).not.toContain('DJ Attributions');
    const els = await runPageScript(html, {
      '/api/stats': statsBody(null),
      '/api/contributors': { ok: true, contributors: [] },
    });
    for (const id of ['total-tracks', 'total-contributors', 'total-playlists']) {
      expect(els.get(id)?.textContent, id).not.toMatch(/^$|^0$|NaN|null|undefined/);
    }
  });
});
