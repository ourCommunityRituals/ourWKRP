/**
 * Page handler — serves HTML templates
 *
 * GET /              → connect.html (or redirect to catalog if session cookie)
 * GET /catalog       → catalog.html
 * GET /create        → create.html
 * GET /contributor/:id → profile.html (canonical UUID URL)
 * GET /c/:slug       → profile.html (vanity URL, OW-122)
 *
 * WHY THE PROFILE PAGE IS RENDERED SERVER-SIDE (OW-122)
 * profile.html is a static shell that fetches its data from /api/contributors
 * after load. OpenGraph crawlers do not execute JavaScript, so anything a
 * crawler must see — og:*, twitter:*, rel=canonical — has to be in the bytes the
 * worker returns. injectBrandStyles has always done exactly this for brand CSS;
 * the OG block rides the same </head> injection seam.
 */

import type { Env } from '../types';
import { extractBrandId } from '../lib/brand';
import { buildPageCsp } from '../lib/security-headers';
import { escapeHtmlAttr, cssStringSafe, safeCssColor } from '../lib/html';
import { SLUG_RE } from '../lib/slug';
import { UUID_RE } from '../lib/route-path';
import { log } from '../lib/logger';
import { qrSvg } from '../lib/qr';

// HTML templates imported as text via wrangler.toml [[rules]]
import connectHtml from '../templates/connect.html';
import catalogHtml from '../templates/catalog.html';
import createHtml from '../templates/create.html';
import profileHtml from '../templates/profile.html';
import importHtml from '../templates/import.html';
import liveHtml from '../templates/live.html';
import qrPosterHtml from '../templates/qr-poster.html';
import dashboardHtml from '../templates/dashboard.html';
import statsHtml from '../templates/stats.html';

const HTML_HEADERS = {
  'Content-Type': 'text/html;charset=UTF-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};

interface BrandRow {
  name: string;
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
}

const DEFAULT_BRAND: BrandRow = {
  name: 'WKRP',
  primary_color: '#D4954B',
  accent_color: '#191414',
  logo_url: null,
};

/** The one row the OG block needs. Kept to a single lightweight query. */
interface ProfileMetaRow {
  id: string;
  name: string;
  role: string;
  generation: string;
  slug: string | null;
}

export async function handlePages(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const brandId = extractBrandId(request);

  log('PAGE_SERVE', { path, brand_id: brandId });

  let html: string;
  // Set only for the two profile surfaces, and only when the contributor
  // actually resolves — an unknown contributor serves the plain shell.
  let profile: ProfileMetaRow | null = null;
  let isPoster = false;

  if (path === '/') {
    html = connectHtml;
  } else if (path === '/catalog') {
    html = catalogHtml;
  } else if (path === '/create') {
    html = createHtml;
  } else if (path === '/dashboard') {
    html = dashboardHtml;
  } else if (path === '/stats') {
    html = statsHtml;
  } else if (path === '/import') {
    html = importHtml;
  } else if (path.startsWith('/dj/') && path.endsWith('/poster')) {
    html = qrPosterHtml;
    isPoster = true;
  } else if (path.startsWith('/dj/')) {
    html = liveHtml;
  } else if (path.startsWith('/contributor/')) {
    html = profileHtml;
    // Shape-gate before touching D1: the id is attacker-controlled and a
    // non-UUID can never match a row, so skip the query entirely.
    const id = path.slice('/contributor/'.length);
    if (UUID_RE.test(id)) {
      profile = await lookupProfileById(env, id);
    }
  } else if (path.startsWith('/c/')) {
    const slug = path.slice('/c/'.length);
    if (SLUG_RE.test(slug)) {
      profile = await lookupProfileBySlug(env, brandId, slug);
    }
    // A vanity URL that resolves to nothing is a dead link, not an empty
    // profile — 404 rather than serving a shell that would render "not found"
    // under a 200. Body shape follows this handler's existing 404 convention.
    if (!profile) {
      return Response.json(
        { ok: false, status: 404, error: 'Page not found' },
        { status: 404 },
      );
    }
    html = profileHtml;
  } else {
    return Response.json(
      { ok: false, status: 404, error: 'Page not found' },
      { status: 404 },
    );
  }

  const brand = await loadBrand(brandId, env);

  // ORDER MATTERS: the nonce sentinel is substituted first, before any
  // database-sourced text is spliced in. Injecting first would let a
  // contributor whose name contained the literal string "__CSP_NONCE__" have
  // this request's nonce written into a meta attribute — handing an attacker
  // the one value the CSP relies on staying secret. Templates are the only
  // thing that legitimately carries the sentinel, so substituting against the
  // template alone is both sufficient and safe.
  const nonce = crypto.randomUUID().replace(/-/g, '');
  html = html.replaceAll('__CSP_NONCE__', nonce);

  html = injectBrandStyles(html, brand);

  if (profile) {
    html = injectProfileMeta(html, profile, brand, env, url);
    // Hand the resolved id to the client script so /c/:slug works without the
    // template having to reverse a slug into an id.
    html = html.replace(
      '<body>',
      () => `<body data-contributor-id="${escapeHtmlAttr(profile.id)}">`,
    );
  } else if (path === '/catalog') {
    html = injectCatalogMeta(html, brand, env, url);
  } else if (isPoster) {
    html = injectPosterQr(html, url);
  }

  return new Response(html, {
    headers: { ...HTML_HEADERS, 'Content-Security-Policy': buildPageCsp(nonce) },
  });
}

/** Where qr-poster.html takes the server-rendered QR. */
const QR_SLOT = '<!--QR_CODE-->';

/**
 * Letters, digits, underscore, hyphen; 1-128 chars. Applied to both the DJ id
 * (path) and the event id (query) before either goes into the QR, so nothing
 * that could alter the URL's meaning — or the page — is ever encoded.
 */
const QR_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Render the poster's QR in the Worker (privacy: the live-set URL used to be
 * sent to a third-party QR image service on every view).
 *
 * Encodes exactly what the page used to: origin + '/dj/' + djId, plus
 * '?event=' + eventId when the query carries a valid one. An invalid event id
 * is ignored (the DJ URL alone is encoded); an invalid DJ id gets no QR. The
 * SVG carries only numbers and fixed strings, never the ids themselves.
 */
function injectPosterQr(html: string, url: URL): string {
  const djId = url.pathname.slice('/dj/'.length, -'/poster'.length);
  if (!QR_ID_RE.test(djId)) {
    return html.replace(QR_SLOT, () => '<div class="qr-placeholder">QR unavailable</div>');
  }
  let liveUrl = `${url.origin}/dj/${djId}`;
  const eventId = url.searchParams.get('event');
  if (eventId !== null && QR_ID_RE.test(eventId)) liveUrl += `?event=${eventId}`;
  // A function replacer, so a "$" in the output could never be read as a
  // replacement pattern ($&, $1, $$).
  return html.replace(QR_SLOT, () => qrSvg(liveUrl));
}

/** One query: the contributor row behind /contributor/:uuid. */
async function lookupProfileById(env: Env, id: string): Promise<ProfileMetaRow | null> {
  try {
    return await env.WKRP_DB.prepare(
      'SELECT id, name, role, generation, slug FROM contributors WHERE id = ?',
    ).bind(id).first<ProfileMetaRow>();
  } catch {
    // D1 unprovisioned or pre-0010 schema — serve the shell without OG meta.
    return null;
  }
}

/**
 * One query: the contributor row behind /c/:slug.
 * Scoped by brand_id because slugs are unique per brand, not globally — the
 * same slug may belong to different people on two brands.
 */
async function lookupProfileBySlug(env: Env, brandId: string, slug: string): Promise<ProfileMetaRow | null> {
  try {
    return await env.WKRP_DB.prepare(
      'SELECT id, name, role, generation, slug FROM contributors WHERE brand_id = ? AND slug = ?',
    ).bind(brandId, slug).first<ProfileMetaRow>();
  } catch {
    return null;
  }
}

/** Load brand presentation in one query; falls back to defaults. */
async function loadBrand(brandId: string, env: Env): Promise<BrandRow> {
  try {
    const brand = await env.WKRP_DB.prepare(
      'SELECT name, primary_color, accent_color, logo_url FROM brands WHERE id = ?',
    ).bind(brandId).first<BrandRow>();

    if (!brand) return DEFAULT_BRAND;
    return {
      name: brand.name || DEFAULT_BRAND.name,
      primary_color: brand.primary_color || DEFAULT_BRAND.primary_color,
      accent_color: brand.accent_color || DEFAULT_BRAND.accent_color,
      logo_url: brand.logo_url ?? null,
    };
  } catch {
    // D1 not provisioned yet or brands table doesn't exist — use defaults
    return DEFAULT_BRAND;
  }
}

/**
 * Inject brand colors as CSS custom properties.
 *
 * Every interpolated value is sanitized for its CSS context. These are
 * operator-configured columns rather than end-user input, but they are still
 * database text landing in a `<style>` element: an unsanitized name containing
 * `</style>` would close the element and turn the remainder into markup. The
 * page CSP would block a script injected that way, but "CSP catches it" is a
 * second line of defense, not a reason to emit the injection.
 */
function injectBrandStyles(html: string, brand: BrandRow): string {
  const primary = safeCssColor(brand.primary_color) ?? DEFAULT_BRAND.primary_color;
  const accent = safeCssColor(brand.accent_color) ?? DEFAULT_BRAND.accent_color;
  const name = cssStringSafe(brand.name);
  const styleBlock = `<style>:root{--brand-primary:${primary};--brand-accent:${accent};--brand-name:"${name}";}</style>`;
  // Function replacers here and at every splice below: stored text such as a
  // brand or display name may contain "$&", "$`", "$'" or "$$", which a string
  // replacement would expand (copying page text into the head) instead of
  // inserting literally.
  return html.replace('</head>', () => `${styleBlock}</head>`);
}

/**
 * Absolute base for canonical/OG URLs.
 *
 * APP_URL is the configured public base and is preferred — it carries the right
 * scheme and port. But it names one host, and a brand subdomain
 * (bronzeville.ourwkrp.com) serves a different slug namespace, so pointing its
 * canonical at APP_URL's host would advertise a URL that resolves to a
 * different contributor. When the request host is not APP_URL's host we fall
 * back to the request's own origin, which is always brand-correct.
 */
function canonicalBase(env: Env, url: URL): string {
  const appUrl = env.APP_URL;
  if (appUrl) {
    try {
      const configured = new URL(appUrl);
      if (configured.hostname === url.hostname) {
        return configured.origin;
      }
    } catch {
      // Malformed APP_URL — fall through to the request origin.
    }
  }
  return url.origin;
}

/** Absolute https(s)-only image URL, or null when there is nothing real to point at. */
function resolveImageUrl(logoUrl: string | null, base: string): string | null {
  if (!logoUrl) return null;
  try {
    const resolved = new URL(logoUrl, base);
    // A crawler will fetch this; only http(s) is meaningful, and restricting
    // the scheme keeps javascript:/data: out of the served markup.
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Build the OG/Twitter/canonical block.
 *
 * Every interpolated value is passed through escapeHtmlAttr here — the single
 * choke point — so no caller can forget. Values arrive straight from D1 and are
 * fully user-controlled (a contributor picks their own display name).
 */
function buildMetaBlock(opts: {
  title: string;
  description: string;
  canonicalUrl: string;
  siteName: string;
  ogType: string;
  imageUrl?: string | null;
}): string {
  const title = escapeHtmlAttr(opts.title);
  const description = escapeHtmlAttr(opts.description);
  const canonical = escapeHtmlAttr(opts.canonicalUrl);
  const siteName = escapeHtmlAttr(opts.siteName);

  const lines = [
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:type" content="${escapeHtmlAttr(opts.ogType)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:site_name" content="${siteName}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
  ];

  // og:image only when there is a real image. A tag pointing at a 404 renders
  // a broken preview — worse than no image at all.
  if (opts.imageUrl) {
    lines.push(`<meta property="og:image" content="${escapeHtmlAttr(opts.imageUrl)}">`);
  }

  return lines.join('');
}

/** Server-rendered OG meta for a contributor profile. */
function injectProfileMeta(
  html: string,
  profile: ProfileMetaRow,
  brand: BrandRow,
  env: Env,
  url: URL,
): string {
  const base = canonicalBase(env, url);
  // The vanity URL is the canonical one when it exists: it is the link people
  // share, and collapsing both URLs onto one canonical avoids duplicate-content
  // splitting between /c/:slug and /contributor/:uuid.
  const canonicalUrl = profile.slug
    ? `${base}/c/${profile.slug}`
    : `${base}/contributor/${profile.id}`;

  const block = buildMetaBlock({
    title: `${profile.name} — ${brand.name}`,
    // Role + generation only. Deliberately free of facets, visibility state, and
    // anything else gated on an un-ratified ADR — this is public-flag polish.
    description: `${profile.name} is a ${profile.role} (${profile.generation}) in the ${brand.name} music catalog.`,
    canonicalUrl,
    siteName: brand.name,
    ogType: 'profile',
    imageUrl: resolveImageUrl(brand.logo_url, base),
  });

  return html.replace('</head>', () => `${block}</head>`);
}

/**
 * Static OG meta for the catalog landing page. No per-request lookup: the
 * strings are fixed, so this costs nothing beyond the brand row already loaded.
 */
function injectCatalogMeta(html: string, brand: BrandRow, env: Env, url: URL): string {
  const base = canonicalBase(env, url);
  const block = buildMetaBlock({
    title: `${brand.name} — Catalog`,
    description: `Browse the ${brand.name} community music catalog — tracks, contributors, and playlists.`,
    canonicalUrl: `${base}/catalog`,
    siteName: brand.name,
    ogType: 'website',
    imageUrl: resolveImageUrl(brand.logo_url, base),
  });

  return html.replace('</head>', () => `${block}</head>`);
}
