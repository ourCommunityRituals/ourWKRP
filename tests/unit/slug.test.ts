/**
 * Unit tests — Vanity slug rules (OW-122, HL-P3.3)
 *
 * Covers the shape rules (lib/slug.ts) and the validation boundary
 * (schemas.ts slugSchema) that together decide whether a contributor may claim
 * a name in the public /c/:slug namespace.
 *
 * The reserved-word block re-derives the route inventory from src/router.ts at
 * test time rather than restating a hand-written list, so a new top-level route
 * that lands without being reserved fails here instead of quietly becoming
 * claimable.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { slugSchema } from '../../src/lib/schemas';
import {
  SLUG_RE,
  RESERVED_SLUGS,
  ROUTE_RESERVED_SLUGS,
  isReservedSlug,
  isClaimableSlug,
} from '../../src/lib/slug';

const ROUTER_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/router.ts'),
  'utf-8',
);

/**
 * Every top-level path segment src/router.ts dispatches on. Reads the literal
 * route strings out of the source — `path === '/x'`, `path.startsWith('/x/')`,
 * and the `[...].includes(path)` page list — and keeps the first segment.
 */
function topLevelRouteSegments(source: string): string[] {
  const segments = new Set<string>();

  const take = (route: string) => {
    if (!route.startsWith('/')) return;
    const segment = route.split('/')[1];
    if (segment) segments.add(segment);
  };

  for (const match of source.matchAll(/path\s*(?:===|\.startsWith\()\s*'([^']+)'/g)) {
    take(match[1]);
  }
  for (const listMatch of source.matchAll(/\[([^\]]*)\]\.includes\(path\)/g)) {
    for (const literal of listMatch[1].matchAll(/'([^']+)'/g)) {
      take(literal[1]);
    }
  }

  return [...segments].sort();
}

const ROUTE_SEGMENTS = topLevelRouteSegments(ROUTER_SRC);

/** Convenience: does slugSchema accept this input? */
const accepts = (value: unknown) => slugSchema.safeParse(value).success;

describe('vanity slug validation (OW-122)', () => {
  describe('slugSchema — well-formed slugs', () => {
    it('accepts a simple lowercase slug', () => {
      expect(accepts('matt')).toBe(true);
    });

    it('accepts digits and internal hyphens', () => {
      expect(accepts('dj-matt-2')).toBe(true);
    });

    it('accepts an all-numeric slug', () => {
      expect(accepts('1979')).toBe(true);
    });

    it('accepts the two-character minimum', () => {
      expect(accepts('ab')).toBe(true);
    });

    it('accepts the 64-character maximum', () => {
      expect(accepts('a'.repeat(64))).toBe(true);
    });
  });

  describe('slugSchema — rejected shapes', () => {
    it('rejects uppercase rather than folding it (one slug, one spelling)', () => {
      expect(accepts('Matt')).toBe(false);
      expect(accepts('MATT')).toBe(false);
    });

    it('rejects a leading hyphen', () => {
      expect(accepts('-matt')).toBe(false);
    });

    it('rejects a trailing hyphen', () => {
      expect(accepts('matt-')).toBe(false);
    });

    it('rejects a single character (below the 2-character minimum)', () => {
      expect(accepts('a')).toBe(false);
    });

    it('rejects the empty string', () => {
      expect(accepts('')).toBe(false);
    });

    it('rejects 65 characters (above the 64-character maximum)', () => {
      expect(accepts('a'.repeat(65))).toBe(false);
    });

    it('rejects underscores', () => {
      expect(accepts('dj_matt')).toBe(false);
    });

    it('rejects dots — no slug may look like a file (e.g. ui.css)', () => {
      expect(accepts('ui.css')).toBe(false);
      expect(accepts('robots.txt')).toBe(false);
    });

    it('rejects a path separator — a slug is one segment', () => {
      expect(accepts('matt/admin')).toBe(false);
    });

    it('rejects whitespace', () => {
      expect(accepts('dj matt')).toBe(false);
      expect(accepts(' matt')).toBe(false);
    });

    it('rejects percent-encoding and other punctuation', () => {
      expect(accepts('matt%2f')).toBe(false);
      expect(accepts('matt?x=1')).toBe(false);
    });

    it('rejects non-string input', () => {
      expect(accepts(42)).toBe(false);
      expect(accepts(null)).toBe(false);
    });

    it('reports a length message, not the pattern message, for an over-long slug', () => {
      const result = slugSchema.safeParse('a'.repeat(200));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/64 characters or less/);
      }
    });
  });

  describe('reserved words — no slug may shadow a route', () => {
    it('reserves every top-level path segment src/router.ts dispatches on', () => {
      expect(ROUTE_SEGMENTS.length).toBeGreaterThan(0);
      for (const segment of ROUTE_SEGMENTS) {
        expect(
          RESERVED_SLUGS.has(segment),
          `route segment '/${segment}' is dispatched by router.ts but is not in RESERVED_SLUGS — a contributor could claim it`,
        ).toBe(true);
      }
    });

    it('reserves the vanity namespace itself', () => {
      expect(isReservedSlug('c')).toBe(true);
    });

    it('lists no stale route reservation (every ROUTE_RESERVED_SLUGS entry is a real route or the /c namespace)', () => {
      for (const reserved of ROUTE_RESERVED_SLUGS) {
        if (reserved === 'c') continue; // the vanity namespace this story adds
        expect(
          ROUTE_SEGMENTS.includes(reserved),
          `'${reserved}' is reserved as a route segment but router.ts no longer dispatches it`,
        ).toBe(true);
      }
    });

    it.each(ROUTE_SEGMENTS)("rejects the route segment '%s' as a slug", (segment) => {
      expect(accepts(segment)).toBe(false);
    });

    it.each([
      'api', 'auth', 'catalog', 'create', 'import', 'dashboard', 'stats',
      'dj', 'contributor', 'c', 'health', 'ui.css', 'ui-preview', 'spotify', 'lastfm',
    ])("rejects the reserved name '%s'", (name) => {
      expect(accepts(name)).toBe(false);
    });

    it('rejects a reserved name spelled with different case (the denylist is case-insensitive)', () => {
      expect(isReservedSlug('API')).toBe(true);
      expect(isReservedSlug('Admin')).toBe(true);
    });

    it('accepts a name that merely contains a reserved word', () => {
      expect(accepts('api-fan')).toBe(true);
      expect(accepts('the-dj')).toBe(true);
    });
  });

  describe('SLUG_RE / isClaimableSlug — the shape and claim predicates', () => {
    it('SLUG_RE matches a well-formed slug but not a reserved one (shape only, no denylist)', () => {
      expect(SLUG_RE.test('matt')).toBe(true);
      expect(SLUG_RE.test('api')).toBe(true);
    });

    it('isClaimableSlug applies both the shape rule and the denylist', () => {
      expect(isClaimableSlug('matt')).toBe(true);
      expect(isClaimableSlug('api')).toBe(false);
      expect(isClaimableSlug('-matt')).toBe(false);
    });

    it('SLUG_RE is anchored — a newline cannot smuggle a second line past it (regression)', () => {
      expect(SLUG_RE.test('matt\napi')).toBe(false);
      expect(SLUG_RE.test('matt\n')).toBe(false);
    });
  });
});
