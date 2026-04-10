import { describe, it, expect } from 'vitest';
import { getSessionToken, buildSessionCookie, buildClearSessionCookie } from '../../src/lib/session-cookie';

describe('session-cookie', () => {
  describe('getSessionToken', () => {
    it('extracts session token from Cookie header', () => {
      const request = new Request('http://localhost:8787/', {
        headers: { Cookie: 'wkrp_session=abc-123-def' },
      });
      expect(getSessionToken(request)).toBe('abc-123-def');
    });

    it('returns null when no Cookie header', () => {
      const request = new Request('http://localhost:8787/');
      expect(getSessionToken(request)).toBeNull();
    });

    it('returns null when cookie header has no wkrp_session', () => {
      const request = new Request('http://localhost:8787/', {
        headers: { Cookie: 'other=value; another=thing' },
      });
      expect(getSessionToken(request)).toBeNull();
    });

    it('extracts token when multiple cookies present', () => {
      const request = new Request('http://localhost:8787/', {
        headers: { Cookie: 'theme=dark; wkrp_session=my-token-xyz; lang=en' },
      });
      expect(getSessionToken(request)).toBe('my-token-xyz');
    });

    it('handles token with equals signs', () => {
      const request = new Request('http://localhost:8787/', {
        headers: { Cookie: 'wkrp_session=abc=def=ghi' },
      });
      expect(getSessionToken(request)).toBe('abc=def=ghi');
    });

    it('returns null for empty cookie value', () => {
      const request = new Request('http://localhost:8787/', {
        headers: { Cookie: 'wkrp_session=' },
      });
      expect(getSessionToken(request)).toBeNull();
    });
  });

  describe('buildSessionCookie', () => {
    it('includes HttpOnly flag', () => {
      const cookie = buildSessionCookie('token-123', false);
      expect(cookie).toContain('HttpOnly');
    });

    it('includes SameSite=Lax', () => {
      const cookie = buildSessionCookie('token-123', false);
      expect(cookie).toContain('SameSite=Lax');
    });

    it('includes Path=/', () => {
      const cookie = buildSessionCookie('token-123', false);
      expect(cookie).toContain('Path=/');
    });

    it('includes 30-day Max-Age', () => {
      const cookie = buildSessionCookie('token-123', false);
      expect(cookie).toContain('Max-Age=2592000');
    });

    it('includes token value', () => {
      const cookie = buildSessionCookie('my-session-token', false);
      expect(cookie).toContain('wkrp_session=my-session-token');
    });

    it('adds Secure flag in production', () => {
      const cookie = buildSessionCookie('token-123', true);
      expect(cookie).toContain('Secure');
    });

    it('omits Secure flag in development', () => {
      const cookie = buildSessionCookie('token-123', false);
      expect(cookie).not.toContain('Secure');
    });
  });

  describe('buildClearSessionCookie', () => {
    it('sets Max-Age=0 to expire the cookie', () => {
      const cookie = buildClearSessionCookie();
      expect(cookie).toContain('Max-Age=0');
    });

    it('includes HttpOnly flag', () => {
      const cookie = buildClearSessionCookie();
      expect(cookie).toContain('HttpOnly');
    });

    it('includes SameSite=Lax', () => {
      const cookie = buildClearSessionCookie();
      expect(cookie).toContain('SameSite=Lax');
    });

    it('clears the token value', () => {
      const cookie = buildClearSessionCookie();
      expect(cookie).toMatch(/^wkrp_session=;/);
    });
  });
});
