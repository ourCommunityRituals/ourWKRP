/**
 * Unit tests — every page is on the shared @ocr/ui design system (ADR-008).
 *
 * ourWKRP carries no design system of its own: each template links the one
 * shared stylesheet (/ui.css, served by the router from @ocr/ui), paints itself
 * with the registered "ow" brand (amber on black), and keeps at most a small
 * page-specific <style>. The spoke-level CI gate (check-spoke-styles.mjs against
 * .ocr-design-check.json) blocks regressions; this file pins the page contract.
 */
import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ocrStylesheet } from '@ocr/ui/css';

const DIR = path.join(__dirname, '../../src/templates');
const TEMPLATES = fs.readdirSync(DIR).filter((f) => f.endsWith('.html')).sort();

describe('shared design system adoption', () => {
  test('all nine WKRP pages are covered', () => {
    expect(TEMPLATES).toEqual([
      'catalog.html', 'connect.html', 'create.html', 'dashboard.html', 'import.html',
      'live.html', 'profile.html', 'qr-poster.html', 'stats.html',
    ]);
  });

  test('the shared sheet registers the ow brand', () => {
    expect(ocrStylesheet).toContain('[data-brand="ow"]');
  });

  describe.each(TEMPLATES)('%s', (file) => {
    const html = fs.readFileSync(path.join(DIR, file), 'utf-8');
    const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '');
    const css = styles.join('\n');

    test('links /ui.css exactly once and no other stylesheet', () => {
      const links = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
      expect(links).toEqual(['<link rel="stylesheet" href="/ui.css">']);
    });

    test('paints with the ow brand on <html>', () => {
      expect(html).toMatch(/<html lang="en" data-brand="ow">/);
    });

    test('keeps at most 400 chars of page-specific CSS and declares no tokens', () => {
      expect(css.trim().length).toBeLessThanOrEqual(400);
      expect(css).not.toMatch(/:root|--[a-z-]+\s*:/);
    });

    test('carries no raw hex colour anywhere (styles, style="", or script)', () => {
      expect(html.replace(/&#x[0-9a-f]+;/gi, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });
  });
});
