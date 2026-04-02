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
const SRC_DIR = path.join(__dirname, '../../src');

describe('Token Exposure Prevention', () => {
  const htmlFiles = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.html'));

  for (const file of htmlFiles) {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');

    it(`${file}: does not contain access_token references`, () => {
      expect(content).not.toContain('access_token');
      expect(content).not.toContain('refresh_token');
      expect(content).not.toContain('Bearer ');
    });

    it(`${file}: does not contain client_secret`, () => {
      expect(content).not.toContain('client_secret');
      expect(content).not.toContain('SPOTIFY_CLIENT_SECRET');
    });

    it(`${file}: does not store tokens in localStorage`, () => {
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
      path.join(SRC_DIR, 'handlers/auth-session.ts'),
      'utf-8',
    );
    expect(handlerContent).not.toContain('access_token');
    expect(handlerContent).not.toContain('refresh_token');
  });

  it('pages handler does not interpolate tokens', () => {
    const handlerContent = fs.readFileSync(
      path.join(SRC_DIR, 'handlers/pages.ts'),
      'utf-8',
    );
    expect(handlerContent).not.toContain('access_token');
    expect(handlerContent).not.toContain('refresh_token');
  });
});

describe('No Hardcoded Secrets in Source', () => {
  function getAllTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...getAllTsFiles(full));
      else if (entry.name.endsWith('.ts')) files.push(full);
    }
    return files;
  }

  const tsFiles = getAllTsFiles(SRC_DIR);

  for (const file of tsFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const relative = path.relative(SRC_DIR, file);

    it(`${relative}: does not hardcode Spotify client secret`, () => {
      // Client ID is OK (public), client secret is NOT
      expect(content.toLowerCase()).not.toMatch(/client.?secret\s*[:=]\s*['"][a-f0-9]{32}/);
    });

    it(`${relative}: does not hardcode API keys`, () => {
      expect(content).not.toMatch(/['"]sk[-_][a-zA-Z0-9]{20,}['"]/);
      expect(content).not.toMatch(/['"]AKIA[A-Z0-9]{16}['"]/); // AWS
    });
  }
});
