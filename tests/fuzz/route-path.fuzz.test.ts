/**
 * Property/fuzz tests — router path parsing.
 *
 * The request path is fully attacker-controlled. Invariants: extraction never
 * throws on arbitrary input, a returned UUID always matches the canonical
 * shape (no malformed id ever reaches a DB handler), and extractSegment is a
 * faithful inverse of prefix+segment+suffix concatenation.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractSegment, extractUuid, UUID_RE } from '../../src/lib/route-path';

const PREFIXES = ['/import/', '/api/contributors/', '/api/playlists/'];
const SUFFIXES = ['', '/brands', '/tracks', '/export'];

describe('route-path fuzzing', () => {
  it('extractSegment never throws and returns string|null for arbitrary input', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }),
        fc.constantFrom(...PREFIXES),
        fc.constantFrom(...SUFFIXES),
        (path, prefix, suffix) => {
          const r = extractSegment(path, prefix, suffix);
          expect(r === null || typeof r === 'string').toBe(true);
        },
      ),
    );
  });

  it('extractUuid never returns a non-UUID for any path', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }),
        fc.constantFrom(...PREFIXES),
        fc.constantFrom(...SUFFIXES),
        (path, prefix, suffix) => {
          const r = extractUuid(path, prefix, suffix);
          expect(r === null || UUID_RE.test(r)).toBe(true);
        },
      ),
    );
  });

  it('extractSegment round-trips prefix + segment + suffix', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PREFIXES),
        fc.string(),
        fc.constantFrom(...SUFFIXES),
        (prefix, segment, suffix) => {
          // Avoid the segment fabricating the suffix and stealing characters.
          fc.pre(suffix === '' || !segment.endsWith(suffix));
          const path = prefix + segment + suffix;
          expect(extractSegment(path, prefix, suffix)).toBe(segment);
        },
      ),
    );
  });

  it('a freshly-built UUID path always extracts back to that UUID', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.constantFrom(...PREFIXES), fc.constantFrom(...SUFFIXES), (id, prefix, suffix) => {
        expect(extractUuid(`${prefix}${id}${suffix}`, prefix, suffix)).toBe(id);
      }),
    );
  });
});
