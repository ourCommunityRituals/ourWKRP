/**
 * The skin file: read and write the Markdown a person edits.
 *
 * Same format as ourSharedEvents (workers/oursharedevents/src/lib/layout-skin-md.ts):
 *
 *   ---
 *   surface: profile
 *   skin: custom
 *   columns: 2
 *   order: stats, domains, communities, voting
 *   wide: stats
 *   ---
 *   Plain notes. The system ignores them and does not store them.
 *
 * Header rules: only the keys surface, skin, columns, order and wide; each at
 * most once; lowercase `key: value` (any other key is refused, and its
 * message is picked without regard to case, so `Color:` is told why); blank lines and lines starting with # are
 * skipped; lists are comma separated, and [a, b] is read too. The whole file is
 * at most 8192 bytes. The arrangement is then checked by lib/layout-skins.ts.
 *
 * One file may hold several blocks, one per surface, so a client on both
 * ourSharedEvents and ourWKRP can keep one file for all their pages (see
 * parseSkinFile). A one-block file is the common case.
 */

import { CUSTOM_SKIN, SKIN_FILE_MAX_BYTES, SURFACES, layoutProblems, type Layout } from './layout-skins';

const KEYS = ['surface', 'skin', 'columns', 'order', 'wide'] as const;
const REQUIRED = ['surface', 'skin', 'columns', 'order'] as const;

/**
 * Keys people may reach for that a skin will never take, with the reason in
 * plain words. Any other unknown key gets the general answer.
 */
// Same patterns as ourSharedEvents (lib/layout-skins.ts notALayoutKey()),
// matched without regard to case, plus a few look words of ourWKRP's own.
const LOOK_KEYS = /colou?r|theme|font|size|hex|background|accent|palette|contrast|css|style/i;
const COUNT_KEYS = /count|votes?|floor|total|number/i;

export type SkinParse =
  | { ok: true; layout: Layout }
  | { ok: false; problems: string[] };

function readList(value: string): string[] {
  let v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** One header block: where it starts and ends (line indexes of its --- lines). */
interface Block { open: number; close: number; surface: string }

const SURFACE_LINE = /^surface\s*:\s*(.*)$/i;

/**
 * Find the header blocks. A block starts at a line "---" whose next non-blank
 * line is "surface: ...", and ends at the next "---". Anything else, a "---"
 * rule inside the notes included, is notes. (Same rule as ourSharedEvents.)
 */
function findBlocks(lines: string[]): { blocks: Block[]; unclosed: number | null } {
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '---') continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const m = lines[j]?.trim().match(SURFACE_LINE);
    if (!m) continue;
    const close = lines.findIndex((line, k) => k > i && line.trim() === '---');
    if (close === -1) return { blocks, unclosed: i };
    blocks.push({ open: i, close, surface: m[1].trim() });
    i = close;
  }
  return { blocks, unclosed: null };
}

/** Read the key: value lines of one block into a checked layout. */
function readBlock(lines: string[], block: Block): SkinParse {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (let n = block.open + 1; n < block.close; n++) {
    const at = `line ${n + 1}: `;
    const line = lines[n].trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (!m) {
      problems.push(`${at}this header line is not "key: value": ${line.slice(0, 60)}`);
      continue;
    }
    const [, key, value] = m;
    if (!(KEYS as readonly string[]).includes(key)) {
      if (LOOK_KEYS.test(key)) {
        problems.push(`${at}${key} is not taken: colors, fonts and sizes come from the design system, which keeps contrast readable.`);
      } else if (COUNT_KEYS.test(key)) {
        problems.push(`${at}${key} is not taken: a skin carries no numbers, and counts under 5 are never shown.`);
      } else {
        problems.push(`${at}${key} is not part of a layout. Use only: ${KEYS.join(', ')} (lowercase).`);
      }
      continue;
    }
    if (seen.has(key)) {
      problems.push(`${at}"${key}" is set more than once.`);
      continue;
    }
    seen.set(key, value.trim());
  }

  const where = `the ${block.surface} block (line ${block.open + 1})`;
  for (const key of REQUIRED) {
    if (!seen.has(key)) problems.push(`${where}: "${key}" is required.`);
  }
  if (problems.length) return { ok: false, problems };

  const columnsText = seen.get('columns')!;
  const layout = {
    surface: seen.get('surface')!,
    skin: seen.get('skin')!,
    columns: columnsText === '1' ? 1 : columnsText === '2' ? 2 : Number.NaN,
    order: readList(seen.get('order')!),
    wide: readList(seen.get('wide') ?? ''),
  };

  const checked = layoutProblems(layout);
  if (checked.length) return { ok: false, problems: checked.map((c) => `${where}: ${c}`) };
  return { ok: true, layout: layout as Layout };
}

export type SkinFileParse =
  | { ok: true; layouts: Record<string, Layout> }
  | { ok: false; problems: string[] };

/**
 * Read a skin file that may hold several blocks, one per surface, so a client
 * on both products can keep one file for all their pages. Blocks for surfaces
 * this product does not arrange (ourSharedEvents' report, vote_screen) are
 * skipped, not refused. Each surface may appear once.
 */
export function parseSkinFile(text: unknown): SkinFileParse {
  if (typeof text !== 'string') return { ok: false, problems: ['The skin file must be text.'] };
  if (new TextEncoder().encode(text).length > SKIN_FILE_MAX_BYTES) {
    return { ok: false, problems: [`The skin file must be at most ${SKIN_FILE_MAX_BYTES} bytes.`] };
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const { blocks, unclosed } = findBlocks(lines);
  if (unclosed !== null) {
    return { ok: false, problems: [`line ${unclosed + 1}: this header must end with a line of three dashes (---).`] };
  }

  const problems: string[] = [];
  const counted = new Map<string, number>();
  for (const b of blocks) counted.set(b.surface, (counted.get(b.surface) ?? 0) + 1);
  for (const [surface, n] of counted) {
    if (n > 1) problems.push(`The file names the ${surface} page ${n} times; name each page once.`);
  }
  if (problems.length) return { ok: false, problems };

  const known = blocks.filter((b) => Object.prototype.hasOwnProperty.call(SURFACES, b.surface));
  if (known.length === 0) {
    return { ok: false, problems: [`The file names no page this product arranges (here: ${Object.keys(SURFACES).join(', ')}).`] };
  }

  const layouts: Record<string, Layout> = {};
  for (const b of known) {
    const r = readBlock(lines, b);
    if (r.ok) layouts[b.surface] = r.layout;
    else problems.push(...r.problems);
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, layouts };
}

/** The one layout for a surface from a skin file (the API reads profile). */
export function parseSkinMarkdown(text: unknown, surface = 'profile'): SkinParse {
  const r = parseSkinFile(text);
  if (!r.ok) return r;
  const layout = r.layouts[surface];
  if (!layout) return { ok: false, problems: [`The file has no ${surface} block.`] };
  return { ok: true, layout };
}

/** The file for a layout, in the canonical form, with optional notes. */
export function writeSkinMarkdown(layout: Layout, notes = ''): string {
  const header = [
    '---',
    `surface: ${layout.surface}`,
    `skin: ${layout.skin}`,
    `columns: ${layout.columns}`,
    `order: ${layout.order.join(', ')}`,
    `wide: ${layout.wide.join(', ')}`.trimEnd(),
    '---',
  ].join('\n');
  const body = notes.trim();
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

export { CUSTOM_SKIN };
