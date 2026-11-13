// Layer 3, unit: the floor, the station merge, dates, pacing, the hour spread,
// programme slots, the four intents, the copied schedule's retirement and the
// page set.
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
  it("a demo event's codes hang under its own labels, else under its size's", () => {
    expect(C.placementLabelProblems(m)).toEqual([]);
  });
  it("the fixed sentences name the instance and list its own event kinds", async () => {
    expect(await C.instanceWordingProblems(m)).toEqual([]);
  });
  it('layout: a dial, a list or a grid of the same station links; no layout is the dial', async () => {
    expect(await C.layoutProblems(m)).toEqual([]);
  });
  it('station order: the file by default; by next event when asked, the quiet after the busy, Lead last', async () => {
    expect(await C.stationOrderProblems(m)).toEqual([]);
  });
  it('sections: each switch hides its own section and nothing else; sources always show', async () => {
    expect(await C.sectionProblems(m)).toEqual([]);
  });
  it('TV board: only when asked; events and codes, no counts; a hold, a pause and a readable dwell', async () => {
    expect(await C.tvProblems(m)).toEqual([]);
  });
  it('station partner: once, at the top, only where the creator file and OSE name the same campaign', async () => {
    expect(await C.partnerProblems(m)).toEqual([]);
  });
  it('calendar feed: linked only where OSE serves one, as a plain link, and never one that names the creator', async () => {
    expect(await C.calendarProblems(m)).toEqual([]);
  });
  it('dates read as day, short month, year', () => {
    expect(C.dateProblems(m)).toEqual([]);
  });
  it('publicReport keeps only what the page shows', () => {
    const r = C.seededReports().reports[0];
    expect(Object.keys(m.showcase.publicReport(r)).sort()).toEqual(['distinctScanners', 'images', 'placements', 'station', 'title']);
    expect(m.showcase.publicReport({ ...r, images: { card: '../../etc/passwd', desktop: 'img/x.jpg' } }).images).toBeNull();
  });
  it('a slot matches by cadence, day, week of the month and time, in its own timezone; On air reads from slot fields', () => {
    expect(C.slotProblems(m)).toEqual([]);
  });
  it('past, today and a pop-up window read correctly', () => {
    expect(C.timeProblems(m)).toEqual([]);
  });
  it('only a programme event stands under On air; frequency decides; a bad programme stops the build', async () => {
    expect(await C.intentProblems(m)).toEqual([]);
  });
  it('On air carries no OSE text, and every intent reads its own label', async () => {
    expect(await C.onAirTextProblems(m)).toEqual([]);
  });
  it("every programme event reads its slot's purpose as its Why", async () => {
    expect(await C.slotWhyProblems(m)).toEqual([]);
  });
  it("the creator page's When list runs soonest first, in the stations' order", async () => {
    expect(await C.dialOrderProblems(m)).toEqual([]);
  });
  it('a schedule row that is now an OSE event leaves the copied table', async () => {
    expect(await C.retireProblems(m)).toEqual([]);
  });
  it('one page per station plus the creator page, one <h1> each, 5W and How on every page', async () => {
    expect(await C.pageSetProblems(m)).toEqual([]);
  });
  it('the seed plan dates fall on their weekday, and a local time maps to its UTC instant across DST', () => {
    expect(m.plan.planDate({ weekday: 'thursday', weeks: 1 }, C.NOW, 'America/Chicago')).toBe('2026-11-19');
    expect(m.plan.planDate({ weekday: 'monday', weeks: 1 }, C.NOW, 'America/Chicago')).toBe('2026-11-23');
    expect(m.plan.planDate({ weekday: 'thursday', weeks: -1 }, C.NOW, 'America/Chicago')).toBe('2026-11-05');
    expect(m.plan.planDate({ days: -3 }, C.NOW)).toBe('2026-11-13');
    expect(m.plan.zonedInstant('2026-11-19', '18:00', 'America/Chicago')).toBe('2026-11-20T00:00:00Z');
    expect(m.plan.zonedInstant('2026-07-02', '18:00', 'America/Chicago')).toBe('2026-07-02T23:00:00Z');
  });
});
