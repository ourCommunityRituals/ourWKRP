/**
 * Unit tests: lib/count-floor.ts, the under-5 floor every route uses.
 *
 * Born red: floorTotalOfParts, floorAcrossCuts, groupSizes, flooredFields,
 * withheldText and countText did not exist before OW-212 (import error), and
 * dropSubFloorRows returned `suppressed_rows`, a count of the groups under the
 * floor, which the last test here rejects.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  COUNT_FLOOR,
  applyCountFloor,
  countText,
  dropSubFloorRows,
  floorAcrossCuts,
  floorTotalOfParts,
  flooredFields,
  groupSizes,
  publishCount,
  roundForPublish,
  sumContributingBuckets,
  withheldText,
} from '../../src/lib/count-floor';

describe('COUNT_FLOOR', () => {
  it('is 5', () => {
    expect(COUNT_FLOOR).toBe(5);
  });
});

describe('applyCountFloor', () => {
  it.each([
    [0, null, true],
    [1, null, true],
    [4, null, true],
    [4.9, null, true],
    [5, 5, false],
    [6, 6, false],
    [42.7, 42, false],
    [-3, null, true],
    [Number.NaN, null, true],
    [Number.POSITIVE_INFINITY, null, true],
  ])('%s -> count %s, suppressed %s', (raw, count, suppressed) => {
    expect(applyCountFloor(raw)).toEqual({ count, suppressed, floor: COUNT_FLOOR });
  });

  it('takes another floor when given one', () => {
    expect(applyCountFloor(9, 10)).toEqual({ count: null, suppressed: true, floor: 10 });
    expect(applyCountFloor(10, 10)).toEqual({ count: 10, suppressed: false, floor: 10 });
  });
});

describe('dropSubFloorRows', () => {
  const rows = [{ n: 4 }, { n: 5 }, { n: 9 }, { n: 0 }];

  it('keeps rows at or above the floor, in order', () => {
    expect(dropSubFloorRows(rows, (r) => r.n).rows).toEqual([{ n: 5 }, { n: 9 }]);
  });

  it('says nothing about how many rows it dropped', () => {
    expect(dropSubFloorRows(rows, (r) => r.n)).toEqual({ rows: [{ n: 5 }, { n: 9 }], floor: COUNT_FLOOR });
    expect(Object.keys(dropSubFloorRows(rows, (r) => r.n)).sort()).toEqual(['floor', 'rows']);
  });
});

describe('sumContributingBuckets', () => {
  it('adds only the parts at or above the floor', () => {
    expect(sumContributingBuckets([6, 3, 5, 4], (n) => n)).toBe(11);
    expect(sumContributingBuckets([4, 4], (n) => n)).toBe(0);
  });
});

describe('floorTotalOfParts', () => {
  it('drops each part under the floor before it sums', () => {
    // Each surviving part is rounded down to a multiple of 5 as it is published.
    expect(floorTotalOfParts([6, 3])).toEqual({ count: 5, suppressed: false, floor: COUNT_FLOOR });
    expect(floorTotalOfParts([6, 5, 4])).toEqual({ count: 10, suppressed: false, floor: COUNT_FLOOR });
    expect(floorTotalOfParts([7, 8])).toEqual({ count: 10, suppressed: false, floor: COUNT_FLOOR });
  });

  it('withholds a total made only of small parts (3 + 3 is not 6)', () => {
    expect(floorTotalOfParts([3, 3])).toEqual({ count: null, suppressed: true, floor: COUNT_FLOOR });
  });

  it('withholds an empty total, and reads null and undefined as 0', () => {
    expect(floorTotalOfParts([])).toEqual({ count: null, suppressed: true, floor: COUNT_FLOOR });
    expect(floorTotalOfParts([null, undefined, 7])).toEqual({ count: 5, suppressed: false, floor: COUNT_FLOOR });
  });

  it('takes another floor when given one', () => {
    expect(floorTotalOfParts([9, 9], 10)).toEqual({ count: null, suppressed: true, floor: 10 });
    expect(floorTotalOfParts([10, 9], 10)).toEqual({ count: 10, suppressed: false, floor: 10 });
  });

  it('property: the total minus any subset of the published parts is never 1 to 4', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 6 }), (parts) => {
        const total = floorTotalOfParts(parts).count ?? 0;
        const published = parts.filter((p) => p >= COUNT_FLOOR).map(roundForPublish);
        let sums = [0];
        for (const p of published) sums = [...sums, ...sums.map((s) => s + p)];
        return sums.every((s) => {
          const gap = total - s;
          return gap === 0 || gap >= COUNT_FLOOR;
        });
      }),
    );
  });
});

describe('groupSizes', () => {
  it('counts rows per key', () => {
    const sizes = groupSizes(['a', 'b', 'a', 'a'], (r) => r);
    expect([...sizes]).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
  });
});

describe('floorAcrossCuts', () => {
  type Tap = { dj: string; hour: string; track: string };
  const cuts = [(r: Tap) => r.dj, (r: Tap) => r.hour, (r: Tap) => r.track];
  const many = (n: number, t: Tap): Tap[] => Array.from({ length: n }, () => ({ ...t }));

  it('keeps everything when every group clears the floor', () => {
    const rows = [...many(5, { dj: 'a', hour: 'h1', track: 't1' }), ...many(6, { dj: 'b', hour: 'h2', track: 't2' })];
    expect(floorAcrossCuts(rows, cuts)).toHaveLength(11);
  });

  it('drops a small DJ even when its hour and track are large', () => {
    const rows = [...many(10, { dj: 'a', hour: 'h1', track: 't1' }), ...many(3, { dj: 'x', hour: 'h1', track: 't1' })];
    const kept = floorAcrossCuts(rows, cuts);
    expect(kept).toHaveLength(10);
    expect(kept.every((r) => r.dj === 'a')).toBe(true);
  });

  it('peels again when a drop leaves another group under the floor', () => {
    // Hour h2 holds 2 taps of DJ a plus 3 of DJ x: 5 at first, 2 once x is gone.
    const rows = [
      ...many(10, { dj: 'a', hour: 'h1', track: 't1' }),
      ...many(2, { dj: 'a', hour: 'h2', track: 't1' }),
      ...many(3, { dj: 'x', hour: 'h2', track: 't1' }),
    ];
    const kept = floorAcrossCuts(rows, cuts);
    expect(kept).toHaveLength(10);
    expect(kept.every((r) => r.hour === 'h1')).toBe(true);
  });

  it('returns nothing when nothing clears, and handles no rows', () => {
    expect(floorAcrossCuts(many(4, { dj: 'a', hour: 'h1', track: 't1' }), cuts)).toEqual([]);
    expect(floorAcrossCuts([], cuts)).toEqual([]);
  });

  it('with no cuts keeps every row', () => {
    expect(floorAcrossCuts([1, 2, 3], [])).toEqual([1, 2, 3]);
  });

  it('takes another floor when given one', () => {
    const rows = many(7, { dj: 'a', hour: 'h1', track: 't1' });
    expect(floorAcrossCuts(rows, cuts, 8)).toEqual([]);
    expect(floorAcrossCuts(rows, cuts, 7)).toHaveLength(7);
  });

  const tapArb = fc.record({
    dj: fc.constantFrom('a', 'b', 'c'),
    hour: fc.constantFrom('h1', 'h2'),
    track: fc.constantFrom('t1', 't2', 't3'),
  });

  it('property: every group of what is kept holds at least the floor', () => {
    fc.assert(
      fc.property(fc.array(tapArb, { maxLength: 60 }), (rows) => {
        const kept = floorAcrossCuts(rows, cuts);
        return cuts.every((key) => [...groupSizes(kept, key).values()].every((n) => n >= COUNT_FLOOR));
      }),
    );
  });

  it('property: taps of a DJ with fewer than the floor change nothing that is kept', () => {
    fc.assert(
      fc.property(
        fc.array(tapArb, { maxLength: 60 }),
        fc.array(fc.record({ hour: fc.constantFrom('h1', 'h2'), track: fc.constantFrom('t1', 't2', 't3') }), {
          maxLength: COUNT_FLOOR - 1,
        }),
        (rows, small) => {
          const withSmall = [...rows, ...small.map((s) => ({ dj: 'x', ...s }))];
          return JSON.stringify(floorAcrossCuts(withSmall, cuts)) === JSON.stringify(floorAcrossCuts(rows, cuts));
        },
      ),
    );
  });
});

describe('publishCount and roundForPublish (owner ruling 2026-11-18)', () => {
  it.each([
    [0, null],
    [4, null],
    [5, 5],
    [9, 5],
    [10, 10],
    [12, 10],
    [101, 100],
  ])('%i publishes as %s', (raw, out) => {
    expect(publishCount(raw)).toEqual({ count: out, suppressed: out === null, floor: COUNT_FLOOR });
  });

  it('the gate stays exact: applyCountFloor still returns 12 for 12', () => {
    expect(applyCountFloor(12).count).toBe(12);
  });

  it('neighbours one apart inside a step of 5 read the same; a control crossing a step moves', () => {
    for (const n of [5, 6, 7, 8, 10, 11, 12, 13]) {
      expect(flooredFields('x', applyCountFloor(n + 1))).toEqual(flooredFields('x', applyCountFloor(n)));
      expect(countText(n + 1)).toBe(countText(n));
      expect(floorTotalOfParts([n + 1, 7])).toEqual(floorTotalOfParts([n, 7]));
    }
    expect(flooredFields('x', applyCountFloor(10))).not.toEqual(flooredFields('x', applyCountFloor(9)));
  });

  it('property: every published value is a multiple of 5', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 200 }), { maxLength: 6 }), (parts) => {
        const t = floorTotalOfParts(parts).count;
        return (t === null || t % 5 === 0) && parts.every((p) => (publishCount(p).count ?? 0) % 5 === 0);
      }),
    );
  });
});

describe('flooredFields', () => {
  it('writes the count and its _suppressed flag under one name', () => {
    // Rounded down to a multiple of 5 at the wire (owner ruling 2026-11-18).
    expect(flooredFields('dj_count', applyCountFloor(6))).toEqual({ dj_count: 5, dj_count_suppressed: false });
    expect(flooredFields('dj_count', applyCountFloor(14))).toEqual({ dj_count: 10, dj_count_suppressed: false });
    expect(flooredFields('dj_count', applyCountFloor(0))).toEqual({ dj_count: null, dj_count_suppressed: true });
    expect(flooredFields('dj_count', applyCountFloor(3))).toEqual({ dj_count: null, dj_count_suppressed: true });
  });
});

describe('withheldText and countText', () => {
  it('a withheld count reads "Fewer than 5"', () => {
    expect(withheldText()).toBe('Fewer than 5');
    expect(withheldText(10)).toBe('Fewer than 10');
  });

  it.each([
    [applyCountFloor(0), 'Fewer than 5'],
    [applyCountFloor(4), 'Fewer than 5'],
    [applyCountFloor(5), '5'],
    [applyCountFloor(1234), '1230'],
    [{ count: 9, suppressed: true, floor: 5 }, 'Fewer than 5'],
    [null, 'Fewer than 5'],
    [undefined, 'Fewer than 5'],
    [0, 'Fewer than 5'],
    [3, 'Fewer than 5'],
    [Number.NaN, 'Fewer than 5'],
    [5, '5'],
    [6.8, '5'],
    [12, '10'],
  ])('%j -> %s', (value, text) => {
    expect(countText(value as Parameters<typeof countText>[0])).toBe(text);
  });

  it('never renders 0, a blank, NaN or "null"', () => {
    for (const v of [0, null, undefined, Number.NaN, -1, applyCountFloor(0)]) {
      const text = countText(v as Parameters<typeof countText>[0]);
      expect(text).not.toMatch(/^0$|^$|NaN|null|undefined/);
    }
  });

  it('takes another floor when given one', () => {
    expect(countText(7, 10)).toBe('Fewer than 10');
    expect(countText(10, 10)).toBe('10');
  });
});
