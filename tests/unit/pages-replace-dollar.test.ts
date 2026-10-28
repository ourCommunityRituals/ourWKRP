/**
 * Stored text spliced into a served page must land literally.
 *
 * String.prototype.replace treats `$&`, `$\``, `$'`, `$$` and `$n` in a STRING
 * replacement as patterns. Contributor display names and brand names are
 * stored, user-chosen text, and escapeHtmlAttr / cssStringSafe do not touch
 * `$`. If the page handler splices that text in with a string replacement, a
 * name such as `DJ $\`` copies the whole document prefix into the head.
 *
 * These tests drive the real handlePages with a stub D1 that returns the
 * payload row, and assert the served head is intact and the text is literal.
 */
import { describe, it, expect } from 'vitest';
import { handlePages } from '../../src/handlers/pages';
import { escapeHtmlAttr, cssStringSafe } from '../../src/lib/html';
import type { Env } from '../../src/types';

const ORIGIN = 'https://ourwkrp.com';

/** Every replacement pattern String.prototype.replace understands. */
const DOLLAR_PATTERNS = ['$&', '$`', "$'", '$$', '$1'];

interface ProfileRow { id: string; name: string; role: string; generation: string; slug: string | null }
interface BrandRow { name: string; primary_color: string; accent_color: string; logo_url: string | null }

const DEFAULT_PROFILE: ProfileRow = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Matt',
  role: 'curator',
  generation: 'gen2',
  slug: 'matt',
};
const DEFAULT_BRAND_ROW: BrandRow = {
  name: 'WKRP',
  primary_color: '#D4954B',
  accent_color: '#191414',
  logo_url: null,
};

/** A D1 stand-in: one row per table, whatever the bind values. */
function stubEnv(profile: ProfileRow | null, brand: BrandRow): Env {
  return {
    APP_URL: ORIGIN,
    WKRP_DB: {
      prepare(sql: string) {
        const stmt = {
          bind() { return stmt; },
          async first() {
            if (sql.includes('FROM brands')) return brand;
            if (sql.includes('FROM contributors')) return profile;
            return null;
          },
        };
        return stmt;
      },
    },
  } as unknown as Env;
}

async function serve(path: string, env: Env): Promise<{ html: string; nonce: string }> {
  const res = await handlePages(new Request(`${ORIGIN}${path}`), env);
  expect(res.status).toBe(200);
  const csp = res.headers.get('Content-Security-Policy') ?? '';
  const m = csp.match(/'nonce-([a-f0-9]+)'/);
  expect(m).not.toBeNull();
  return { html: await res.text(), nonce: m![1] };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The head is one element, closed once, and the nonce sits only on scripts. */
function expectIntactDocument(html: string, nonce: string): void {
  expect(count(html, '<head>')).toBe(1);
  expect(count(html, '</head>')).toBe(1);
  // '</body>' rather than '<body': profile.html mentions <body ...> in a comment.
  expect(count(html, '</body>')).toBe(1);
  expect(count(html, '</html>')).toBe(1);
  expect(count(html, '<!DOCTYPE')).toBeLessThanOrEqual(1);
  expect(html).not.toContain('__CSP_NONCE__');
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)];
  expect(scripts.length).toBeGreaterThan(0);
  for (const [tag] of scripts) expect(tag).toContain(`nonce="${nonce}"`);
  // Not duplicated, not leaked: every occurrence of the nonce is a script's.
  expect(count(html, nonce)).toBe(scripts.length);
}

/** og/twitter metas: exactly `expected` well-formed tags, each closed correctly. */
function metaContents(html: string): Map<string, string> {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const metas = [...head.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)">/g)];
  const out = new Map<string, string>();
  for (const [, key, content] of metas) {
    expect(content).not.toMatch(/["<>]/);
    expect(out.has(key)).toBe(false);
    out.set(key, content);
  }
  return out;
}

describe('contributor display name with a $ replacement pattern', () => {
  for (const p of DOLLAR_PATTERNS) {
    it(`keeps the profile head intact and the name literal: ${JSON.stringify(p)}`, async () => {
      const name = `DJ ${p} Name`;
      const env = stubEnv({ ...DEFAULT_PROFILE, name }, DEFAULT_BRAND_ROW);
      const { html, nonce } = await serve('/c/matt', env);

      expectIntactDocument(html, nonce);
      const metas = metaContents(html);
      expect(metas.size).toBe(8);
      const title = escapeHtmlAttr(`${name} — WKRP`);
      expect(metas.get('og:title')).toBe(title);
      expect(metas.get('twitter:title')).toBe(title);
      expect(metas.get('og:description')).toBe(
        escapeHtmlAttr(`${name} is a curator (gen2) in the WKRP music catalog.`),
      );
      expect(count(html, `content="${title}"`)).toBe(2);
    });
  }

  it('keeps the UUID route literal too', async () => {
    const name = 'DJ $` $& $\' $$ Name';
    const env = stubEnv({ ...DEFAULT_PROFILE, name }, DEFAULT_BRAND_ROW);
    const { html, nonce } = await serve(`/contributor/${DEFAULT_PROFILE.id}`, env);
    expectIntactDocument(html, nonce);
    expect(metaContents(html).get('og:title')).toBe(escapeHtmlAttr(`${name} — WKRP`));
  });
});

describe('contributor id with a $ replacement pattern (body data attribute)', () => {
  for (const p of DOLLAR_PATTERNS) {
    it(`writes the id literally into <body data-contributor-id>: ${JSON.stringify(p)}`, async () => {
      const id = `id-${p}-x`;
      const env = stubEnv({ ...DEFAULT_PROFILE, id }, DEFAULT_BRAND_ROW);
      const { html, nonce } = await serve('/c/matt', env);
      expectIntactDocument(html, nonce);
      expect(count(html, '<body data-contributor-id="')).toBe(1);
      expect(count(html, `<body data-contributor-id="${escapeHtmlAttr(id)}">`)).toBe(1);
    });
  }
});

describe('brand name with a $ replacement pattern', () => {
  for (const p of DOLLAR_PATTERNS) {
    const brandName = `Radio ${p} One`;
    const brand = { ...DEFAULT_BRAND_ROW, name: brandName };
    const styleBlock = `--brand-name:"${cssStringSafe(brandName)}";}</style>`;

    it(`profile page: style block and og:site_name are literal: ${JSON.stringify(p)}`, async () => {
      const { html, nonce } = await serve('/c/matt', stubEnv(DEFAULT_PROFILE, brand));
      expectIntactDocument(html, nonce);
      expect(count(html, styleBlock)).toBe(1);
      expect(count(html, '<style>:root{--brand-primary')).toBe(1);
      const metas = metaContents(html);
      expect(metas.size).toBe(8);
      expect(metas.get('og:site_name')).toBe(escapeHtmlAttr(brandName));
      expect(metas.get('og:title')).toBe(escapeHtmlAttr(`Matt — ${brandName}`));
    });

    it(`catalog page: style block and catalog meta are literal: ${JSON.stringify(p)}`, async () => {
      const { html, nonce } = await serve('/catalog', stubEnv(null, brand));
      expectIntactDocument(html, nonce);
      expect(count(html, styleBlock)).toBe(1);
      const metas = metaContents(html);
      expect(metas.size).toBe(8);
      expect(metas.get('og:site_name')).toBe(escapeHtmlAttr(brandName));
      expect(metas.get('og:title')).toBe(escapeHtmlAttr(`${brandName} — Catalog`));
      expect(metas.get('og:description')).toBe(
        escapeHtmlAttr(`Browse the ${brandName} community music catalog — tracks, contributors, and playlists.`),
      );
    });

    it(`a page with no OG block still gets a literal style block: ${JSON.stringify(p)}`, async () => {
      const { html, nonce } = await serve('/create', stubEnv(null, brand));
      expectIntactDocument(html, nonce);
      expect(count(html, styleBlock)).toBe(1);
    });
  }
});

describe('ordinary text is unchanged by the fix', () => {
  it('serves the usual profile head for a plain name and brand', async () => {
    const { html, nonce } = await serve('/c/matt', stubEnv(DEFAULT_PROFILE, DEFAULT_BRAND_ROW));
    expectIntactDocument(html, nonce);
    expect(html).toContain('--brand-name:"WKRP";}</style>');
    expect(html).toContain('content="Matt — WKRP"');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/c/matt">`);
    expect(html).toContain(`<body data-contributor-id="${DEFAULT_PROFILE.id}">`);
  });
});
