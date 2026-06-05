/**
 * Security headers — applied to every response
 *
 * Defense-in-depth headers per OWASP recommendations.
 */

/**
 * Default CSP for non-HTML responses (JSON/CSV) — no inline scripts exist on
 * these, so script execution is fully disallowed. HTML pages set their own
 * nonce-based CSP in handlePages (see buildPageCsp); we never overwrite it.
 *
 * style-src retains 'unsafe-inline' because the templates use ~70 inline
 * style="" attributes (not coverable by a nonce). Style injection is far lower
 * risk than script injection; tightening this would require refactoring those
 * attributes to classes — tracked as a follow-up, not a blocker.
 */
const DEFAULT_CSP =
  "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * CSP for an HTML page: inline scripts allowed only with this request's nonce.
 *
 * frame-src https://open.spotify.com lets profile.html embed Spotify playlist
 * players (the portfolio feature); frame-ancestors 'none' still forbids anyone
 * from framing us.
 */
export function buildPageCsp(nonce: string): string {
  return `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self'; frame-src https://open.spotify.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
}

export function addSecurityHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  const h = newResponse.headers;

  // Prevent clickjacking. frame-ancestors 'none' = nobody may frame us.
  // X-Frame-Options stays DENY for older browsers. (Spotify playlist embeds
  // are allowed via frame-src in buildPageCsp on the HTML page only.)
  h.set('X-Frame-Options', 'DENY');
  // Do not clobber a page's nonce-based CSP set upstream (buildPageCsp).
  // Non-HTML responses (JSON/CSV) get the strict default with script-src 'none'.
  if (!h.has('Content-Security-Policy')) {
    h.set('Content-Security-Policy', DEFAULT_CSP);
  }

  // Prevent MIME sniffing
  h.set('X-Content-Type-Options', 'nosniff');

  // Referrer — only send origin, never full URL (protects session tokens in query strings)
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Prevent XSS in older browsers
  h.set('X-XSS-Protection', '1; mode=block');

  // HSTS — enforce HTTPS (skip in local dev)
  if (!newResponse.url || !newResponse.url.startsWith('http://localhost')) {
    h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // Permissions policy — disable features we don't need
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  return newResponse;
}
