// Born red, kept red: every showcase check must catch a planted fault. Each case
// copies lib/ into lib/.mutants/<name>, plants one fault, and runs the same
// check the layer tests run on the real code. A check that passes on its mutant
// cannot fail, so it counts as absent, and this test goes red.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import * as C from './checks.mjs';
import { clearMutants, mutantModules, MUTANTS, realModules } from './modules.mjs';
import { reportProblems } from './integration/check-reports.mjs';
import { oseVerdictProblems } from './integration/check-ose.mjs';
import { plan } from './fake-ose.mjs';

afterAll(clearMutants);

const R = 'render.mjs';
const S = 'showcase.mjs';
const B = 'build.mjs';
const SC = 'schema.mjs';
const SH = 'schedule.mjs';
const CO = 'codes.mjs';
const O = 'ose.mjs';

const MUTANTS_LIST = [
  // 0. Security
  ['escaping: an unescaped text field', 'escapingProblems', [{ file: R, from: '<p class="lede">${esc(c.lede)}</p>', to: '<p class="lede">${c.lede}</p>' }]],
  ['escaping: an unescaped attribute', 'escapingProblems', [{ file: R, from: 'aria-label="Open the full ${esc(s.name)} report"', to: 'aria-label="Open the full ${s.name} report"' }]],
  ['escaping: script data not guarded', 'escapingProblems', [{ file: R, from: /JSON\.stringify\(stationData\)\.replace\([^)]*\)/, to: 'JSON.stringify(stationData)' }]],
  ['escaping: an OSE event title unescaped', 'escapingProblems', [{ file: R, from: '<h3 id="ev-${i}">${esc(event.title)}</h3>', to: '<h3 id="ev-${i}">${event.title}</h3>' }]],
  ['escaping: an OSE code word unescaped', 'escapingProblems', [{ file: R, from: '<span class="word">${esc(code.word)}</span>', to: '<span class="word">${code.word}</span>' }]],
  ['link allowlist: any source scheme linked', 'linkProblems', [{ file: R, from: 'const href = safeHttpsUrl(s.url);', to: 'const href = s.url;' }]],
  ['link allowlist: any place scheme linked', 'linkProblems', [{ file: R, from: 'if (p.url && safeHttpsUrl(p.url)) return', to: 'if (p.url) return' }]],
  ['place links: a tracking parameter added', 'placeLinkProblems', [{ file: R, from: '<li><a href="${esc(p.url)}"', to: '<li><a href="${esc(p.url)}${p.url.includes(\'?\') ? \'&\' : \'?\'}utm_source=ourwkrp"' }]],
  ['image allowlist: any path kept', 'imagePathProblems', [{ file: S, from: "typeof p === 'string' && /^img\\/[a-z0-9-]+\\.(jpg|png)$/.test(p)", to: "typeof p === 'string'" }]],
  ['secrets: the report link ships', 'secretProblems', [{ file: S, from: 'return {\n    station: r.station,', to: 'return {\n    ...r,\n    station: r.station,' }]],
  ['secrets: link ships and the gate is off', 'secretProblems', [
    { file: S, from: 'return {\n    station: r.station,', to: 'return {\n    ...r,\n    station: r.station,' },
    { file: B, from: 'if (refused.length) throw', to: 'if (false) throw' },
  ]],
  ['publish gate: off', 'publishGateProblems', [{ file: B, from: 'if (refused.length) throw', to: 'if (false) throw' }]],
  ['publish gate: station pages unchecked', 'publishGateProblems', [{ file: B, from: '...Object.entries(pages).flatMap(', to: "...Object.entries({ 'index.html': pages['index.html'] }).flatMap(" }]],
  ['never who: the email detector is blind', 'publishGateProblems', [{ file: S, from: /\['email address', \/[^\n]*\/\],/, to: "['email address', /(?!)/]," }]],
  ['floor: counts under 5 printed', 'floorProblems', [{ file: S, from: 'n < FLOOR ?', to: 'n < 0 ?' }]],
  ['floor: the floor moved to 4', 'floorProblems', [{ file: S, from: 'export const FLOOR = 5;', to: 'export const FLOOR = 4;' }]],
  ['local only: a staging base accepted', 'localOnlyProblems', [{ file: S, from: /const LOCAL_BASE = [^\n]*;/, to: 'const LOCAL_BASE = /^https?:\\/\\/.+$/;' }]],
  ['read base: production accepted', 'readBaseProblems', [{ file: O, from: 'if (base === OSE_STAGING) return base;', to: 'if (/oursharedevents\\.com/.test(base)) return base;' }]],
  ['read only: a key sent to OSE', 'readOnlyProblems', [{ file: O, from: "headers: { Accept: 'application/json' }", to: "headers: { Accept: 'application/json', Authorization: 'Bearer planted-key-123' }" }]],
  ['neutral names: the check skipped', 'neutralNameProblems', [{ file: O, from: 'if (problems.length) throw new Error(`OSE text is not neutral', to: 'if (false) throw new Error(`OSE text is not neutral' }]],
  ['neutral names: code labels unchecked', 'neutralNameProblems', [{ file: O, from: 'for (const s of bundle.body.slots ?? []) problems.push(', to: 'for (const s of []) problems.push(' }]],
  ['neutral names: a 3-letter name skipped', 'neutralNameProblems', [{ file: O, from: 'if (s.length < 2) return;', to: 'if (s.length < 4) return;' }]],
  ['neutral names: her first name alone passes', 'neutralNameProblems', [{ file: O, from: '.split(/[^\\p{L}\\p{N}]+/u)) add(part, true);', to: '.split(/[^\\p{L}\\p{N}]+/u)) void part;' }]],
  ['neutral names: a name inside a longer word stops the build', 'neutralNameProblems', [{ file: O, from: '(word ? hasWord(hay, term) : hay.includes(term))', to: 'hay.includes(term)' }]],
  ['file first: OSE read before the creator file is checked', 'fileFirstProblems', [{ file: O, from: 'if (fileProblems.length) throw', to: 'if (false) throw' }]],
  ['lost codes: a failed bundle passes', 'lostCodeProblems', [{ file: O, from: 'if (bundle.status !== 200 || !bundle.body) {', to: 'if (false) {' }]],
  ['lost codes: an unknown placement passes', 'lostCodeProblems', [{ file: O, from: 'if (link.placement && bundle.body.deploymentId !== link.placement) {', to: 'if (false) {' }]],
  ['drop: another brand kept', 'dropProblems', [{ file: O, from: 'if (item.brand_id !== creator.oseBrand) {', to: 'if (false) {' }]],
  ['codes: any /s URL accepted', 'codeOriginProblems', [{ file: CO, from: "if (bad || !String(s.url).startsWith(`${origin}/s/`)) throw", to: 'if (false) throw' }]],
  ['codes: any placement URL accepted', 'codeOriginProblems', [{ file: CO, from: "if (bad || !url.startsWith(`${origin}/q/`)) throw", to: 'if (false) throw' }]],
  ['code gate: off', 'codeGateProblems', [{ file: B, from: 'if (bad) out.push(`${label}: code refused', to: 'if (false) out.push(`${label}: code refused' }]],
  ['code gate: a code in other markup passes unread', 'codeGateProblems', [{ file: B, from: 'if (qrs !== figures.length || urls !== figures.length) out.push(', to: 'if (false) out.push(' }]],
  ['forms: check-in and register kept', 'formCodeProblems', [{ file: CO, from: "export const FORM_KINDS = new Set(['checkin', 'register']);", to: 'export const FORM_KINDS = new Set([]);' }]],
  ['forms: the placement code keeps its form query', 'formCodeProblems', [{ file: CO, from: 'return `${u.origin}${u.pathname}`;', to: 'return String(l);' }]],
  ['QR: drawn from another URL', 'qrMatchProblems', [{ file: CO, from: 'const { d, dim } = qrPath(url);', to: 'const { d, dim } = qrPath(`${url}x`);' }]],
  ['QR gate: off', 'qrGateProblems', [{ file: B, from: 'if (!bad && d !== qrPath(raw).d)', to: 'if (false)' }]],
  ['past: a past event shown with its codes', 'pastCodeProblems', [{ file: SH, from: "return last < todayIn(now, ev.timezone || 'UTC');", to: 'return false;' }]],
  ['CSP: an inline handler', 'cspProblems', [{ file: R, from: '<a class="ch" href=', to: '<a class="ch" onclick="void 0" href=' }]],
  // 2. Contract
  ['contract: non-https sources allowed', 'contractProblems', [{ file: SC, from: 'url: https,', to: 'url: text,' }]],
  ['contract: future categories open', 'contractProblems', [{ file: SC, from: "else if (cat.status === 'future')", to: 'else if (false)' }]],
  ['contract: unknown fields allowed', 'contractProblems', [{ file: SC, from: '      .optional(),\n  })\n  .strict();', to: '      .optional(),\n  });' }]],
  ['contract: a version 1 place refused', 'contractProblems', [{ file: SC, from: 'z.tuple([text, text]),', to: 'z.tuple([text, text, text]),' }]],
  ['contract: frequency not checked', 'contractProblems', [{ file: SC, from: 'if (!ids.has(e.frequency)) problems.push(', to: 'if (false) problems.push(' }]],
  ['contract: why not required', 'contractProblems', [{ file: SC, from: '&& !s.why) {', to: '&& false) {' }]],
  ['contract: a pop-up window not required', 'contractProblems', [{ file: SC, from: "if (e.intent === 'pop-up' && !e.until)", to: 'if (false)' }]],
  ['contract: slot kinds not checked', 'contractProblems', [{ file: SC, from: 'if (cat && !cat.eventKinds.includes(s.kind))', to: 'if (false)' }]],
  // 3. Unit
  ['unit: totals ignore an hour of exactly 5', 'totalProblems', [{ file: S, from: 'filter((n) => n >= FLOOR)', to: 'filter((n) => n > FLOOR)' }]],
  ['unit: hours all get the first count', 'bucketProblems', [{ file: S, from: 'n: shape.counts[i]', to: 'n: shape.counts[0]' }]],
  ['unit: the pacer never waits', 'pacingProblems', [{ file: S, from: 'if (stamps.length >= perMinute) {', to: 'if (false) {' }]],
  ['unit: the catalog overrides the creator', 'mergeProblems', [{ file: S, from: 'freq: s.freq ?? cat.freq,', to: 'freq: cat.freq,' }]],
  ['unit: dates in the wrong order', 'dateProblems', [{ file: S, from: "toLocaleDateString('en-GB'", to: "toLocaleDateString('en-US'" }]],
  ['slots: the week of the month off by one', 'slotProblems', [{ file: SH, from: 'Math.floor((day - 1) / 7)', to: 'Math.floor(day / 7)' }]],
  ['slots: times read in UTC', 'slotProblems', [{ file: SH, from: "const when = eventWhen(ev, slot.timezone || ev.timezone || 'UTC');", to: "const when = eventWhen(ev, 'UTC');" }]],
  ['slots: midnight reads 0 am', 'slotProblems', [{ file: SH, from: 'h % 12 === 0 ? 12 : h % 12', to: 'h % 12' }]],
  ['time: today reads as past', 'timeProblems', [{ file: SH, from: 'return last < todayIn(', to: 'return last <= todayIn(' }]],
  ['intents: a trial under On air', 'intentProblems', [{ file: SH, from: "link.intent === 'programme' && slotMatches(slot, event)", to: 'slotMatches(slot, event)' }]],
  ['intents: a programme off its slots accepted', 'intentProblems', [{ file: SH, from: 'if (!own.length) problems.push(', to: 'if (false) problems.push(' }]],
  ['intents: a mode unlike its slot accepted', 'intentProblems', [{ file: SH, from: 'if (s.mode !== event.attendanceMode) problems.push(', to: 'if (false) problems.push(' }]],
  ['frequency: every event on every station', 'intentProblems', [{ file: SH, from: 'isLead || link.frequency === station.id', to: 'true' }]],
  ['order: latest first', 'intentProblems', [{ file: SH, from: '(a, b) => sortKey(a.event).localeCompare(sortKey(b.event));', to: '(a, b) => sortKey(b.event).localeCompare(sortKey(a.event));' }]],
  ['past: a moved programme blocks the build on past events', 'intentProblems', [{ file: SH, from: 'for (const { link, event } of upcoming) {', to: 'for (const { link, event } of mine) {' }]],
  ['why: only the next programme event reads its slot purpose', 'slotWhyProblems', [{ file: R, from: 'const slot = byId[link.frequency] ? slotOf(', to: 'const slot = i === 0 && byId[link.frequency] ? slotOf(' }]],
  ['order: the dial sorts date-only events by bare date', 'dialOrderProblems', [{ file: R, from: '    .sort(soonestFirst)\n    .slice(0, 5);', to: '    .sort((a, b) => String(a.event.startsAt || a.event.startDate).localeCompare(String(b.event.startsAt || b.event.startDate)))\n    .slice(0, 5);' }]],
  ['On air: an OSE title in it', 'onAirTextProblems', [{ file: R, from: '`Next: ${esc(whenText(o.next.event, o.next.link))}`', to: '`Next: ${esc(o.next.event.title)}`' }]],
  ['S5: linked rows kept in the copied table', 'retireProblems', [{ file: R, from: '.filter((r) => r.length < 5)', to: '.filter(() => true)' }]],
  ['pages: a station page loses its <h1>', 'pageSetProblems', [{ file: R, from: '<h1>${esc(s.title)}</h1>', to: '<h2>${esc(s.title)}</h2>' }]],
];

describe('creator showcase: born red', () => {
  it.each(MUTANTS_LIST)('%s is caught by %s', async (name, check, edits) => {
    const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const m = await mutantModules(slug, edits);
    const problems = await C[check](m);
    expect(problems.length, `${check} passed on the mutant "${name}"`).toBeGreaterThan(0);
  });

  it('design system: a colour value in the renderer is caught', async () => {
    await mutantModules('hex', [{ file: R, from: '.dial .needle { stroke: var(--live);', to: '.dial .needle { stroke: #FF4136;' }]);
    expect(C.hexProblems(readFileSync(join(MUTANTS, 'hex', R), 'utf8')).length).toBeGreaterThan(0);
  });

  it('integration verdict: a total that skipped the floor is caught', () => {
    const creator = C.sample();
    const good = C.seededReports();
    good.reports[1].distinctScanners = 19;
    expect(reportProblems(creator, good)).toEqual([]);
    const unfloored = structuredClone(good);
    unfloored.reports[0].distinctScanners = 30;
    expect(reportProblems(creator, unfloored).join('\n')).toMatch(/teach: report total 30, expected 27/);
    const lost = structuredClone(good);
    lost.reports[1].scansSent = 18;
    expect(reportProblems(creator, lost).join('\n')).toMatch(/wear: 18 of 21 scans counted/);
    const named = structuredClone(good);
    named.reports[0].pageText = 'Checked in: planted.person@example.com';
    expect(reportProblems(creator, named).join('\n')).toMatch(/email address/);
  });

  it('integration verdict (OSE): a lost card, an extra event, a dead code and a form target are each caught', async () => {
    const m = await realModules();
    const pages = await C.samplePages(m);
    const urls = [...new Set(Object.values(pages).flatMap((h) => [...h.matchAll(/data-code-url="([^"]*)"/g)].map((x) => x[1])))];
    const resolved = urls.map((url) => ({ url, status: 302, location: `${C.FAKE_ORIGIN}/events/evt_sample-0001` }));
    expect(oseVerdictProblems(plan(), C.sample(), pages, resolved, C.NOW)).toEqual([]);
    const lostCard = { ...pages, 'teach/index.html': pages['teach/index.html'].replace('<article class="event"', '<article class="gone"') };
    expect(oseVerdictProblems(plan(), C.sample(), lostCard, resolved, C.NOW).join('\n')).toMatch(/teach: 2 event cards, want 3/);
    const draftShown = { ...pages, 'teach/index.html': `${pages['teach/index.html']}<h3>Draft class (showcase demo)</h3>` };
    expect(oseVerdictProblems(plan(), C.sample(), draftShown, resolved, C.NOW).join('\n')).toMatch(/evt_sample-0007: "Draft class/);
    const dead = resolved.map((r, i) => (i === 0 ? { ...r, status: 404 } : r));
    expect(oseVerdictProblems(plan(), C.sample(), pages, dead, C.NOW).join('\n')).toMatch(/answered 404/);
    const toForm = resolved.map((r, i) => (i === 1 ? { ...r, location: `${C.FAKE_ORIGIN}/events/evt_x/forms/checkin` } : r));
    expect(oseVerdictProblems(plan(), C.sample(), pages, toForm, C.NOW).join('\n')).toMatch(/not to the event/);
  });

  it('lint: an undefined name in a showcase script is an error', async () => {
    const eslint = new ESLint({ cwd: join(C.SHOWCASE, '..') });
    const [clean] = await eslint.lintText("import { esc } from './showcase.mjs';\nconsole.log(esc('a'));\n", { filePath: join(C.SHOWCASE, 'lib', 'planted.mjs') });
    expect(clean.errorCount, JSON.stringify(clean.messages)).toBe(0);
    const [planted] = await eslint.lintText('console.log(notDefinedAnywhere);\n', { filePath: join(C.SHOWCASE, 'lib', 'planted.mjs') });
    expect(planted.errorCount).toBeGreaterThan(0);
  });
});
