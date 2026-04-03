/**
 * Security headers — applied to every response
 *
 * Defense-in-depth headers per OWASP recommendations.
 */

export function addSecurityHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  const h = newResponse.headers;

  // Prevent clickjacking
  h.set('X-Frame-Options', 'DENY');
  h.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-ancestors 'none'");

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
