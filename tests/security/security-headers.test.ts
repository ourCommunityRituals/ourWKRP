/**
 * Security tests — HTTP security headers
 *
 * Verifies that all responses include defense-in-depth security headers
 * per OWASP recommendations.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { addSecurityHeaders } from '../../src/lib/security-headers';

describe('Security Headers', () => {
  describe('Source code audit', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/lib/security-headers.ts'),
      'utf-8',
    );

    it('sets X-Frame-Options DENY', () => {
      expect(source).toContain('X-Frame-Options');
      expect(source).toContain('DENY');
    });

    it('sets Content-Security-Policy frame-ancestors', () => {
      expect(source).toContain('Content-Security-Policy');
      expect(source).toContain("frame-ancestors 'none'");
    });

    it('scopes frame-src to Spotify (playlist embeds) and nothing wider', () => {
      expect(source).toContain('frame-src https://open.spotify.com');
      expect(source).not.toContain('frame-src *');
    });

    it('sets X-Content-Type-Options nosniff', () => {
      expect(source).toContain('X-Content-Type-Options');
      expect(source).toContain('nosniff');
    });

    it('sets Referrer-Policy', () => {
      expect(source).toContain('Referrer-Policy');
      expect(source).toContain('strict-origin-when-cross-origin');
    });

    it('sets Strict-Transport-Security (HSTS)', () => {
      expect(source).toContain('Strict-Transport-Security');
      expect(source).toContain('includeSubDomains');
    });

    it('sets Permissions-Policy to disable unused features', () => {
      expect(source).toContain('Permissions-Policy');
      expect(source).toContain('camera=()');
      expect(source).toContain('microphone=()');
    });
  });

  describe('Header application', () => {
    it('adds all required headers to response', () => {
      const response = new Response('test', { status: 200 });
      const secured = addSecurityHeaders(response);

      expect(secured.headers.get('X-Frame-Options')).toBe('DENY');
      expect(secured.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(secured.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(secured.headers.get('X-XSS-Protection')).toBe('1; mode=block');
      expect(secured.headers.get('Permissions-Policy')).toContain('camera=()');
    });

    it('preserves original response status', () => {
      const response = new Response('not found', { status: 404 });
      const secured = addSecurityHeaders(response);
      expect(secured.status).toBe(404);
    });

    it('preserves original response body', async () => {
      const response = new Response('hello');
      const secured = addSecurityHeaders(response);
      expect(await secured.text()).toBe('hello');
    });
  });

  describe('Router applies security headers', () => {
    const routerSource = fs.readFileSync(
      path.join(__dirname, '../../src/router.ts'),
      'utf-8',
    );

    it('imports addSecurityHeaders', () => {
      expect(routerSource).toContain("import { addSecurityHeaders }");
    });

    it('calls addSecurityHeaders on every response', () => {
      expect(routerSource).toContain('addSecurityHeaders(response)');
    });

    it('applies security headers before CORS headers', () => {
      // Security headers should be added first, then CORS
      const secIdx = routerSource.indexOf('addSecurityHeaders(response)');
      const corsIdx = routerSource.indexOf('addCorsHeaders(response');
      expect(secIdx).toBeLessThan(corsIdx);
    });
  });
});
