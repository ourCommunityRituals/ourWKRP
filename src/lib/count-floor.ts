/**
 * Uniform count floor — OW facet of OSE's K-anon family (OSE-665/683/711).
 *
 * OW is the named pole for PRESENTERS (DJs, curators — attribution is the
 * product), but listeners are counts, never individuals. Any listener-derived
 * count that leaves the building (sponsor report, cross-product export) gets
 * the SAME uniform floor OSE applies, so no OW surface becomes the side
 * channel that leaks an exact small cohort OSE's surfaces suppress.
 *
 * Rules mirrored from OSE:
 *   - applyCountFloor (OSE-665): count < K → suppressed, exact value never
 *     reaches a client. Enforced server-side.
 *   - per-bucket drop (OSE-683/711): a row list (per-track, per-DJ, per-hour)
 *     DROPS sub-K rows entirely — a suppressed-but-present row still says
 *     "a small cohort was here", which is exactly the leak. Totals are the
 *     sum of SURVIVING buckets, so a published total can never be differenced
 *     against the row list the same reader sees.
 *
 * Rounding (owner ruling 2026-11-18, "rounding applies to the OW / OSE"; OSE's
 * OSE-2151): from the floor up, a published count of people or of their
 * actions is rounded DOWN to a multiple of 5 (`publishCount`), so two reads a
 * moment apart never show one person's action (12 then 13). `applyCountFloor`
 * stays exact: it is the gate. The wire formatters (`flooredFields`,
 * `countText`) and `floorTotalOfParts` round, and a published row's count goes
 * through `roundForPublish`.
 */

/** Uniform K. Mirrors OSE's CORRIDOR_MAP_MIN_COUNT; keep the two in step. */
export const COUNT_FLOOR = 5;

export interface FlooredCount {
  /** The exact count when >= floor; null when suppressed. */
  count: number | null;
  /** True when the true count is below the floor (0..floor-1). */
  suppressed: boolean;
  /** The floor applied (echoed so clients render "below N" without hardcoding). */
  floor: number;
}

/** Every published count is rounded down to a multiple of this (mirrors OSE's PUBLISH_ROUNDING). */
export const PUBLISH_ROUNDING = COUNT_FLOOR;

/** A count rounded down to a multiple of PUBLISH_ROUNDING (12 → 10). One argument, so it can go to `.map`. */
export function roundForPublish(n: number): number {
  const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return v - (v % PUBLISH_ROUNDING);
}

/**
 * The published form of a count: withheld under the floor exactly as
 * `applyCountFloor` withholds it, rounded down to a multiple of 5 from the
 * floor up. The gate is the exact value, so 5 to 9 publish as 5.
 */
export function publishCount(raw: number, floor: number = COUNT_FLOOR): FlooredCount {
  const floored = applyCountFloor(raw, floor);
  if (floored.count === null) return floored;
  return { ...floored, count: roundForPublish(floored.count) };
}

/** Apply the uniform floor to a single count (exact; the gate). */
export function applyCountFloor(raw: number, floor: number = COUNT_FLOOR): FlooredCount {
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  if (n < floor) return { count: null, suppressed: true, floor };
  return { count: n, suppressed: false, floor };
}

/**
 * Drop sub-K rows from a bucket list (OSE-683/711 pattern).
 *
 * It returns only the rows that clear the floor. It does not say how many rows
 * were dropped: that number is itself a count of small groups, and the rule is
 * that no count under the floor is published.
 */
export function dropSubFloorRows<T>(
  rows: T[],
  countOf: (row: T) => number,
  floor: number = COUNT_FLOOR
): { rows: T[]; floor: number } {
  return { rows: rows.filter((r) => countOf(r) >= floor), floor };
}

/** Sum of surviving buckets only — the differencing-safe total (OSE-683). */
export function sumContributingBuckets<T>(
  rows: T[],
  countOf: (row: T) => number,
  floor: number = COUNT_FLOOR
): number {
  return rows.reduce((sum, r) => {
    const n = countOf(r);
    return n >= floor ? sum + n : sum;
  }, 0);
}

/**
 * Floor a total published beside its parts (drop before sum, OSE-683; the same
 * rule as OSE's floorTotalOfParts).
 *
 * Each part is floored first and a part under the floor adds nothing; the sum
 * of the parts that cleared is then floored again. With parts 6 and 3 the total
 * is 6, never 9, so the total minus the listed parts cannot give back the 3.
 * Parts that are each under the floor never add up to a published total
 * (3 + 3 is withheld, not 6).
 */
export function floorTotalOfParts(
  parts: readonly (number | null | undefined)[],
  floor: number = COUNT_FLOOR
): FlooredCount {
  let sum = 0;
  // Each part is rounded as it is published, so the total agrees with the
  // parts listed beside it and is itself a multiple of 5 (7 and 8 → 5 + 5 = 10).
  for (const part of parts) sum += publishCount(part ?? 0, floor).count ?? 0;
  return publishCount(sum, floor);
}

/**
 * Keep only the rows that sit in a group of at least `floor` rows under EVERY
 * cut, after the rows that do not have been taken away.
 *
 * A report that publishes several cuts of the same rows (per DJ, per hour, per
 * track) cannot floor each cut on its own: a row dropped from one cut still
 * counts in another, so the per-hour sum minus the per-DJ sum would give back
 * the dropped DJ's count. So the rows are peeled until every group under every
 * cut holds `floor` rows or none, and every cut and every total is then built
 * from the rows that are left.
 *
 * What is left is the largest set of rows in which every group clears the
 * floor (the union of two such sets is another one, so there is one largest).
 * A row in a group under the floor can never be part of it, so adding,
 * removing or changing rows inside such a group leaves the result unchanged.
 */
export function floorAcrossCuts<T>(
  rows: readonly T[],
  cuts: ReadonlyArray<(row: T) => string>,
  floor: number = COUNT_FLOOR
): T[] {
  let kept = rows.slice();
  for (;;) {
    const sizes = cuts.map((key) => groupSizes(kept, key));
    const next = kept.filter((row) => cuts.every((key, i) => (sizes[i].get(key(row)) ?? 0) >= floor));
    if (next.length === kept.length) return next;
    kept = next;
  }
}

/** Number of rows per group key. */
export function groupSizes<T>(rows: readonly T[], key: (row: T) => string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    sizes.set(k, (sizes.get(k) ?? 0) + 1);
  }
  return sizes;
}

/**
 * The wire shape of one floored count: `{ <name>: n, <name>_suppressed: false }`
 * at or above the floor, `{ <name>: null, <name>_suppressed: true }` under it
 * (0 included). Every route uses this shape for a count of people or of
 * people's actions. The number is rounded down to a multiple of 5 here, at
 * the wire, whichever helper produced it (rounding twice changes nothing).
 */
export function flooredFields<N extends string>(
  name: N,
  value: FlooredCount
): Record<N, number | null> & Record<`${N}_suppressed`, boolean> {
  const count = value.suppressed || value.count === null ? null : roundForPublish(value.count);
  return { [name]: count, [`${name}_suppressed`]: count === null } as Record<N, number | null> &
    Record<`${N}_suppressed`, boolean>;
}

/** The words a withheld count reads as: "Fewer than 5". */
export function withheldText(floor: number = COUNT_FLOOR): string {
  return `Fewer than ${floor}`;
}

/**
 * Text for one published count. A withheld count, a missing value, or any
 * number under the floor reads in words ("Fewer than 5"); never 0, never
 * blank, never the true number. From the floor up it is rounded down to a
 * multiple of 5.
 */
export function countText(value: FlooredCount | number | null | undefined, floor: number = COUNT_FLOOR): string {
  const n = typeof value === 'object' && value !== null ? (value.suppressed ? null : value.count) : value;
  // roundForPublish reads NaN, Infinity and negatives as 0, so they are withheld too.
  const shown = roundForPublish(Number(n ?? 0));
  return shown < floor ? withheldText(floor) : String(shown);
}
