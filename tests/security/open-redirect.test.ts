/**
 * Security tests — Open redirect prevention
 *
 * OAuth callback flows are a classic open redirect vector.
 * Verifies that all redirects target only allowed domains.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Open Redirect Prevention', () => {
  describe('auth-callback redirect validation', () => {
    const callbackSource = fs.readFileSync(
      path.join(__dirname, '../../src/handlers/auth-callback.ts'),
      'utf-8',
    );

    it('validates redirect target before redirecting', () => {
      expect(callbackSource).toContain('validateRedirectTarget');
    });

    it('uses validated appUrl instead of raw env.APP_URL for redirects', () => {
      // All redirects should use the validated `appUrl`, not `env.APP_URL`
      const redirectMatches = callbackSource.match(/Response\.redirect\(`\$\{([^}]+)\}/g) || [];
      for (const match of redirectMatches) {
        expect(match).toContain('appUrl');
        expect(match).not.toContain('env.APP_URL');
      }
    });

    it('has an allowlist of valid redirect hosts', () => {
      expect(callbackSource).toContain('ALLOWED_REDIRECT_HOSTS');
      expect(callbackSource).toContain('ourwkrp.com');
      expect(callbackSource).toContain('localhost');
    });

    it('rejects non-HTTPS for production hosts', () => {
      expect(callbackSource).toContain("url.protocol !== 'https:'");
    });

    it('returns 500 if APP_URL is unsafe, not a redirect', () => {
      expect(callbackSource).toContain('Server misconfiguration');
      expect(callbackSource).toContain('status: 500');
    });
  });

  describe('auth-start does not redirect to user-controlled URLs', () => {
    const startSource = fs.readFileSync(
      path.join(__dirname, '../../src/handlers/auth-start.ts'),
      'utf-8',
    );

    it('only redirects to Spotify authorize URL', () => {
      const redirectMatches = startSource.match(/Response\.redirect\([^)]+\)/g) || [];
      expect(redirectMatches.length).toBe(1); // Only one redirect
      expect(startSource).toContain('authUrl'); // Built from buildAuthUrl
    });

    it('does not use user-supplied values in redirect URL', () => {
      // name and gen should go to KV, not into the redirect URL
      expect(startSource).not.toMatch(/Response\.redirect\(.*name/);
      expect(startSource).not.toMatch(/Response\.redirect\(.*gen/);
    });
  });

  describe('No redirect to user-controlled query params', () => {
    const routerSource = fs.readFileSync(
      path.join(__dirname, '../../src/router.ts'),
      'utf-8',
    );

    it('router does not redirect based on query parameters', () => {
      // Redirects based on ?next= or ?redirect= are open redirect vectors
      expect(routerSource).not.toContain('searchParams.get(\'redirect\'');
      expect(routerSource).not.toContain('searchParams.get(\'next\'');
      expect(routerSource).not.toContain('searchParams.get(\'return\'');
    });
  });
});
