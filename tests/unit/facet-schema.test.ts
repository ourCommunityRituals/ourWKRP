/**
 * Unit tests — Flag facet Zod schemas (OW-121, HL-P3.2)
 *
 * Pure-function tests of the (domain, depth) validation boundary: the four
 * depth tiers, and the short free-text domain label (strip HTML + trim +
 * non-empty + length-bounded). No HTTP, no DB — the schema in isolation.
 */
import { describe, it, expect } from 'vitest';
import { facetDepthSchema, facetDomainSchema, facetBodySchema } from '../../src/lib/schemas';

describe('flag facet schemas', () => {
  describe('facetDepthSchema', () => {
    it('accepts all four depth tiers', () => {
      expect(facetDepthSchema.parse('lifelong')).toBe('lifelong');
      expect(facetDepthSchema.parse('hobbyist')).toBe('hobbyist');
      expect(facetDepthSchema.parse('dabbler')).toBe('dabbler');
      expect(facetDepthSchema.parse('newcomer')).toBe('newcomer');
    });

    it('rejects a depth outside the four tiers (OW-121)', () => {
      expect(() => facetDepthSchema.parse('expert')).toThrow();
      expect(() => facetDepthSchema.parse('LIFELONG')).toThrow();
      expect(() => facetDepthSchema.parse('')).toThrow();
    });
  });

  describe('facetDomainSchema', () => {
    it('accepts a short label and trims surrounding whitespace', () => {
      expect(facetDomainSchema.parse('bocce')).toBe('bocce');
      expect(facetDomainSchema.parse('  bocce  ')).toBe('bocce');
    });

    it('strips HTML tags from the domain (XSS sanitization)', () => {
      expect(facetDomainSchema.parse('<script>alert(1)</script>bocce')).toBe('alert(1)bocce');
    });

    it('rejects a domain that is empty after stripping and trimming (OW-121)', () => {
      expect(() => facetDomainSchema.parse('')).toThrow();
      expect(() => facetDomainSchema.parse('   ')).toThrow();
      expect(() => facetDomainSchema.parse('<b></b>')).toThrow();
    });

    it('rejects a domain longer than 64 characters', () => {
      expect(() => facetDomainSchema.parse('a'.repeat(65))).toThrow();
      expect(facetDomainSchema.parse('a'.repeat(64))).toHaveLength(64);
    });
  });

  describe('facetBodySchema', () => {
    it('accepts a valid (domain, depth) pair', () => {
      const result = facetBodySchema.parse({ domain: 'bocce', depth: 'lifelong' });
      expect(result.domain).toBe('bocce');
      expect(result.depth).toBe('lifelong');
    });

    it('sanitizes the domain while validating the depth in one pass', () => {
      const result = facetBodySchema.parse({ domain: '  <i>knitting</i>  ', depth: 'hobbyist' });
      expect(result.domain).toBe('knitting');
      expect(result.depth).toBe('hobbyist');
    });

    it('rejects an unknown depth even with a valid domain (OW-121)', () => {
      const result = facetBodySchema.safeParse({ domain: 'bocce', depth: 'guru' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('depth');
      }
    });

    it('rejects a missing domain', () => {
      const result = facetBodySchema.safeParse({ depth: 'newcomer' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('domain');
      }
    });
  });
});
