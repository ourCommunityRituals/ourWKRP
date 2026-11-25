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
 * most once; lowercase `key: value`; blank lines and lines starting with # are
 * skipped; lists are comma separated, and [a, b] is read too. The whole file is
 * at most 8192 bytes. The arrangement is then checked by lib/layout-skins.ts.
 */

import { CUSTOM_SKIN, SKIN_FILE_MAX_BYTES, layoutProblems, type Layout } from './layout-skins';

const KEYS = ['surface', 'skin', 'columns', 'order', 'wide'] as const;
const REQUIRED = ['surface', 'skin', 'columns', 'order'] as const;

/**
 * Keys people may reach for that a skin will never take, with the reason in
 * plain words. Any other unknown key gets the general answer.
 */
const LOOK_KEYS = /^(colou?rs?|background|bg|accent|theme|palette|font|fonts|font_size|text|text_size|size|contrast|css|style|styles)$/;
const COUNT_KEYS = /^(counts?|votes?|vote_counts?|totals?|floor|min_count|show_counts?|numbers)$/;

export type SkinParse =
  | { ok: true; layout: Layout }
  | { ok: false; problems: string[] };

function readList(value: string): string[] {
  let v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseSkinMarkdown(text: unknown): SkinParse {
  if (typeof text !== 'string') return { ok: false, problems: ['The skin file must be text.'] };
  if (new TextEncoder().encode(text).length > SKIN_FILE_MAX_BYTES) {
    return { ok: false, problems: [`The skin file must be at most ${SKIN_FILE_MAX_BYTES} bytes.`] };
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  if (lines[start]?.trim() !== '---') {
    return { ok: false, problems: ['The skin file must start with a line of three dashes (---).'] };
  }
  const end = lines.findIndex((line, i) => i > start && line.trim() === '---');
  if (end === -1) {
    return { ok: false, problems: ['The header must end with a second line of three dashes (---).'] };
  }

  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const raw of lines.slice(start + 1, end)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = line.match(/^([a-z_]+)\s*:\s*(.*)$/);
    if (!m) {
      problems.push(`This header line is not "key: value": ${line.slice(0, 60)}`);
      continue;
    }
    const [, key, value] = m;
    if (!(KEYS as readonly string[]).includes(key)) {
      if (LOOK_KEYS.test(key)) {
        problems.push(`"${key}" is not a skin setting. Skins arrange parts only: colors and text sizes come from the design system, so every page stays easy to read.`);
      } else if (COUNT_KEYS.test(key)) {
        problems.push(`"${key}" is not a skin setting. Skins never show counts, and a count under 5 is always withheld.`);
      } else {
        problems.push(`"${key}" is not a skin setting. Use only: ${KEYS.join(', ')}.`);
      }
      continue;
    }
    if (seen.has(key)) {
      problems.push(`"${key}" is set more than once.`);
      continue;
    }
    seen.set(key, value.trim());
  }

  for (const key of REQUIRED) {
    if (!seen.has(key)) problems.push(`"${key}" is required.`);
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
  if (checked.length) return { ok: false, problems: checked };
  return { ok: true, layout: layout as Layout };
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
