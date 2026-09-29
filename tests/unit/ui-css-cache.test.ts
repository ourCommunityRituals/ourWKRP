/**
 * /ui.css revalidation (OSE-1398). The stylesheet href is fixed, so @ocr/ui's
 * 24h max-age would pair new HTML with stale CSS for a day after every
 * .ocr-hub-ref bump. The router answers with a strong ETag and
 * must-revalidate, and 304 when the browser already holds the bytes.
 */
import { describe, test, expect } from 'vitest';
import { route } from '../../src/router';
import type { Env } from '../../src/types';

const env = { APP_URL: 'https://t.test' } as unknown as Env;
const get = (headers: Record<string, string> = {}) =>
  route(new Request('https://t.test/ui.css', { headers }), env);

describe('/ui.css cache', () => {
  test('revalidates by strong ETag instead of a 24h max-age', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('ETag')).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect((await res.text()).length).toBeGreaterThan(1000);
  });

  test('answers 304 for a matching If-None-Match, 200 for a stale one', async () => {
    const etag = (await get()).headers.get('ETag')!;
    const same = await get({ 'If-None-Match': etag });
    expect(same.status).toBe(304);
    expect(same.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await get({ 'If-None-Match': '"old"' })).status).toBe(200);
  });
});
