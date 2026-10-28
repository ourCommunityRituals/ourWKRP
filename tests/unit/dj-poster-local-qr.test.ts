/**
 * Unit tests — the DJ poster's QR code is generated locally (privacy).
 *
 * GET /dj/:id/poster used to build the QR by pointing an <img> at a third-party
 * generator (api.qrserver.com) with the live-set URL in the query string, so
 * every poster view told an outside service which DJ and which event were on
 * the wall. The QR is now rendered by the Worker as inline SVG.
 *
 * These tests read the actual served bytes, rebuild the SVG's dark modules into
 * a pixel bitmap (no browser needed: the SVG is our own fixed shape — one path
 * of unit squares) and decode it with jsQR, so "it encodes the right URL" is
 * proven by an independent decoder rather than by comparing against ourselves.
 */
import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import type { Env } from '../../src/types';
import { handlePages } from '../../src/handlers/pages';

const ORIGIN = 'http://localhost:8787';
const DJ_ID = '11111111-2222-3333-4444-555555555555';

/** Env whose DB throws so brand-style injection falls back to defaults. */
const stubEnv = {
  WKRP_DB: { prepare() { throw new Error('no db in this test'); } },
} as unknown as Env;

async function servePoster(query = ''): Promise<string> {
  const res = await handlePages(new Request(`${ORIGIN}/dj/${DJ_ID}/poster${query}`), stubEnv);
  expect(res.status).toBe(200);
  return res.text();
}

/** The inline QR <svg> inside the poster's qr-frame, or null. */
function qrSvg(body: string): string | null {
  const frame = body.match(/<div class="qr-frame"[^>]*>([\s\S]*?)<\/div>\s*<div class="poster-cta">/);
  if (!frame) return null;
  const svg = (frame[1] ?? '').match(/<svg\b[\s\S]*?<\/svg>/);
  return svg ? svg[0] : null;
}

/** Rasterise the QR SVG (viewBox + one path of 1x1 squares) and decode it. */
function decodeSvg(svg: string): string | null {
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!vb) return null;
  const n = Number(vb[1]);
  const scale = 4;
  const px = n * scale;
  const rgba = new Uint8ClampedArray(px * px * 4).fill(255);
  const path = svg.match(/<path[^>]*\bd="([^"]*)"/);
  if (!path) return null;
  for (const m of (path[1] ?? '').matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
    const mx = Number(m[1]);
    const my = Number(m[2]);
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = ((my * scale + dy) * px + (mx * scale + dx)) * 4;
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0;
      }
    }
  }
  const result = jsQR(rgba, px, px);
  return result ? result.data : null;
}

describe('DJ poster QR is generated locally (no third-party request)', () => {
  it('serves no qrserver reference and no external image host', async () => {
    const body = await servePoster('?event=evt-123');
    expect(body).not.toContain('qrserver');
    expect(body).not.toMatch(/<img\b[^>]*\bsrc=["']?https?:/i);
    expect(body).not.toMatch(/\.src\s*=\s*['"]https?:/);
  });

  it('renders the QR inline and it decodes to the live-set URL with the event', async () => {
    const body = await servePoster('?event=evt-123');
    const svg = qrSvg(body);
    expect(svg).not.toBeNull();
    expect(decodeSvg(svg as string)).toBe(`${ORIGIN}/dj/${DJ_ID}?event=evt-123`);
  });

  it('encodes only the DJ URL when there is no event', async () => {
    const body = await servePoster();
    const svg = qrSvg(body);
    expect(svg).not.toBeNull();
    expect(decodeSvg(svg as string)).toBe(`${ORIGIN}/dj/${DJ_ID}`);
  });

  it.each([
    ['quotes', 'a"b\'c'],
    ['angle brackets', '<script>alert(1)</script>'],
    ['spaces', 'evt 123'],
    ['over 128 chars', 'e'.repeat(129)],
  ])('drops a malicious event id (%s) and encodes the DJ URL alone', async (_label, evil) => {
    const body = await servePoster(`?event=${encodeURIComponent(evil)}`);
    expect(body).not.toContain(evil);
    expect(body).not.toContain(encodeURIComponent(evil));
    const svg = qrSvg(body);
    expect(svg).not.toBeNull();
    expect(decodeSvg(svg as string)).toBe(`${ORIGIN}/dj/${DJ_ID}`);
  });

  it('accepts an event id of exactly 128 safe chars', async () => {
    const ev = 'A_b-9'.repeat(25) + 'xyz';
    expect(ev.length).toBe(128);
    const svg = qrSvg(await servePoster(`?event=${ev}`));
    expect(decodeSvg(svg as string)).toBe(`${ORIGIN}/dj/${DJ_ID}?event=${ev}`);
  });

  it('keeps a white quiet zone of at least 4 modules on every side', async () => {
    const svg = qrSvg(await servePoster('?event=evt-123')) as string;
    expect(svg).not.toBeNull();
    const n = Number((svg.match(/viewBox="0 0 (\d+) /) ?? [])[1]);
    expect(svg).toMatch(/<rect[^>]*width="100%"[^>]*fill="white"/);
    const d = (svg.match(/<path[^>]*\bd="([^"]*)"/) ?? [])[1] ?? '';
    const coords = [...d.matchAll(/M(\d+),(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(coords.length).toBeGreaterThan(0);
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(x).toBeLessThan(n - 4);
      expect(y).toBeLessThan(n - 4);
    }
  });

  it('keeps the frame, call to action and sponsor slot on the page', async () => {
    const body = await servePoster('?sponsor=Lagunitas');
    expect(body).toContain('data-testid="qr-frame"');
    expect(body).toContain('Hear something that hits?');
    expect(body).toContain('data-testid="sponsor-slot"');
  });
});

describe('local QR encoder', () => {
  it('round-trips through an independent decoder across every version 1-40', async () => {
    const { qrSvg: render, qrMatrix } = await import('../../src/lib/qr');
    const seen = new Set<number>();
    // Byte-mode capacity at level M runs from 14 (v1) to 2331 (v40) bytes.
    // Steps of 11 bytes are finer than every version-to-version capacity jump,
    // so every version 1-40 (and every row of the block table) is exercised.
    for (let len = 1; len <= 2331; len += 11) {
      const text = ('https://x.example/' + 'abcdefghij0123456789-_'.repeat(200)).slice(0, len);
      const matrix = qrMatrix(text);
      seen.add((matrix.length - 17) / 4);
      expect(decodeSvg(render(text))).toBe(text);
    }
    const max = 'Z'.repeat(2331);
    expect(qrMatrix(max).length).toBe(177);
    expect(decodeSvg(render(max))).toBe(max);
    expect(seen.size).toBe(40);
  }, 120_000);

  it('refuses text too long for any version', async () => {
    const { qrMatrix } = await import('../../src/lib/qr');
    expect(() => qrMatrix('Z'.repeat(2332))).toThrow();
  });
});
