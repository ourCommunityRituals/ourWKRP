// Layer 3, unit: the floor, the station merge, dates, pacing and the hour spread.
import { beforeAll, describe, expect, it } from 'vitest';
import * as C from './checks.mjs';
import { realModules } from './modules.mjs';

let m;
beforeAll(async () => {
  m = await realModules();
});

describe('creator showcase: unit', () => {
  it('floorText withholds every count under 5 and prints the rest', () => {
    expect(m.showcase.floorText(0)).toBe('Fewer than 5');
    expect(m.showcase.floorText(4)).toBe('Fewer than 5');
    expect(m.showcase.floorText(5)).toBe('5');
    expect(m.showcase.floorText(27)).toBe('27');
    expect(m.showcase.floorText(null)).toBe('Not yet counted');
  });
  it('each shape reports its scans less the hours under 5 (medium: 30 sent, 27 shown)', () => {
    expect(C.totalProblems(m)).toEqual([]);
  });
  it('the hour spread puts every scan in exactly one hour', () => {
    expect(C.bucketProblems(m)).toEqual([]);
  });
  it('the pacer never sends more than 50 scans a minute', async () => {
    expect(await C.pacingProblems(m)).toEqual([]);
  });
  it('stations take catalog defaults, the creator copy wins, and reports attach without their links', () => {
    expect(C.mergeProblems(m)).toEqual([]);
  });
  it('dates read as day, short month, year', () => {
    expect(C.dateProblems(m)).toEqual([]);
  });
  it('publicReport keeps only what the page shows', () => {
    const r = C.seededReports().reports[0];
    expect(Object.keys(m.showcase.publicReport(r)).sort()).toEqual(['distinctScanners', 'images', 'placements', 'station', 'title']);
    expect(m.showcase.publicReport({ ...r, images: { card: '../../etc/passwd', desktop: 'img/x.jpg' } }).images).toBeNull();
  });
});
