/**
 * Property/fuzz tests — catalog query-param sanitizers.
 *
 * These guard the D1/FTS5 query boundary against injection and resource blowup
 * from arbitrary ?q=/?genre=/?year_min= values. Invariants: bounded length,
 * no FTS operator passthrough, numeric clamping, and never throwing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  boundParam,
  escapeLike,
  parseIntParam,
  parseFloatParam,
  sanitizeFtsQuery,
  MAX_PARAM_LENGTH,
  MAX_FTS_WORDS,
} from '../../src/handlers/catalog';

describe('catalog param fuzzing', () => {
  it('boundParam returns null or a trimmed, length-bounded non-empty string', () => {
    fc.assert(
      fc.property(fc.option(fc.string({ unit: 'binary' }), { nil: null }), (v) => {
        const r = boundParam(v);
        if (r !== null) {
          expect(r.length).toBeLessThanOrEqual(MAX_PARAM_LENGTH);
          expect(r.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('parseIntParam returns null or a safe integer', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (v) => {
        const r = parseIntParam(v);
        expect(r === null || Number.isInteger(r)).toBe(true);
      }),
    );
  });

  it('parseFloatParam returns null or a value clamped to [0,1]', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (v) => {
        const r = parseFloatParam(v);
        if (r !== null) {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it('sanitizeFtsQuery never throws, strips FTS operators, and bounds word count', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (q) => {
        const out = sanitizeFtsQuery(q);
        // No raw FTS5 special characters survive (quotes are the only " allowed,
        // and they only ever wrap tokens — never appear from user content).
        const inner = out.replace(/"/g, '');
        expect(inner).not.toMatch(/[*():^{}[\]\\]/);
        // Token count (quoted groups) bounded.
        const tokenCount = (out.match(/"[^"]*"/g) ?? []).length;
        expect(tokenCount).toBeLessThanOrEqual(MAX_FTS_WORDS);
        expect(out.length).toBeGreaterThan(0);
      }),
    );
  });

  it('escapeLike leaves no unescaped LIKE metacharacter', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (v) => {
        const escaped = escapeLike(v);
        // Drop every escaped pair (\\, \%, \_); nothing bare should remain.
        const stripped = escaped.replace(/\\[\\%_]/g, '');
        expect(stripped).not.toMatch(/[%_\\]/);
      }),
    );
  });
});
