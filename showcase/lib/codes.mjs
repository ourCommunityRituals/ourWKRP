// Digital codes: only OSE's own /q (tracking) and /s (routing) URLs, each shown
// as a QR code drawn by OW's own encoder and as a link carrying the same URL.
// No new tracking path, in OSE or OW (owner, 2026-11-12).
import * as qr from '../../src/lib/qr.ts';

// Node loads qr.ts as an ES module; Playwright's loader hands it over as
// CommonJS (the package has no "type"), so take the export from either shape.
const qrMatrix = qr.qrMatrix ?? qr.default?.qrMatrix;

/** Poster code kinds that open a form. Forms are the identified side (FORMS_DB): never a tracked code here. */
export const FORM_KINDS = new Set(['checkin', 'register']);

const TRACK_PATH = /^\/q\/[A-Za-z0-9_-]{4,64}$/;
const ROUTE_PATH = /^\/s\/[A-Za-z0-9]{4,16}$/;

/**
 * Why a URL may not be shown as a code, or null when it may: it must be
 * `<origin>/q/<token>` or `<origin>/s/<code>`, with nothing after the path.
 */
export function codeUrlProblem(url, origin) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return `not a URL: ${String(url).slice(0, 80)}`;
  }
  if (u.origin !== origin) return `not on the OSE origin ${origin}: ${u.origin}`;
  if (u.search || u.hash || u.username || u.password) return `carries more than a path: ${u.pathname}${u.search}`;
  if (!TRACK_PATH.test(u.pathname) && !ROUTE_PATH.test(u.pathname)) return `not an OSE /q or /s path: ${u.pathname}`;
  return null;
}

/**
 * The codes a station shows for one event, from OSE's public poster bundle:
 * the showcase placement's /q code first (when the bundle was read for a
 * placement), then the event's own /s codes. Form codes are left out. Any code
 * that is not an OSE /q or /s URL stops the build.
 */
export function codesFromBundle(bundle, origin) {
  const codes = [];
  if (bundle?.deploymentId) {
    // The bundle's links are /q/<token>?type=<form>: the placement's scan URL
    // per form. The page shows the bare /q/<token>, which opens the event page.
    const tracked = new Set(
      Object.values(bundle.links ?? {}).map((l) => {
        const u = new URL(String(l));
        return `${u.origin}${u.pathname}`;
      }),
    );
    if (tracked.size !== 1) throw new Error(`poster bundle: expected one /q code for the placement, found ${tracked.size}`);
    const [url] = tracked;
    const bad = codeUrlProblem(url, origin);
    if (bad || !url.startsWith(`${origin}/q/`)) throw new Error(`poster bundle: placement code refused (${bad ?? 'not a /q code'})`);
    codes.push({ kind: 'track', word: 'GO', label: 'This event', url });
  }
  for (const s of bundle?.slots ?? []) {
    if (FORM_KINDS.has(s.kind)) continue;
    const bad = codeUrlProblem(s.url, origin);
    if (bad || !String(s.url).startsWith(`${origin}/s/`)) throw new Error(`poster bundle: ${s.kind} code refused (${bad ?? 'not an /s code'})`);
    codes.push({ kind: String(s.kind), word: String(s.word ?? s.kind).toUpperCase(), label: String(s.label ?? s.kind), url: s.url });
  }
  return codes;
}

/** The SVG path of a QR code for a URL: dark modules as unit squares inside a 4-module quiet zone. */
export function qrPath(url) {
  const matrix = qrMatrix(url);
  let d = '';
  matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4},${y + 4}h1v1h-1z`; }));
  return { d, dim: matrix.length + 8 };
}

/**
 * A QR code as inline SVG. Its colours come from the page's tokens (CSS), so
 * the markup holds only numbers and fixed strings: the URL itself never appears in it.
 */
export function qrSvg(url) {
  const { d, dim } = qrPath(url);
  return `<svg class="qr" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><rect class="qr-paper" width="${dim}" height="${dim}"></rect><path class="qr-ink" d="${d}"></path></svg>`;
}
