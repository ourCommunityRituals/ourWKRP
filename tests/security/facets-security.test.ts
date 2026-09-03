/**
 * Security tests — Flag facets (OW-121, HL-P3.2)
 *
 * Two concerns:
 *  1. The handler enforces auth + ownership and only ever parameterizes SQL.
 *  2. A contributor-supplied `domain` is rendered as escaped data and can never
 *     break out of the profile page's single nonce-guarded inline script — a
 *     structural check on the actual served bytes.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { Env } from '../../src/types';
import { handlePages } from '../../src/handlers/pages';

const HANDLERS_DIR = path.join(__dirname, '../../src/handlers');
const TEMPLATES_DIR = path.join(__dirname, '../../src/templates');

const facetsContent = fs.readFileSync(path.join(HANDLERS_DIR, 'facets.ts'), 'utf-8');
const profileHtml = fs.readFileSync(path.join(TEMPLATES_DIR, 'profile.html'), 'utf-8');

describe('Flag Facets Security', () => {
  describe('authentication and ownership (facets.ts)', () => {
    it('gates both declare and delete behind requireSession', () => {
      const authCalls = (facetsContent.match(/requireSession\(request, env\)/g) || []).length;
      expect(authCalls).toBeGreaterThanOrEqual(2);
    });

    it('enforces owner-only deletion via a contributor ownership check', () => {
      expect(facetsContent).toContain('contributor_id !== auth.userId');
    });

    it('validates the request body through the Zod boundary', () => {
      expect(facetsContent).toContain('validateBody');
      expect(facetsContent).toContain('facetBodySchema');
    });
  });

  describe('SQL injection prevention (facets.ts)', () => {
    it('uses parameterized queries only — no template interpolation in SQL', () => {
      const prepares = facetsContent.match(/\.prepare\(`[^`]*`\)/g) || [];
      for (const prepare of prepares) {
        expect(prepare).not.toMatch(/\$\{/);
      }
    });

    it('does not concatenate user input into SQL strings', () => {
      expect(facetsContent).not.toMatch(/['"]SELECT.*\+.*['"]|['"]INSERT.*\+.*['"]|['"]DELETE.*\+.*['"]/);
    });
  });

  describe('XSS prevention in the profile facet render (profile.html)', () => {
    it('escapes the domain and depth through escapeHtml, never raw interpolation', () => {
      expect(profileHtml).toContain('escapeHtml(f.domain)');
      expect(profileHtml).toContain('escapeHtml(f.depth)');
    });

    it('escapeHtml is the textContent-based encoder (safe), not innerHTML assembly of raw input', () => {
      expect(profileHtml).toContain('div.textContent = str');
    });

    it('exposes stable facet test hooks', () => {
      expect(profileHtml).toContain('data-testid="facets-section"');
      expect(profileHtml).toContain('data-testid="facet-chip"');
    });
  });

  describe('served profile bytes stay structurally intact', () => {
    /** Env whose DB throws so brand-style injection falls back to defaults. */
    const stubEnv = {
      WKRP_DB: { prepare() { throw new Error('no db in this test'); } },
    } as unknown as Env;

    async function serveProfile(): Promise<Response> {
      const req = new Request('http://localhost:8787/contributor/00000000-0000-0000-0000-000000000000');
      return handlePages(req, stubEnv);
    }

    it('serves the profile page as HTML with the facets section present', async () => {
      const res = await serveProfile();
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const body = await res.text();
      expect(body).toContain('data-testid="facet-list"');
    });

    it('substitutes the CSP nonce placeholder and keeps exactly one inline script', async () => {
      const res = await serveProfile();
      const body = await res.text();

      // The literal placeholder must be fully replaced — a stray one would leave
      // the inline script without a valid nonce and silently break the page.
      expect(body).not.toContain('__CSP_NONCE__');

      // Exactly one inline <script>, carrying a real 32-hex-char nonce.
      const scriptTags = body.match(/<script\b/g) || [];
      expect(scriptTags).toHaveLength(1);
      const nonceMatch = body.match(/<script nonce="([a-f0-9]{32})"/);
      expect(nonceMatch).not.toBeNull();

      // The CSP header pins that same nonce.
      const csp = res.headers.get('Content-Security-Policy') || '';
      expect(csp).toContain(`'nonce-${nonceMatch![1]}'`);
    });
  });
});
