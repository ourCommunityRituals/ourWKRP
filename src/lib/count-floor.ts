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

/** Apply the uniform floor to a single count. */
export function applyCountFloor(raw: number, floor: number = COUNT_FLOOR): FlooredCount {
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  if (n < floor) return { count: null, suppressed: true, floor };
  return { count: n, suppressed: false, floor };
}

/**
 * Drop sub-K rows from a bucket list (OSE-683/711 pattern) and report how many
 * were suppressed so the surface can say "N below the reporting floor" without
 * saying which.
 */
export function dropSubFloorRows<T>(
  rows: T[],
  countOf: (row: T) => number,
  floor: number = COUNT_FLOOR
): { rows: T[]; suppressed_rows: number; floor: number } {
  const kept = rows.filter((r) => countOf(r) >= floor);
  return { rows: kept, suppressed_rows: rows.length - kept.length, floor };
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
