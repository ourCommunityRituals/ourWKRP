/**
 * Security tests — Token exposure prevention
 *
 * Verifies that Spotify tokens never leak to the frontend.
 * Critical: the whole point of server-side auth is keeping secrets server-side.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TEMPLATES_DIR = path.join(__dirname, '../../src/templates');

describe('Token Exposure Prevention', () => {
  const htmlFiles = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.html'));

  for (const file of htmlFiles) {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');

    it(`${file}: does not contain access_token references`, () => {
      // Check for patterns that would expose tokens
      expect(content).not.toContain('access_token');
      expect(content).not.toContain('refresh_token');
      expect(content).not.toContain('Bearer ');
    });

    it(`${file}: does not contain client_secret`, () => {
      expect(content).not.toContain('client_secret');
      expect(content).not.toContain('SPOTIFY_CLIENT_SECRET');
    });

    it(`${file}: does not store tokens in localStorage`, () => {
      // Session tokens are OK, but not Spotify tokens
      const localStorageSets = content.match(/localStorage\.setItem\([^)]+\)/g) || [];
      for (const call of localStorageSets) {
        expect(call).not.toContain('access_token');
        expect(call).not.toContain('refresh_token');
        expect(call).not.toContain('spotify_token');
      }
    });
  }

  it('auth-session handler does not return tokens', () => {
    const handlerContent = fs.readFileSync(
      path.join(__dirname, '../../src/handlers/auth-session.ts'),
      'utf-8',
    );
    // The handler should return contributor info, not tokens
    expect(handlerContent).not.toContain('access_token');
    expect(handlerContent).not.toContain('refresh_token');
  });

  it('pages handler does not interpolate tokens', () => {
    const handlerContent = fs.readFileSync(
      path.join(__dirname, '../../src/handlers/pages.ts'),
      'utf-8',
    );
    expect(handlerContent).not.toContain('access_token');
    expect(handlerContent).not.toContain('refresh_token');
  });
});
