/**
 * Session cookie helpers
 *
 * Session token is stored in an HttpOnly cookie — never in URLs.
 * This prevents leakage via Referrer headers, browser history, and logs.
 */

const COOKIE_NAME = 'wkrp_session';

/**
 * Extract session token from the request cookie header
 */
export function getSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) {
      return rest.join('=') || null;
    }
  }
  return null;
}

/**
 * Build Set-Cookie header for session token.
 * HttpOnly: JS can't read it. SameSite=Lax: sent on top-level navigations (OAuth redirect).
 * Secure: HTTPS only in production.
 */
export function buildSessionCookie(sessionToken: string, isProduction: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${sessionToken}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${30 * 24 * 60 * 60}`, // 30 days
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Build Set-Cookie header that clears the session
 */
export function buildClearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
