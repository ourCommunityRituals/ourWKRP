// Layer 2, contract: creator files and the catalog against the schema, every
// station against the catalog, the renderer against the design system, and
// theme.css against the pinned @ocr/ui package.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { brandBlock } from '@ocr/ui/tokens';
import * as C from './checks.mjs';
import { realModules } from './modules.mjs';
import { themeCss } from '../lib/theme.mjs';

let m;
beforeAll(async () => {
  m = await realModules();
});

const ROOT = join(C.SHOWCASE, '..');
// Committed fixtures always; real creator files too when they exist locally
// (they are private and git-ignored, so CI sees only the fixtures).
const creatorFiles = () => [
  ...readdirSync(join(C.SHOWCASE, 'fixtures')).filter((f) => f.endsWith('-creator.json')).map((f) => join(C.SHOWCASE, 'fixtures', f)),
  ...(existsSync(join(C.SHOWCASE, 'creators'))
    ? readdirSync(join(C.SHOWCASE, 'creators')).filter((f) => f.endsWith('.json')).map((f) => join(C.SHOWCASE, 'creators', f))
    : []),
];

describe('creator showcase: contract', () => {
  it('the catalog matches its schema, and Spirit stays a future category', () => {
    const parsed = m.schema.catalogSchema.safeParse(C.catalog());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(C.catalog().categories.find((c) => c.id === 'spirit')?.status).toBe('future');
  });

  it('catalog ids and frequencies are unique', () => {
    const cats = C.catalog().categories;
    expect(new Set(cats.map((c) => c.id)).size).toBe(cats.length);
    expect(new Set(cats.map((c) => c.freq)).size).toBe(cats.length);
  });

  it.each(creatorFiles().map((f) => [f.slice(ROOT.length + 1), f]))('%s matches the schema and the catalog', (_label, file) => {
    const creator = JSON.parse(readFileSync(file, 'utf8'));
    expect(m.schema.creatorProblems(creator, C.catalog())).toEqual([]);
  });

  it('takes a version 1 file; refuses bad sources, places, categories, frequencies, intents, programmes and schedule links', () => {
    expect(C.contractProblems(m)).toEqual([]);
  });

  it('the where map: the stand-in draws what OSE staging answered, and the build takes that answer', () => {
    expect(C.mapContractProblems(m)).toEqual([]);
  });

  it('every committed JSON file in showcase/ parses', () => {
    const files = [join(C.SHOWCASE, 'categories.json'), join(C.SHOWCASE, 'fixtures', 'sample-ose-events.json'), join(C.SHOWCASE, 'fixtures', 'ose-map-areas.staging.json'), ...creatorFiles()];
    for (const f of files) expect(() => JSON.parse(readFileSync(f, 'utf8')), f).not.toThrow();
  });

  it('the renderer holds no colour value (colours come from @ocr/ui tokens)', () => {
    expect(C.hexProblems(readFileSync(join(C.SHOWCASE, 'lib', 'render.mjs'), 'utf8'))).toEqual([]);
  });

  it('theme.css is exactly what the pinned @ocr/ui package generates', () => {
    const tokensCss = readFileSync(join(ROOT, 'node_modules', '@ocr', 'ui', 'design-system', 'tokens.css'), 'utf8');
    const want = themeCss(tokensCss, brandBlock('ow'));
    const file = join(C.SHOWCASE, 'theme.css');
    if (process.env.UPDATE_THEME === '1') writeFileSync(file, want);
    expect(readFileSync(file, 'utf8'), 'theme.css drifted: regenerate it (see showcase/lib/theme.mjs)').toBe(want);
  });

  it('the page uses only tokens theme.css defines', () => {
    const defined = new Set(C.theme().match(/--[a-z][\w-]*(?=\s*:)/g));
    const page = readFileSync(join(C.SHOWCASE, 'lib', 'render.mjs'), 'utf8');
    const ownVars = new Set(page.match(/--[a-z][\w-]*(?=\s*:)/g));
    const used = [...new Set([...page.matchAll(/var\((--[a-z][\w-]*)\)/g)].map((x) => x[1]))];
    expect(used.filter((v) => !defined.has(v) && !ownVars.has(v))).toEqual([]);
  });
});
