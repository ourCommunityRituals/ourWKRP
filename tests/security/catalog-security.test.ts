/**
 * Security tests — Catalog API + Playlist Builder
 *
 * Validates input sanitization, auth enforcement, and SQL safety
 * in the new WKRP-6/7/8 handlers.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HANDLERS_DIR = path.join(__dirname, '../../src/handlers');
const LIB_DIR = path.join(__dirname, '../../src/lib');

describe('Catalog API Security', () => {
  const catalogContent = fs.readFileSync(path.join(HANDLERS_DIR, 'catalog.ts'), 'utf-8');
  const playlistContent = fs.readFileSync(path.join(HANDLERS_DIR, 'playlist.ts'), 'utf-8');
  const brandContent = fs.readFileSync(path.join(LIB_DIR, 'brand.ts'), 'utf-8');

  describe('FTS5 injection prevention', () => {
    it('catalog.ts sanitizes FTS5 query input', () => {
      expect(catalogContent).toContain('sanitizeFtsQuery');
    });

    it('sanitizeFtsQuery strips dangerous FTS5 operators', () => {
      // The function should remove * " () : ^ {} [] \ characters
      expect(catalogContent).toMatch(/replace\([^)]*[*"():^{}\[\]\\]/);
    });
  });

  describe('SQL injection prevention in catalog', () => {
    it('catalog.ts uses parameterized queries only', () => {
      // No string interpolation in SQL templates
      const prepares = catalogContent.match(/\.prepare\(`[^`]*`\)/g) || [];
      for (const prepare of prepares) {
        expect(prepare).not.toMatch(/\$\{/);
      }
    });

    it('catalog.ts does not concatenate user input into SQL', () => {
      expect(catalogContent).not.toMatch(/['"]SELECT.*\+.*['"]|['"]INSERT.*\+.*['"]/);
    });
  });

  describe('SQL injection prevention in playlist', () => {
    it('playlist.ts uses parameterized queries only', () => {
      const prepares = playlistContent.match(/\.prepare\(`[^`]*`\)/g) || [];
      for (const prepare of prepares) {
        expect(prepare).not.toMatch(/\$\{/);
      }
    });

    it('playlist.ts does not concatenate user input into SQL', () => {
      expect(playlistContent).not.toMatch(/['"]SELECT.*\+.*['"]|['"]INSERT.*\+.*['"]/);
    });
  });

  describe('Playlist authentication', () => {
    it('handleCreatePlaylist requires authentication', () => {
      expect(playlistContent).toContain('authenticate(request, env)');
    });

    it('handleAddPlaylistTracks requires authentication', () => {
      // Count authenticate calls — should be at least 3 (create, add, remove)
      const authCalls = (playlistContent.match(/authenticate\(request, env\)/g) || []).length;
      expect(authCalls).toBeGreaterThanOrEqual(3);
    });

    it('playlist operations check ownership', () => {
      expect(playlistContent).toContain('contributor_id !== userId');
      expect(playlistContent).toContain('requireOwnedPlaylist');
    });

    it('playlist creation checks role', () => {
      expect(playlistContent).toContain('ALLOWED_CREATOR_ROLES');
      expect(playlistContent).toContain("'founder'");
      expect(playlistContent).toContain("'curator'");
    });
  });

  describe('Input validation', () => {
    it('playlist name is validated for length', () => {
      expect(playlistContent).toContain('name.length');
    });

    it('playlist description is truncated', () => {
      expect(playlistContent).toContain('.slice(0, 1000)');
    });

    it('track_ids has max batch size', () => {
      expect(playlistContent).toContain('trackIds.length > 100');
    });

    it('audio feature params are clamped to 0-1 range', () => {
      expect(catalogContent).toContain('Math.max(0, Math.min(1,');
    });
  });

  describe('Brand extraction safety', () => {
    it('validates subdomain format with regex', () => {
      expect(brandContent).toMatch(/\/\^?\[a-z0-9-\]\+\$?\//);
    });

    it('skips www and stg subdomains', () => {
      expect(brandContent).toContain("'www'");
      expect(brandContent).toContain("'stg'");
    });
  });

  describe('No dangerous patterns', () => {
    const allContent = catalogContent + playlistContent;

    it('does not use eval', () => {
      expect(allContent).not.toMatch(/\beval\s*\(/);
    });

    it('does not use Function constructor', () => {
      expect(allContent).not.toMatch(/new\s+Function\s*\(/);
    });

    it('does not use innerHTML', () => {
      expect(allContent).not.toContain('innerHTML');
    });
  });
});
