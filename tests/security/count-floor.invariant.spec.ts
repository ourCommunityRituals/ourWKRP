/**
 * Architectural invariant (OW facet) — uniform_count_floor + honesty_lexicon (#27)
 *
 * OW facet of OSE's K-anon family (OSE-665/683/711) and the honesty lexicon.
 * The sponsor report is a PUBLIC endpoint publishing listener-derived counts;
 * before this lock it emitted exact COUNT(DISTINCT listener_id), an unfloored
 * hourly timeline, and per-DJ sub-K cohorts — the same class of defect OSE-711
 * blocked release over — under the banned field name "unique_listeners".
 *
 * L0 code-shape lock (mirrors cross-product-boundary.invariant.spec.ts). The
 * behavioural complement is tests/security/count-floor-routes.test.ts: a seeded
 * D1, the real handlers, a 0/1/4/5/6 sweep and a neighbour test per route.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

// Surfaces that publish listener-derived counts outward.
const COUNT_PUBLISHING_HANDLERS = ['handlers/sponsor.ts'];
// Every handler that publishes a count of people or of people's actions.
const ALL_COUNT_HANDLERS = ['handlers/sponsor.ts', 'handlers/events.ts', 'handlers/catalog.ts', 'handlers/dj.ts'];
// #27 honesty lexicon — schema-lexicon banned terms that name people, not signals.
const BANNED_COUNT_TERMS = [
  'unique_listeners',
  'attendance',
  'impressions',
  'reach',
  'turnout',
  'eyeballs',
];

describe('Invariant uniform_count_floor (OW facet) — listener counts are floored, honestly named', () => {
  it('the floor library exists with the uniform K and both enforcement shapes', () => {
    const lib = read('lib/count-floor.ts');
    expect(lib).toMatch(/export const COUNT_FLOOR = 5/);
    expect(lib).toMatch(/export function applyCountFloor/);
    expect(lib).toMatch(/export function dropSubFloorRows/);
    expect(lib).toMatch(/export function sumContributingBuckets/);
    expect(lib).toMatch(/export function floorTotalOfParts/);
    expect(lib).toMatch(/export function floorAcrossCuts/);
    expect(lib).toMatch(/export function withheldText/);
    // K is defined once: no other literal floor in the library.
    expect(lib.match(/= 5\b/g)).toHaveLength(1);
  });

  it('no handler publishes a count of the rows it left out (OW-212)', () => {
    for (const h of ALL_COUNT_HANDLERS) {
      expect(read(h), `${h} must not publish how many groups were under the floor`).not.toMatch(/below_floor|suppressed_rows/);
    }
  });

  it('every count-publishing handler routes through the floor', () => {
    for (const h of COUNT_PUBLISHING_HANDLERS) {
      const src = read(h);
      expect(src, `${h} must import the count floor`).toMatch(/from '\.\.\/lib\/count-floor'/);
      expect(src, `${h} must floor scalar counts`).toMatch(/applyCountFloor\s*\(/);
      expect(src, `${h} must drop sub-floor rows, never mark them`).toMatch(/dropSubFloorRows\s*\(/);
      expect(src, `${h} totals must sum surviving buckets (differencing-safe)`).toMatch(
        /sumContributingBuckets\s*\(/
      );
    }
  });

  it('no count-publishing handler speaks the banned lexicon (#27)', () => {
    for (const h of COUNT_PUBLISHING_HANDLERS) {
      const src = read(h);
      for (const term of BANNED_COUNT_TERMS) {
        // Word-boundary match: bans the term as a token ("reach"), not as a
        // fragment of honest English ("reaches the response").
        expect(
          new RegExp(`\\b${term}\\b`, 'i').test(src),
          `${h} must not use "${term}" — counts are named for what they compute, not the people they imply`
        ).toBe(false);
      }
    }
  });

  it('the report declares its floor so clients never hardcode K', () => {
    expect(read('handlers/sponsor.ts')).toMatch(/reporting_floor/);
  });
});
