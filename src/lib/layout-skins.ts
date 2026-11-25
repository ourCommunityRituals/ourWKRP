/**
 * Layout skins for ourWKRP pages: which parts a page has, the ready-made
 * skins, and the checks every arrangement must pass.
 *
 * One format with ourSharedEvents. A skin is a small Markdown file (see
 * lib/layout-skin-md.ts) with the same header keys OSE reads for its report
 * and vote screen: surface, skin, columns, order, wide. OSE names its own
 * surfaces (report, vote_screen); ourWKRP adds its own in the same shape.
 * Mirrors OSE workers/oursharedevents/src/lib/layout-skins.ts.
 *
 * The shared part is the abstraction, not the layouts (Matt, 2026-11-25):
 * each surface has its own catalogue of parts, each part required or
 * optional, and its own ready-made skins. Nothing is copied between surfaces.
 *
 * A skin arranges, nothing else:
 *   - order lists the parts that are shown, each at most once. Every required
 *     part must be in it; an optional part left out is hidden. Nothing can be
 *     added;
 *   - wide is a subset of order, used only when columns is 2; a phone always
 *     shows one column;
 *   - no colors, fonts, sizes, markup, links or counts. Colors and text sizes
 *     come from the design system (@ocr/ui tokens, which clear WCAG AA), so a
 *     skin cannot make a page hard to read, and a skin cannot show a count, so
 *     it cannot show one under the floor of 5 (lib/count-floor.ts).
 */

export const SKIN_FILE_MAX_BYTES = 8192;
export const CUSTOM_SKIN = 'custom';

export interface Layout {
  surface: string;
  skin: string;
  columns: 1 | 2;
  order: string[];
  wide: string[];
}

export interface SurfaceDef {
  /** Parts in their standard order. */
  parts: readonly string[];
  /** Parts every layout must show. The others are optional and may be hidden. */
  required: readonly string[];
  /** Plain names for the editor. */
  labels: Readonly<Record<string, string>>;
  /** Ready-made skins; the first is the default. */
  skins: Readonly<Record<string, Omit<Layout, 'surface' | 'skin'>>>;
}

/**
 * The public profile page (/contributor/:id and /c/:slug). The name and photo
 * header is fixed first and is not a part, like the title and date on OSE's
 * report. Music sections are not parts: music is off at launch (OW-224), and
 * when it comes back they keep their own place below the arranged parts.
 */
const PROFILE: SurfaceDef = {
  parts: ['stats', 'domains', 'voting', 'communities'],
  // Declared domains are the flag a person plants, and voting is what the
  // launch is for, so both always show. Numbers and communities may be hidden.
  required: ['domains', 'voting'],
  labels: {
    stats: 'Numbers',
    domains: 'Declared domains',
    voting: 'Voting',
    communities: 'Communities',
  },
  skins: {
    standard: { columns: 1, order: ['stats', 'domains', 'voting', 'communities'], wide: [] },
    domains_first: { columns: 1, order: ['domains', 'stats', 'voting', 'communities'], wide: [] },
    side_by_side: { columns: 2, order: ['stats', 'domains', 'communities', 'voting'], wide: ['stats'] },
  },
};

export const SURFACES: Readonly<Record<string, SurfaceDef>> = { profile: PROFILE };

/** The default layout of a surface: its first ready-made skin. */
export function defaultLayout(surface: string): Layout {
  const def = SURFACES[surface];
  const [skin, arrangement] = Object.entries(def.skins)[0];
  return { surface, skin, columns: arrangement.columns, order: [...arrangement.order], wide: [...arrangement.wide] };
}

/** The ready-made skin as a full layout, or null when there is no such skin. */
export function readyMadeLayout(surface: string, skin: string): Layout | null {
  const arrangement = SURFACES[surface]?.skins[skin];
  if (!arrangement) return null;
  return { surface, skin, columns: arrangement.columns, order: [...arrangement.order], wide: [...arrangement.wide] };
}

/**
 * Every problem with a layout, in plain words. Empty means it is fine.
 * The input is untyped on purpose: stored JSON comes back through here too.
 */
export function layoutProblems(input: unknown): string[] {
  if (!input || typeof input !== 'object') return ['The layout is missing.'];
  const l = input as Record<string, unknown>;
  const problems: string[] = [];

  const surface = typeof l.surface === 'string' ? l.surface : '';
  const def = SURFACES[surface];
  if (!def) {
    return [`"surface" must be one of: ${Object.keys(SURFACES).join(', ')}.`];
  }

  const skinNames = [...Object.keys(def.skins), CUSTOM_SKIN];
  if (typeof l.skin !== 'string' || !skinNames.includes(l.skin)) {
    problems.push(`"skin" must be one of: ${skinNames.join(', ')}.`);
  }

  if (l.columns !== 1 && l.columns !== 2) {
    problems.push('"columns" must be 1 or 2.');
  }

  const order = Array.isArray(l.order) ? l.order : null;
  if (!order || !order.every((p) => typeof p === 'string')) {
    problems.push('"order" must be a list of parts.');
  } else {
    const unknown = order.filter((p) => !def.parts.includes(p as string));
    if (unknown.length) problems.push(`"order" names parts this page does not have: ${unknown.join(', ')}.`);
    const repeated = order.filter((p, i) => order.indexOf(p) !== i);
    if (repeated.length) problems.push(`"order" lists a part more than once: ${[...new Set(repeated)].join(', ')}.`);
    const missing = def.required.filter((p) => !order.includes(p));
    if (missing.length) problems.push(`"order" must list every required part. Missing: ${missing.join(', ')}.`);
  }

  const wide = Array.isArray(l.wide) ? l.wide : null;
  if (!wide || !wide.every((p) => typeof p === 'string')) {
    problems.push('"wide" must be a list of parts (it may be empty).');
  } else {
    const unknown = wide.filter((p) => !def.parts.includes(p as string));
    if (unknown.length) problems.push(`"wide" names parts this page does not have: ${unknown.join(', ')}.`);
    const repeated = wide.filter((p, i) => wide.indexOf(p) !== i);
    if (repeated.length) problems.push(`"wide" lists a part more than once: ${[...new Set(repeated)].join(', ')}.`);
    if (order) {
      const notShown = wide.filter((p) => def.parts.includes(p as string) && !order.includes(p));
      if (notShown.length) problems.push(`"wide" names parts that are hidden: ${notShown.join(', ')}.`);
    }
  }

  // A ready-made name promises that arrangement. A changed arrangement is a
  // custom skin, so the name always says what the page will look like.
  if (problems.length === 0 && l.skin !== CUSTOM_SKIN) {
    const ready = readyMadeLayout(surface, l.skin as string)!;
    if (!sameArrangement(ready, l as unknown as Layout)) {
      problems.push(`This differs from the ${l.skin} skin; set skin to custom to keep these changes.`);
    }
  }

  return problems;
}

function sameArrangement(a: Layout, b: Layout): boolean {
  return a.columns === b.columns
    && a.order.join(',') === b.order.join(',')
    && [...a.wide].sort().join(',') === [...b.wide].sort().join(',');
}

/** A checked copy with only the five keys, or null when it has problems. */
export function cleanLayout(input: unknown): Layout | null {
  if (layoutProblems(input).length) return null;
  const l = input as Layout;
  return { surface: l.surface, skin: l.skin, columns: l.columns, order: [...l.order], wide: [...l.wide] };
}
