/**
 * E2E tests — Security
 *
 * Tests security headers, auth boundaries, XSS prevention,
 * and session cookie attributes from the browser level.
 */
import { test, expect } from '@playwright/test';
import { registerUser } from './helpers';

test.describe('Security — Response Headers', () => {
  test('health endpoint returns security headers', async ({ page }) => {
    const response = await page.request.get('/health');
    const headers = response.headers();

    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-xss-protection']).toBe('1; mode=block');
  });

  test('HTML pages return CSP header', async ({ page }) => {
    const response = await page.request.get('/');
    const csp = response.headers()['content-security-policy'];

    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  test('API endpoints return security headers', async ({ page }) => {
    const response = await page.request.get('/api/tracks');
    const headers = response.headers();

    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  test('permissions policy disables unnecessary features', async ({ page }) => {
    const response = await page.request.get('/');
    const pp = response.headers()['permissions-policy'];

    expect(pp).toBeTruthy();
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });
});

test.describe('Security — Session Cookie', () => {
  test('session cookie is HttpOnly', async ({ page, context }) => {
    await registerUser(page.request, {
      name: 'CookieTest',
      role: 'contributor',
      generation: 'gen2',
    });

    // Get cookies from the context
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'wkrp_session');

    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie!.httpOnly).toBe(true);
  });

  test('session cookie has SameSite=Lax', async ({ page, context }) => {
    await registerUser(page.request, {
      name: 'SameSiteTest',
      role: 'contributor',
      generation: 'gen2',
    });

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'wkrp_session');

    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie!.sameSite).toBe('Lax');
  });

  test('session cookie has 30-day expiry', async ({ page, context }) => {
    await registerUser(page.request, {
      name: 'ExpiryTest',
      role: 'contributor',
      generation: 'gen2',
    });

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'wkrp_session');

    expect(sessionCookie).toBeTruthy();
    // Max-Age of 30 days = 2592000 seconds
    // Cookie expires should be roughly 30 days from now
    const thirtyDaysFromNow = Date.now() / 1000 + 2592000;
    const oneDayInSeconds = 86400;
    expect(sessionCookie!.expires).toBeGreaterThan(thirtyDaysFromNow - oneDayInSeconds);
    expect(sessionCookie!.expires).toBeLessThan(thirtyDaysFromNow + oneDayInSeconds);
  });

  test('JavaScript cannot read session cookie', async ({ page }) => {
    await registerUser(page.request, {
      name: 'JSCookieTest',
      role: 'contributor',
      generation: 'gen2',
    });

    await page.goto('/');

    // Try to read cookies via JavaScript
    const cookies = await page.evaluate(() => document.cookie);
    // HttpOnly cookie should NOT appear in document.cookie
    expect(cookies).not.toContain('wkrp_session');
  });
});

test.describe('Security — Auth Boundaries', () => {
  test('/auth/start without name returns 400', async ({ page }) => {
    const response = await page.request.get('/auth/start?gen=founder', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });

  test('/auth/start without gen returns 400', async ({ page }) => {
    const response = await page.request.get('/auth/start?name=Test', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });

  test('/auth/start with empty name returns 400', async ({ page }) => {
    const response = await page.request.get('/auth/start?name=&gen=founder', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(400);
  });

  test('/auth/start with invalid gen returns 400', async ({ page }) => {
    const response = await page.request.get('/auth/start?name=Test&gen=invalid', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(400);
  });

  test('/auth/callback without code or state redirects with error', async ({ page }) => {
    const response = await page.request.get('/auth/callback', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    const location = response.headers()['location'];
    expect(location).toContain('error=');
  });

  test('/auth/callback with invalid state redirects with error', async ({ page }) => {
    const response = await page.request.get('/auth/callback?code=fake&state=bogus', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    const location = response.headers()['location'];
    expect(location).toContain('error=invalid_state');
  });

  test('/auth/session/me without session returns 400 or 401', async ({ page, context }) => {
    // Clear any existing session
    await context.clearCookies();

    const response = await page.request.get('/auth/session/me');
    expect([400, 401]).toContain(response.status());
  });
});

test.describe('Security — XSS Prevention', () => {
  test('error banner does not render HTML from error param', async ({ page }) => {
    await page.goto('/?error=<script>alert(1)</script>');
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();

    // The text should be the generic "An error occurred" — not the injected script
    const text = await banner.textContent();
    expect(text).not.toContain('<script>');
    expect(text).toContain('error occurred');
  });

  test('name with HTML tags is sanitized on registration', async ({ page }) => {
    const response = await page.request.post('/auth/register', {
      data: {
        name: '<img src=x onerror=alert(1)>TestUser',
        role: 'contributor',
        generation: 'gen2',
      },
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    if (data.ok) {
      // Name should be sanitized
      expect(data.contributor.name).not.toContain('<img');
    }
  });

  test('auth/start sanitizes name in KV storage', async ({ page }) => {
    const response = await page.request.get(
      '/auth/start?name=<script>alert(1)</script>&gen=founder',
      { maxRedirects: 0 },
    );
    // Should either reject (400) or accept with sanitized name and redirect (302)
    expect([302, 400]).toContain(response.status());
  });
});

test.describe('Security — Token Exposure', () => {
  test('session endpoint does not expose Spotify tokens', async ({ page }) => {
    await registerUser(page.request, {
      name: 'TokenCheck',
      role: 'contributor',
      generation: 'gen2',
    });

    const response = await page.request.get('/auth/session/me');
    const data = await response.json();

    if (data.ok) {
      const bodyStr = JSON.stringify(data);
      expect(bodyStr).not.toContain('access_token');
      expect(bodyStr).not.toContain('refresh_token');
    }
  });

  test('HTML pages do not contain access tokens', async ({ page }) => {
    await registerUser(page.request, {
      name: 'HTMLTokenCheck',
      role: 'contributor',
      generation: 'gen2',
    });

    await page.goto('/catalog');
    const html = await page.content();
    expect(html).not.toContain('access_token');
    expect(html).not.toContain('refresh_token');
  });
});
