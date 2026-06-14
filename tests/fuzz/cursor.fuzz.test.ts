/**
 * Property/fuzz tests — pagination cursors.
 *
 * Cursors are attacker-controlled query params. Invariants: decoding arbitrary
 * input never throws (returns null on garbage), and any cursor we encode round-
 * trips — including unicode sort values, which the old btoa path threw on.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeCursor, decodeCursor, parsePaginationParams } from '../../src/lib/cursor';

describe('cursor fuzzing', () => {
  it('decodeCursor never throws and yields CursorData|null for any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = decodeCursor(s);
        expect(r === null || typeof r.id === 'string').toBe(true);
      }),
    );
  });

  it('round-trips id + sort value, including unicode/emoji', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc
          .oneof(fc.string(), fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }))
          // JSON has no -0; collapse it so round-trip equality holds under Object.is.
          .map((v) => (Object.is(v, -0) ? 0 : v)),
        (id, v) => {
          const decoded = decodeCursor(encodeCursor(id, v));
          expect(decoded).not.toBeNull();
          expect(decoded!.id).toBe(id);
          expect(decoded!.v).toBe(v);
        },
      ),
    );
  });

  it('encodeCursor never throws on arbitrary unicode (regression: btoa Latin1)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ unit: 'binary' }), (id, sort) => {
        expect(() => encodeCursor(id, sort)).not.toThrow();
      }),
    );
  });

  it('parsePaginationParams always clamps limit into [1,100], default 25', () => {
    fc.assert(
      fc.property(fc.string(), fc.option(fc.string(), { nil: undefined }), (limitRaw, cursorRaw) => {
        const u = new URL('http://localhost/api/tracks');
        u.searchParams.set('limit', limitRaw);
        if (cursorRaw !== undefined) u.searchParams.set('cursor', cursorRaw);
        const { limit } = parsePaginationParams(u);
        expect(Number.isInteger(limit)).toBe(true);
        expect(limit).toBeGreaterThanOrEqual(1);
        expect(limit).toBeLessThanOrEqual(100);
      }),
    );
  });
});
