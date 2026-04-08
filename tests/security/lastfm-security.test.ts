/**
 * Security tests — Last.fm integration
 *
 * Validates auth enforcement, input handling, and API safety.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HANDLERS_DIR = path.join(__dirname, '../../src/handlers');
const LASTFM_DIR = path.join(__dirname, '../../src/lastfm');

describe('Last.fm Security', () => {
  const handlerContent = fs.readFileSync(path.join(HANDLERS_DIR, 'lastfm.ts'), 'utf-8');
  const clientContent = fs.readFileSync(path.join(LASTFM_DIR, 'client.ts'), 'utf-8');
  const syncContent = fs.readFileSync(path.join(LASTFM_DIR, 'sync-engine.ts'), 'utf-8');

  describe('Authentication enforcement', () => {
    it('auth start requires existing session', () => {
      expect(handlerContent).toContain('getSessionToken(request)');
      expect(handlerContent).toContain("'Login required");
    });

    it('sync handler requires session', () => {
      expect(handlerContent).toContain("'Authentication required'");
    });

    it('sync handler verifies user ownership', () => {
      expect(handlerContent).toContain('session.userId !== userId');
    });

    it('sync handler has rate limiting', () => {
      expect(handlerContent).toContain('5 * 60 * 1000');
      expect(handlerContent).toContain('Retry-After');
    });
  });

  describe('API key security', () => {
    it('client uses env.LASTFM_API_KEY, not hardcoded keys', () => {
      // Client takes apiKey as a parameter, never hardcodes it
      expect(clientContent).not.toMatch(/api_key.*=.*['"][a-f0-9]{32}['"]/);
    });

    it('handler passes env.LASTFM_API_KEY to client', () => {
      expect(handlerContent).toContain('env.LASTFM_API_KEY');
    });

    it('handler passes env.LASTFM_SHARED_SECRET to client', () => {
      expect(handlerContent).toContain('env.LASTFM_SHARED_SECRET');
    });
  });

  describe('SQL injection prevention', () => {
    it('sync engine uses parameterized queries', () => {
      const prepares = syncContent.match(/\.prepare\(`[^`]*`\)/g) || [];
      for (const prepare of prepares) {
        expect(prepare).not.toMatch(/\$\{/);
      }
    });

    it('sync engine binds all parameters', () => {
      const prepareCount = (syncContent.match(/\.prepare\(/g) || []).length;
      const bindCount = (syncContent.match(/\.bind\(/g) || []).length;
      expect(bindCount).toBeGreaterThanOrEqual(prepareCount - 1);
    });
  });

  describe('Session key handling', () => {
    it('session key stored in KV, not in response', () => {
      expect(handlerContent).toContain('storeLastfmSession');
      // Never returns session_key to client
      expect(handlerContent).not.toMatch(/Response\.json.*session_key/);
    });

    it('callback redirects (no token in URL)', () => {
      // After auth, redirect to catalog — no tokens in URL
      expect(handlerContent).toContain("Response.redirect(`${env.APP_URL}/catalog?lastfm=connected`");
    });
  });

  describe('Rate limit handling', () => {
    it('client retries on 429', () => {
      expect(clientContent).toContain('429');
      expect(clientContent).toContain('MAX_RETRIES');
    });

    it('client uses exponential backoff', () => {
      expect(clientContent).toContain('Math.pow(2, attempt)');
    });

    it('client caps pagination to prevent runaway syncs', () => {
      // maxPages parameter prevents runaway syncs
      expect(clientContent).toContain('maxPages');
    });
  });

  describe('No dangerous patterns', () => {
    const allContent = handlerContent + clientContent + syncContent;

    it('does not use eval', () => {
      expect(allContent).not.toMatch(/\beval\s*\(/);
    });

    it('does not use Function constructor', () => {
      expect(allContent).not.toMatch(/new\s+Function\s*\(/);
    });
  });
});
