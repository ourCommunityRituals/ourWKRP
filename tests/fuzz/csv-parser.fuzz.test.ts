/**
 * Property/fuzz tests — CSV parser.
 *
 * CSV bytes are fully attacker-controlled at the import boundary. Invariants:
 * parsing never throws, and the hard structural caps (rows, fields, line
 * length) hold for any input — these are the DoS/OOM bounds OW-79..82 protect.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseCsv,
  parseCsvRows,
  MAX_ROWS,
  MAX_FIELDS_PER_ROW,
} from '../../src/import/csv-parser';

describe('CSV parser fuzzing', () => {
  it('parseCsv never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (csv) => {
        expect(() => parseCsv(csv)).not.toThrow();
      }),
    );
  });

  it('never exceeds row/field caps for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (csv) => {
        const rows = parseCsvRows(csv);
        expect(rows.length).toBeLessThanOrEqual(MAX_ROWS);
        for (const row of rows) {
          expect(row.length).toBeLessThanOrEqual(MAX_FIELDS_PER_ROW);
        }
      }),
    );
  });

  it('caps rows even under pathological row counts; truncated flag is consistent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_ROWS + 50 }), (n) => {
        const csv = Array.from({ length: n }, (_, i) => `a${i},b${i}`).join('\n');
        const { truncated } = parseCsv(csv);
        const rows = parseCsvRows(csv);
        expect(rows.length).toBeLessThanOrEqual(MAX_ROWS);
        expect(truncated).toBe(rows.length >= MAX_ROWS);
      }),
    );
  });

  it('tracks count never exceeds parsed data rows', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.string(), { maxLength: 8 }), { maxLength: 200 }),
        (cells) => {
          const csv = cells.map((r) => r.join(',')).join('\n');
          const { tracks } = parseCsv(csv);
          const rows = parseCsvRows(csv);
          expect(tracks.length).toBeLessThanOrEqual(Math.max(0, rows.length - 1));
        },
      ),
    );
  });
});
