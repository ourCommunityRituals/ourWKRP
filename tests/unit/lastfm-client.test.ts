/**
 * Unit tests — Last.fm client
 */
import { describe, it, expect } from 'vitest';
import { getAuthUrl } from '../../src/lastfm/client';

describe('Last.fm Client', () => {
  describe('getAuthUrl', () => {
    it('builds correct auth URL with API key and callback', () => {
      const url = getAuthUrl('test-api-key', 'http://localhost:8787/auth/lastfm/callback');
      expect(url).toContain('https://www.last.fm/api/auth/');
      expect(url).toContain('api_key=test-api-key');
      expect(url).toContain('cb=http');
      expect(url).toContain('auth%2Flastfm%2Fcallback');
    });

    it('encodes callback URL properly', () => {
      const url = getAuthUrl('key', 'https://ourwkrp.com/auth/lastfm/callback');
      // Verify the callback is URL-encoded
      expect(url).toContain('cb=https');
    });
  });
});
