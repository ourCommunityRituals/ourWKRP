/**
 * Unit tests — audio-feature UI gating (OW-120)
 *
 * Structural checks on the served templates. A catalog with zero audio
 * features is a normal state (Spotify refuses /audio-features to newer apps),
 * and audio-feature controls in that state silently return empty result sets.
 * Both templates must therefore gate those controls on the has_audio_features
 * stat rather than rendering them unconditionally.
 */
import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ocrStylesheet } from '@ocr/ui/css';

const TEMPLATE = (name: string) =>
  fs.readFileSync(path.join(__dirname, '../../src/templates', name), 'utf-8');

const catalogHtml = TEMPLATE('catalog.html');
const createHtml = TEMPLATE('create.html');

// The [hidden] rule now lives in the shared @ocr/ui stylesheet every page links
// (ADR-008), not in each template — so "authoritative" means: the page links
// /ui.css, the sheet carries the !important rule, and it is the sheet's last rule
// (a later component display rule could otherwise un-hide the element).
function hiddenIsAuthoritative(html: string): void {
  expect(html).toContain('<link rel="stylesheet" href="/ui.css">');
  expect(ocrStylesheet).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  expect(ocrStylesheet.trimEnd().endsWith('[hidden]{display:none!important}')).toBe(true);
}

// ============================================
// Where: the catalog page, whose audio-feature chips and sliders only work
// when tracks carry audio features
// ============================================
describe('catalog.html audio-feature gating (OW-120)', () => {
  describe('audio-feature chips and range sliders', () => {
    test('renders the chip group hidden by default', () => {
      expect(catalogHtml).toMatch(
        /<span[^>]*id="audio-feature-chips"[^>]*\shidden[^>]*>/,
      );
    });

    test('renders the range sliders hidden by default', () => {
      expect(catalogHtml).toMatch(/<div[^>]*id="range-filters"[^>]*\shidden[^>]*>/);
    });

    test('carries a data-testid on the gated chip group (testid convention)', () => {
      expect(catalogHtml).toContain('data-testid="audio-feature-chips"');
    });

    test('every audio-feature chip sits inside the gated group', () => {
      const group = catalogHtml.match(
        /<span[^>]*id="audio-feature-chips"[\s\S]*?<\/span>/,
      );
      expect(group).not.toBeNull();
      for (const filter of ['high-energy', 'chill', 'happy', 'danceable', 'acoustic', 'advanced']) {
        expect(group![0]).toContain(`data-filter="${filter}"`);
      }
    });

    test('leaves the non-audio "All" chip outside the gate — it works without features', () => {
      const group = catalogHtml.match(
        /<span[^>]*id="audio-feature-chips"[\s\S]*?<\/span>/,
      );
      expect(group![0]).not.toContain('data-filter="all"');
    });

    test('un-hides the controls from the has_audio_features stat', () => {
      expect(catalogHtml).toContain('applyAudioFeatureGate(data.stats.has_audio_features === true)');
      expect(catalogHtml).toContain('function applyAudioFeatureGate(hasFeatures)');
    });

    test('keeps [hidden] authoritative over the display rules on those elements', () => {
      hiddenIsAuthoritative(catalogHtml);
    });
  });
});

// ============================================
// Where: the create page's "Filter by Audio Features" section
// ============================================
describe('create.html audio-feature gating (OW-120)', () => {
  describe('audio-feature slider section', () => {
    test('renders the section hidden by default', () => {
      expect(createHtml).toMatch(/<div[^>]*id="audio-feature-section"[^>]*\shidden[^>]*>/);
    });

    test('carries a data-testid on the gated section (testid convention)', () => {
      expect(createHtml).toContain('data-testid="audio-feature-section"');
    });

    test('fetches /api/stats and un-hides only when has_audio_features is true', () => {
      expect(createHtml).toContain("fetch('/api/stats')");
      expect(createHtml).toContain('data.stats.has_audio_features === true');
      expect(createHtml).toContain('section.hidden = false');
    });

    test('keeps [hidden] authoritative over the display rules on that section', () => {
      hiddenIsAuthoritative(createHtml);
    });
  });
});

// ============================================
// Where: every inline script in the gated templates
// ============================================
describe('CSP nonce placeholders survive the gating edits (OW-120)', () => {
  describe('inline <script> tags', () => {
    test('every inline script in catalog.html still carries the nonce placeholder', () => {
      const inlineScripts = catalogHtml.match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? [];
      expect(inlineScripts.length).toBeGreaterThan(0);
      for (const tag of inlineScripts) {
        expect(tag).toContain('nonce="__CSP_NONCE__"');
      }
    });

    test('every inline script in create.html still carries the nonce placeholder', () => {
      const inlineScripts = createHtml.match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? [];
      expect(inlineScripts.length).toBeGreaterThan(0);
      for (const tag of inlineScripts) {
        expect(tag).toContain('nonce="__CSP_NONCE__"');
      }
    });
  });
});
