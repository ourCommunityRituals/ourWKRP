/**
 * The skin file and its checks (lib/layout-skin-md.ts, lib/layout-skins.ts).
 *
 * The format is shared with ourSharedEvents (its lib/layout-skin-md.ts): a
 * header of surface, skin, columns, order and wide between two --- lines,
 * then free notes. These tests hold the rules the editor and the API rely on,
 * including the two guardrails: a skin cannot touch colors or text size (so it
 * cannot lower contrast), and a skin cannot show counts (so it cannot show one
 * under the floor of 5).
 */
import { describe, it, expect } from 'vitest';
import { parseSkinFile, parseSkinMarkdown, writeSkinMarkdown } from '../../src/lib/layout-skin-md';
import { SURFACES, defaultLayout, layoutProblems, readyMadeLayout, SKIN_FILE_MAX_BYTES } from '../../src/lib/layout-skins';

function file(header: string, notes = ''): string {
  return `---\n${header}\n---\n${notes}`;
}

const CUSTOM = 'surface: profile\nskin: custom\ncolumns: 2\norder: communities, stats, domains, voting\nwide: communities';

function problems(text: string): string[] {
  const r = parseSkinMarkdown(text);
  return r.ok ? [] : r.problems;
}

describe('reading a skin file', () => {
  it('reads every key of a custom skin', () => {
    const r = parseSkinMarkdown(file(CUSTOM, 'My notes.'));
    expect(r).toEqual({
      ok: true,
      layout: { surface: 'profile', skin: 'custom', columns: 2, order: ['communities', 'stats', 'domains', 'voting'], wide: ['communities'] },
    });
  });

  it('reads [a, b] lists, skips blank and # lines, and allows wide to be left out', () => {
    const r = parseSkinMarkdown(file('\nsurface: profile\n# my page\n\nskin: custom\ncolumns: 1\norder: [voting, stats, domains, communities]'));
    expect(r.ok && r.layout.order).toEqual(['voting', 'stats', 'domains', 'communities']);
    expect(r.ok && r.layout.wide).toEqual([]);
  });

  it('reads every ready-made skin, and the writer round-trips it', () => {
    for (const name of Object.keys(SURFACES.profile.skins)) {
      const layout = readyMadeLayout('profile', name)!;
      const r = parseSkinMarkdown(writeSkinMarkdown(layout, 'notes'));
      expect(r).toEqual({ ok: true, layout });
    }
  });

  it('writes the canonical form, and keeps notes only in the file', () => {
    expect(writeSkinMarkdown(defaultLayout('profile'))).toBe(
      '---\nsurface: profile\nskin: standard\ncolumns: 1\norder: stats, domains, voting, communities\nwide:\n---\n',
    );
    expect(writeSkinMarkdown(defaultLayout('profile'), '  hello  ')).toMatch(/---\nhello\n$/);
  });

  it('needs the two --- lines', () => {
    expect(problems('surface: profile')[0]).toMatch(/names no page this product arranges/);
    expect(problems('---\nsurface: profile\n')[0]).toMatch(/^line 1: this header must end with a line of three dashes/);
  });

  it('needs surface, skin, columns and order, each once', () => {
    expect(problems(file('surface: profile'))).toEqual([
      'the profile block (line 1): "skin" is required.',
      'the profile block (line 1): "columns" is required.',
      'the profile block (line 1): "order" is required.',
    ]);
    expect(problems(file(`${CUSTOM}\ncolumns: 1`))).toContain('line 7: "columns" is set more than once.');
  });

  it('takes columns of 1 or 2 only', () => {
    expect(problems(file(CUSTOM.replace('columns: 2', 'columns: 3')))).toContain('the profile block (line 1): "columns" must be 1 or 2.');
  });

  it('reads a header line full of spaces in linear time (CodeQL polynomial regex)', () => {
    const pad = ' '.repeat(8000);
    const t = Date.now();
    parseSkinFile(`---\nsurface:${pad}x\nA:${pad}x\n---\n`);
    expect(Date.now() - t).toBeLessThan(200);
  });

  it('refuses a file over 8192 bytes', () => {
    expect(problems(file(CUSTOM, 'x'.repeat(SKIN_FILE_MAX_BYTES)))[0]).toMatch(/at most 8192 bytes/);
  });

  it('refuses a surface it does not know', () => {
    expect(problems(file(CUSTOM.replace('surface: profile', 'surface: report')))[0]).toMatch(/names no page this product arranges \(here: profile\)/);
  });
});

describe('one file for every page of a client on both products', () => {
  const REPORT = '---\nsurface: report\nskin: side_by_side\ncolumns: 2\norder: map, stats\nwide: map\n---\nNotes for the report.\n---\nnot a block, just a rule in the notes\n';

  it('reads the profile block and skips blocks for ourSharedEvents pages', () => {
    const r = parseSkinFile(REPORT + file(CUSTOM, 'Notes.'));
    expect(r.ok && Object.keys(r.layouts)).toEqual(['profile']);
    expect(parseSkinMarkdown(REPORT + file(CUSTOM)).ok).toBe(true);
  });

  it('does not check blocks it skips, but does check its own, with line numbers', () => {
    const p = problems(REPORT.replace('wide: map', 'color: red') + file(`${CUSTOM}\nfont: big`));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^line 17: font is not taken/);
  });

  it('refuses a file that names the same page twice', () => {
    expect(problems(file(CUSTOM) + file(CUSTOM))[0]).toMatch(/names the profile page 2 times/);
  });

  it('refuses a file with no page this product arranges', () => {
    expect(problems(REPORT)[0]).toMatch(/names no page this product arranges/);
  });

  it('has standard and side_by_side, the names shared with every ourSharedEvents page', () => {
    expect(Object.keys(SURFACES.profile.skins)).toEqual(expect.arrayContaining(['standard', 'side_by_side']));
  });
});

describe('a skin arranges, nothing else', () => {
  it('must list every part, so nothing can be hidden', () => {
    expect(problems(file(CUSTOM.replace('order: communities, stats, domains, voting', 'order: stats, domains'))).join(' '))
      .toMatch(/Missing: voting, communities/);
  });

  it('cannot add a part or list one twice', () => {
    const p = problems(file(CUSTOM.replace('order: communities, stats, domains, voting', 'order: stats, stats, domains, voting, communities, html')));
    expect(p.join(' ')).toMatch(/does not have: html/);
    expect(p.join(' ')).toMatch(/more than once: stats/);
  });

  it('keeps wide to the parts of the page, each once', () => {
    expect(problems(file(CUSTOM.replace('wide: communities', 'wide: banner'))).join(' ')).toMatch(/"wide" names parts this page does not have: banner/);
    expect(problems(file(CUSTOM.replace('wide: communities', 'wide: stats, stats'))).join(' ')).toMatch(/"wide" lists a part more than once/);
  });

  it('holds a ready-made name to its arrangement', () => {
    const p = problems(file(CUSTOM.replace('skin: custom', 'skin: standard')));
    expect(p[0]).toMatch(/differs from the standard skin; set skin to custom to keep these changes/);
    expect(problems(file(CUSTOM.replace('skin: custom', 'skin: neon')))[0]).toMatch(/"skin" must be one of/);
  });

  it.each(['color', 'Color', 'colour', 'background', 'accent', 'theme', 'font', 'font_size', 'text_size', 'hex', 'contrast', 'css', 'style'])(
    'refuses "%s": colors and text size stay with the design system, so contrast holds',
    (key) => {
      const p = problems(file(`${CUSTOM}\n${key}: #ffff00`));
      expect(p).toHaveLength(1);
      expect(p[0]).toMatch(new RegExp(`^line 7: ${key} is not taken: colors, fonts and sizes come from the design system, which keeps contrast readable`));
    },
  );

  it.each(['count', 'Counts', 'votes', 'vote_counts', 'floor', 'min_count', 'show_counts', 'numbers', 'total'])(
    'refuses "%s": a skin never shows counts, so never one under 5',
    (key) => {
      const p = problems(file(`${CUSTOM}\n${key}: 1`));
      expect(p).toHaveLength(1);
      expect(p[0]).toMatch(new RegExp(`^line 7: ${key} is not taken: a skin carries no numbers, and counts under 5 are never shown`));
    },
  );

  it('refuses any other key, and lines that are not key: value', () => {
    expect(problems(file(`${CUSTOM}\nlink: https://example.com`))[0]).toMatch(/^line 7: link is not part of a layout. Use only: surface, skin, columns, order, wide/);
    expect(problems(file(`${CUSTOM}\n<script>alert(1)</script>`))[0]).toMatch(/^line 7: this header line is not "key: value"/);
    expect(problems(file(CUSTOM.replace('columns', 'Columns')))).toContain('the profile block (line 1): "columns" is required.');
  });
});

describe('checking stored layouts', () => {
  it('rejects anything that is not a layout object', () => {
    expect(layoutProblems(null)).toEqual(['The layout is missing.']);
    expect(layoutProblems({ surface: 'profile', skin: 'custom', columns: '2', order: 'stats', wide: null }).length).toBeGreaterThan(0);
  });

  it('passes every ready-made skin and the default', () => {
    expect(layoutProblems(defaultLayout('profile'))).toEqual([]);
    for (const name of Object.keys(SURFACES.profile.skins)) {
      expect(layoutProblems(readyMadeLayout('profile', name))).toEqual([]);
    }
  });

  it('has ready-made skins that each list every part', () => {
    for (const s of Object.values(SURFACES.profile.skins)) {
      expect([...s.order].sort()).toEqual([...SURFACES.profile.parts].sort());
    }
  });
});
