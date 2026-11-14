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
const M = 'map.mjs';

const MUTANTS_LIST = [
  // 0. Security
  ['escaping: an unescaped text field', 'escapingProblems', [{ file: R, from: '<p class="lede">${esc(c.lede)}</p>', to: '<p class="lede">${c.lede}</p>' }]],
  ['escaping: an unescaped attribute', 'escapingProblems', [{ file: R, from: 'aria-label="Open the full ${esc(s.name)} report"', to: 'aria-label="Open the full ${s.name} report"' }]],
  ['escaping: script data not guarded', 'escapingProblems', [{ file: R, from: /JSON\.stringify\(stationData\)\.replace\([^)]*\)/, to: 'JSON.stringify(stationData)' }]],
  ['escaping: an OSE event title unescaped', 'escapingProblems', [{ file: R, from: '<h3 id="ev-${i}">${esc(event.title)}</h3>', to: '<h3 id="ev-${i}">${event.title}</h3>' }]],
  ['escaping: an event kind unescaped', 'escapingProblems', [{ file: R, from: "for this week's ${esc(orList(kinds))}.", to: "for this week's ${orList(kinds)}." }]],
  ['escaping: a station title unescaped on the TV board', 'escapingProblems', [{ file: R, from: '<h2 id="tv-${i}">${esc(s.title)}</h2>', to: '<h2 id="tv-${i}">${s.title}</h2>' }]],
  ['escaping: a card title unescaped in the list and grid layouts', 'escapingProblems', [{ file: R, from: '<span class="t">${esc(s.title)}</span>', to: '<span class="t">${s.title}</span>' }]],
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
  ["read only: a key sent to OSE", 'readOnlyProblems', [{ file: O, from: "const res = await f(`${origin}${path}`, { method: 'GET', headers: { Accept: 'application/json' }", to: "const res = await f(`${origin}${path}`, { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer planted-key-123' }" }]],
  ["read only: a key sent with the map read", 'readOnlyProblems', [{ file: O, from: "headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', signal:", to: "headers: { Accept: 'application/json', Authorization: 'Bearer planted-key-123' }, redirect: 'error', credentials: 'omit', signal:" }]],
  ["read only: a coordinate sent with the map read", 'readOnlyProblems', [{ file: M, from: "&around=1`;", to: "&around=1&lat=39.78`;" }]],
  ["read only: the map never read", 'readOnlyProblems', [{ file: O, from: "const { maps, mapsMissed } = await readMaps({ origin, lists: mapLists(creator, linked, now), fetch: f, paced, sleep, clock });", to: "const { maps, mapsMissed } = { maps: {}, mapsMissed: [] };" }]],
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
  ['menu: an unknown layout accepted', 'contractProblems', [{ file: SC, from: 'layout: z.enum(LAYOUTS).optional(),', to: 'layout: z.string().optional(),' }]],
  ['menu: an unknown station order accepted', 'contractProblems', [{ file: SC, from: 'stationOrder: z.enum(STATION_ORDERS).optional(),', to: 'stationOrder: z.string().optional(),' }]],
  ['menu: an unknown display accepted', 'contractProblems', [{ file: SC, from: 'display: z.enum(DISPLAYS).optional(),', to: 'display: z.string().optional(),' }]],
  ['menu: an unknown section accepted', 'contractProblems', [{ file: SC, from: '[k, z.boolean().optional()]))).strict().optional(),', to: '[k, z.boolean().optional()]))).passthrough().optional(),' }]],
  ['menu: a section switch of any type accepted', 'contractProblems', [{ file: SC, from: '[k, z.boolean().optional()]))).strict().optional(),', to: '[k, z.any().optional()]))).strict().optional(),' }]],
  ['menu: sources can be hidden', 'contractProblems', [{ file: SC, from: 'if (creator.sections?.sources === false && creator.sources.length) problems.push(', to: 'if (false) problems.push(' }]],
  ['contract: any number of placement labels accepted', 'contractProblems', [{ file: SC, from: "placements: z.array(z.string().trim().min(1).max(40)).min(1).max(4).optional(),", to: "placements: z.array(z.string().trim().min(1).max(40)).optional()," }]],
  ['contract: a blank or endless placement label accepted', 'contractProblems', [{ file: SC, from: "placements: z.array(z.string().trim().min(1).max(40)).min(1).max(4).optional(),", to: "placements: z.array(z.string()).min(1).max(4).optional()," }]],
  ['contract: non-https sources allowed', 'contractProblems', [{ file: SC, from: 'url: https,', to: 'url: text,' }]],
  ['contract: future categories open', 'contractProblems', [{ file: SC, from: "else if (cat.status === 'future')", to: 'else if (false)' }]],
  ['contract: unknown fields allowed', 'contractProblems', [{ file: SC, from: '      .optional(),\n  })\n  .strict();', to: '      .optional(),\n  });' }]],
  ['contract: a version 1 place refused', 'contractProblems', [{ file: SC, from: 'z.tuple([text, text]),', to: 'z.tuple([text, text, text]),' }]],
  ['contract: frequency not checked', 'contractProblems', [{ file: SC, from: 'if (!ids.has(e.frequency)) problems.push(', to: 'if (false) problems.push(' }]],
  ['contract: why not required', 'contractProblems', [{ file: SC, from: '&& !s.why) {', to: '&& false) {' }]],
  ['contract: a pop-up window not required', 'contractProblems', [{ file: SC, from: "if (e.intent === 'pop-up' && !e.until)", to: 'if (false)' }]],
  ['contract: slot kinds not checked', 'contractProblems', [{ file: SC, from: 'if (cat && !cat.eventKinds.includes(s.kind))', to: 'if (false)' }]],
  // 3. Unit
  ['layout: a list still draws the dial', 'layoutProblems', [{ file: R, from: "const dial = layout === 'dial';", to: 'const dial = true;' }]],
  ['layout: a card loses its title', 'layoutProblems', [{ file: R, from: '${dial ? \'\' : `<span class="t">${esc(s.title)}</span>`}', to: '' }]],
  ['layout: station pages ignore the layout', 'layoutProblems', [{ file: R, from: "${tuner(c, stations, s, '../', opt.layout)}", to: "${tuner(c, stations, s, '../')}" }]],
  ['layout: the default is not the dial', 'layoutProblems', [{ file: R, from: "layout: c.layout ?? 'dial',", to: "layout: c.layout ?? 'grid'," }]],
  ['station order: next-event ignored', 'stationOrderProblems', [{ file: R, from: "opt.stationOrder === 'next-event' ? byNextEvent(stations, schedules) : stations", to: 'stations' }]],
  ['station order: Lead not last', 'stationOrderProblems', [{ file: R, from: '(isLeadStation(s) ? 2 :', to: '(isLeadStation(s) ? 0 :' }]],
  ['station order: the quiet before the busy', 'stationOrderProblems', [{ file: R, from: 'schedules[s.id].upcoming.length ? 0 : 1', to: 'schedules[s.id].upcoming.length ? 1 : 0' }]],
  ['station order: by next event when nobody asked', 'stationOrderProblems', [{ file: R, from: "stationOrder: c.stationOrder ?? 'file',", to: "stationOrder: c.stationOrder ?? 'next-event'," }]],
  ['sections: scatter cannot be hidden', 'sectionProblems', [{ file: R, from: '${opt.show.scatter ? `<section aria-labelledby="scatter-title"', to: '${true ? `<section aria-labelledby="scatter-title"' }]],
  ['sections: values cannot be hidden', 'sectionProblems', [{ file: R, from: '${opt.show.values ? `<p>${esc(c.values.body)}</p>` : \'\'}', to: '<p>${esc(c.values.body)}</p>' }]],
  ['sections: a station still shows its report', 'sectionProblems', [{ file: R, from: "${opt.show.reports ? reportFigure(s, '../') : ''}", to: "${reportFigure(s, '../')}" }]],
  ['sections: the copied schedule cannot be hidden', 'sectionProblems', [{ file: R, from: 'opt.show.schedule && c.schedule && copiedRows.length', to: 'c.schedule && copiedRows.length' }]],
  ['sections: an empty reporting section shows', 'sectionProblems', [{ file: R, from: '${opt.show.values || opt.show.reports ? `<section aria-labelledby="reports-title">', to: '${true ? `<section aria-labelledby="reports-title">' }]],
  ['sections: one switch hides them all', 'sectionProblems', [{ file: R, from: 'show: Object.fromEntries(SECTIONS.map((k) => [k, c.sections?.[k] !== false])),', to: 'show: Object.fromEntries(SECTIONS.map((k) => [k, !c.sections])),' }]],
  ['tv: built when nobody asked', 'tvProblems', [{ file: R, from: "if (opt.display === 'tv') pages['tv/index.html']", to: "pages['tv/index.html']" }]],
  ['tv: never built', 'tvProblems', [{ file: R, from: "if (opt.display === 'tv') pages['tv/index.html']", to: "if (false) pages['tv/index.html']" }]],
  ['tv: Lead rotates with the stations', 'tvProblems', [{ file: R, from: 'const own = stations.filter((s) => !isLeadStation(s));', to: 'const own = stations;' }]],
  ['tv: a count on the board', 'tvProblems', [{ file: R, from: '<h2 id="tv-${i}">${esc(s.title)}</h2>', to: '<h2 id="tv-${i}">${esc(s.title)}</h2>${s.report ? `<p>${s.report.distinctScanners} scanners</p>` : \'\'}' }]],
  ['tv: every event on one panel', 'tvProblems', [{ file: R, from: 'const TV_EVENTS = 2;', to: 'const TV_EVENTS = 9;' }]],
  ['tv: a panel gone before it can be read', 'tvProblems', [{ file: R, from: 'return Math.max(14, Math.ceil(3 + (words / 100) * 60 + 2));', to: 'return 8;' }]],
  ['tv: a touch holds for 5 seconds', 'tvProblems', [{ file: R, from: 'export const HOLD_SECONDS = 20;', to: 'export const HOLD_SECONDS = 5;' }]],
  ['tv: no Pause button', 'tvProblems', [{ file: R, from: '<button type="button" class="tv-pause" aria-pressed="false" hidden>Pause</button>', to: '' }]],
  ['tv: a key does not hold the panel', 'tvProblems', [{ file: R, from: 'document.addEventListener("keydown", hold);', to: '' }]],
  ['tv: reduced motion still rotates', 'tvProblems', [{ file: R, from: 'if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;', to: '' }]],
  ['tv: a hidden panel still shows', 'tvProblems', [{ file: R, from: '.panel[hidden] { display: none; }', to: '' }]],
  // Partners (S9)
  ['sponsors: the strip above the event title', 'sponsorProblems', [
    { file: R, from: "          ${row('When', whenText(event, link))}\n          ${sponsorStrip(sponsors, codes)}", to: "          ${row('When', whenText(event, link))}" },
    { file: R, from: '          <h3 id="ev-${i}">${esc(event.title)}</h3>', to: '          ${sponsorStrip(sponsors, codes)}\n          <h3 id="ev-${i}">${esc(event.title)}</h3>' },
  ]],
  ['sponsors: the strip below the content', 'sponsorProblems', [
    { file: R, from: "          ${row('When', whenText(event, link))}\n          ${sponsorStrip(sponsors, codes)}", to: "          ${row('When', whenText(event, link))}" },
    { file: R, from: "          ${row('How', event.howDetails)}", to: "          ${row('How', event.howDetails)}\n          ${sponsorStrip(sponsors, codes)}" },
  ]],
  ['sponsors: never shown', 'sponsorProblems', [{ file: R, from: "if (!sponsors.length) return '';\n  const code = sponsorCode(codes);", to: "if (sponsors.length < 99) return '';\n  const code = sponsorCode(codes);" }]],
  ['sponsors: a past event read', 'sponsorProblems', [{ file: O, from: 'if (!isPast(event, now)) {', to: 'if (true) {' }]],
  ['sponsors: not the public surface', 'sponsorProblems', [{ file: O, from: '/sponsor-bundle?surface=public`);', to: '/sponsor-bundle`);' }]],
  ['sponsors: the whole row kept', 'sponsorProblems', [{ file: O, from: 'out.push({ id, title, campaign });', to: 'out.push({ ...s, id, title, campaign });' }]],
  ['sponsors: linked to its website', 'sponsorProblems', [
    { file: O, from: 'out.push({ id, title, campaign });', to: 'out.push({ id, title, campaign, website_url: s.website_url });' },
    { file: R, from: 'code ? `<a href="${esc(code.url)}">About ${sponsors.length > 1', to: 'sponsors[0].website_url ? `<a href="${esc(sponsors[0].website_url)}">About ${sponsors.length > 1' },
  ]],
  ['sponsors: a click beacon on the link', 'sponsorProblems', [{ file: R, from: 'code ? `<a href="${esc(code.url)}">About ${sponsors.length > 1', to: 'code ? `<a href="${esc(code.url)}" ping="/api/v2/events/x/sponsors/${esc(sponsors[0].id)}/click">About ${sponsors.length > 1' }]],
  ['sponsors: any /s/ code taken for the SPONSOR code', 'sponsorProblems', [{ file: R, from: "codes.find((k) => k.kind === 'sponsor') ?? null;", to: "codes.find((k) => k.kind !== 'track') ?? null;" }]],
  ['sponsors: a sponsor as a button', 'sponsorProblems', [{ file: R, from: '.map((s) => `<span class="backer">${esc(s.title)}</span>`)', to: '.map((s) => `<button type="button" class="backer">${esc(s.title)}</button>`)' }]],
  ['sponsors: a failed bundle passes', 'sponsorProblems', [{ file: O, from: 'if (backing.status !== 200 || !Array.isArray(backing.body?.bundle?.sponsors)) {', to: 'if (false) {' }]],
  ['sponsors: names unchecked', 'sponsorProblems', [{ file: O, from: 'for (const s of sponsors) problems.push(', to: 'for (const s of []) problems.push(' }]],
  ['sponsors: a campaign title unchecked', 'sponsorProblems', [{ file: O, from: "`${s.title} ${s.campaign?.title ?? ''}`, terms));", to: '`${s.title}`, terms));' }]],
  ['escaping: a sponsor name unescaped', 'escapingProblems', [{ file: R, from: '.map((s) => `<span class="backer">${esc(s.title)}</span>`)', to: '.map((s) => `<span class="backer">${s.title}</span>`)' }]],
  ['escaping: a campaign title unescaped', 'escapingProblems', [{ file: R, from: '<span class="muted">· ${esc(campaign.title)}</span>', to: '<span class="muted">· ${campaign.title}</span>' }]],
  ['read only: a click beacon posted to OSE', 'readOnlyProblems', [{ file: O, from: '        sponsors = sponsorsFromBundle(backing.body.bundle);', to: "        sponsors = sponsorsFromBundle(backing.body.bundle);\n        for (const s of sponsors) await f(`${origin}/api/v2/events/${link.oseEventId}/sponsors/${s.id}/impression`, { method: 'GET' }).catch(() => null);" }]],
  ['partner: once per event, not once per station', 'partnerProblems', [{ file: R, from: 'if (sp.campaign?.id !== link.oseCampaignId || seen.has(key)) continue;', to: 'if (sp.campaign?.id !== link.oseCampaignId) continue;' }]],
  ['partner: any sponsor on the station', 'partnerProblems', [{ file: R, from: 'if (sp.campaign?.id !== link.oseCampaignId || seen.has(key)) continue;', to: 'if (seen.has(key)) continue;' }]],
  ['partner: every frequency, not the one named', 'partnerProblems', [{ file: R, from: '(c.campaigns ?? []).filter((k) => onStation(k, s.id))', to: '(c.campaigns ?? [])' }]],
  ['partner: shown without a campaign link', 'partnerProblems', [{ file: R, from: 'for (const link of (c.campaigns ?? []).filter((k) => onStation(k, s.id))) {', to: "for (const link of [{ frequency: s.id, oseCampaignId: 'cmp_sample_wear' }].filter((k) => s.id === 'wear')) {" }]],
  ['partner: below the events', 'partnerProblems', [
    { file: R, from: "    ${partnerList(s, stationPartners(c, s, schedule.upcoming))}\n", to: '' },
    { file: R, from: '  <section aria-labelledby="report-title" class="station-report">', to: '  ${partnerList(s, stationPartners(c, s, schedule.upcoming))}\n  <section aria-labelledby="report-title" class="station-report">' },
  ]],
  ['partner: the campaign not named', 'partnerProblems', [{ file: R, from: "${campaign?.title ? ` <span class=\"muted\">· ${esc(campaign.title)}</span>` : ''}", to: '' }]],
  ['partner: a link on the TV board', 'partnerProblems', [{ file: R, from: 'partnerList(s, stationPartners(c, s, schedule.upcoming), { links: false })', to: 'partnerList(s, stationPartners(c, s, schedule.upcoming))' }]],
  ['partner: missing from the TV board', 'partnerProblems', [{ file: R, from: '      ${partnerList(s, stationPartners(c, s, schedule.upcoming), { links: false })}\n', to: '' }]],
  // Overlap (owner, 2026-11-13)
  ['overlap: also ignored, one station only', 'overlapProblems', [{ file: SH, from: 'link.frequency === id || (link.also ?? []).includes(id);', to: 'link.frequency === id;' }]],
  ['overlap: codes shown again away from home', 'overlapProblems', [{ file: R, from: 'const away = isLead || (here !== null && link.frequency !== here);', to: 'const away = isLead;' }]],
  ['overlap: away everywhere, codes nowhere', 'overlapProblems', [{ file: R, from: 'const away = isLead || (here !== null && link.frequency !== here);', to: 'const away = true;' }]],
  ['overlap: the TV board sends viewers elsewhere for codes', 'overlapProblems', [{ file: R, from: "eventCard(x, `tv-${i}-${k}`, { isLead: false, byId })", to: "eventCard(x, `tv-${i}-${k}`, { isLead: false, byId, here: s.id })" }]],
  ['overlap: the front page names one station', 'overlapProblems', [{ file: R, from: "${(link.also ?? []).map((id) => `, <a href=\"${esc(id)}/index.html\">${esc(byId[id]?.name ?? id)}</a>`).join('')}", to: '' }]],
  ['overlap: a borrowed class held to the wrong slots', 'overlapProblems', [{ file: SH, from: "if (link.intent !== 'programme' || isLead || link.frequency !== station.id) continue;", to: "if (link.intent !== 'programme' || isLead) continue;" }]],
  ['overlap: a borrowed class under On air', 'overlapProblems', [{ file: SH, from: "link.intent === 'programme' && link.frequency === station.id && slotMatches(slot, event)", to: "link.intent === 'programme' && slotMatches(slot, event)" }]],
  ['overlap: a campaign on its own station only', 'overlapProblems', [{ file: R, from: '(c.campaigns ?? []).filter((k) => onStation(k, s.id))', to: '(c.campaigns ?? []).filter((k) => k.frequency === s.id)' }]],
  ['overlap: an unknown station accepted', 'overlapProblems', [{ file: SC, from: "if (!ids.has(id)) out.push(`${where}: also", to: "if (false) out.push(`${where}: also" }]],
  ['overlap: Lead accepted in also', 'overlapProblems', [{ file: SC, from: 'else if (leadIds.has(id)) out.push(', to: 'else if (false) out.push(' }]],
  ['overlap: its own station accepted in also', 'overlapProblems', [{ file: SC, from: 'else if (id === link.frequency) out.push(', to: 'else if (false) out.push(' }]],
  ['overlap: a station listed twice accepted', 'overlapProblems', [{ file: SC, from: 'if (listed.indexOf(id) !== k) out.push(', to: 'if (false) out.push(' }]],
  ['overlap: an event linked twice accepted', 'overlapProblems', [{ file: SC, from: 'if (seen.has(e.oseEventId)) problems.push(', to: 'if (false) problems.push(' }]],
  ['overlap: campaigns unchecked', 'overlapProblems', [{ file: SC, from: "problems.push(...alsoProblems(`campaigns.${i}`, c));", to: '' }]],
  ['overlap: a borrowing station needs no why', 'overlapProblems', [{ file: SC, from: 'for (const id of e.also ?? []) if (ids.has(id)) onAir.add(id);', to: '' }]],
  // Declared series (S15 follow-up)
  ['series: a programme event off every declared series passes', 'seriesProblems', [{ file: SH, from: "if (series === null) problems.push(", to: "if (false) problems.push(" }]],
  ['series: an OSE that does not say stops the build', 'seriesProblems', [{ file: SH, from: "if (series === null) problems.push(", to: "if (!series) problems.push(" }]],
  ['series: a series that disagrees with its slot passes', 'seriesProblems', [{ file: SH, from: "if (series) for (const s of own) problems.push(...seriesSlotProblems(series, s)", to: "if (false) for (const s of own) problems.push(...seriesSlotProblems(series, s)" }]],
  ['series: the weekday counted from Monday', 'seriesProblems', [{ file: SH, from: "const SERIES_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];", to: "const SERIES_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];" }]],
  ['series: the hour unchecked', 'seriesProblems', [{ file: SH, from: 'series.hourOfDay !== Number(slot.time.slice(0, 2))', to: 'false' }]],
  ['series: the cadence unchecked', 'seriesProblems', [{ file: SH, from: 'if (series.cadence && series.cadence !== slot.cadence) out.push(', to: 'if (false) out.push(' }]],
  ['series: a one-off held to a series', 'seriesProblems', [{ file: SH, from: "    // A programme event is held to the slots of the station it lives on, not of one it also shows on.\n    if (link.intent !== 'programme' || isLead || link.frequency !== station.id) continue;", to: "    if (series === null) problems.push(`${where}: a programme event is not on a declared series in OurSharedEvents`);\n    if (link.intent !== 'programme' || isLead || link.frequency !== station.id) continue;" }]],
  ['series: not shown on the card', 'seriesProblems', [{ file: R, from: "          ${row('Series', series?.name)}\n", to: '' }]],
  ['series: the whole OSE row kept', 'seriesProblems', [{ file: O, from: "  return {\n    id: s.id,\n    name: String(s.name ?? '').trim(),", to: "  return {\n    ...s,\n    id: s.id,\n    name: String(s.name ?? '').trim()," }]],
  ['series: a missing answer read as none', 'seriesProblems', [{ file: O, from: "if (!body || !('series' in body)) return undefined;", to: "if (!body || !('series' in body)) return null;" }]],
  ['series: its name unchecked', 'seriesProblems', [{ file: O, from: "if (series) problems.push(...neutralProblems(", to: "if (false) problems.push(...neutralProblems(" }]],
  ['escaping: a series name unescaped', 'escapingProblems', [{ file: R, from: "const row = (label, value) => (value ? `<p><span class=\"label\">${label}</span>${esc(value)}</p>` : '');", to: "const row = (label, value) => (value ? `<p><span class=\"label\">${label}</span>${label === 'Series' ? value : esc(value)}</p>` : '');" }]],
  // The where map
  ['map: a finer cell drawn', 'mapProblems', [{ file: M, from: 'isValidCell(cell) && getResolution(cell) === MAP_RESOLUTION ? cell : null', to: 'isValidCell(cell) && getResolution(cell) >= MAP_RESOLUTION ? cell : null' }]],
  ['map: any text kept as a cell', 'mapProblems', [{ file: M, from: "return typeof cell === 'string' && isValidCell(cell) && getResolution(cell) === MAP_RESOLUTION ? cell : null;", to: "return typeof cell === 'string' && (!isValidCell(cell) || getResolution(cell) === MAP_RESOLUTION) ? cell : null;" }]],
  ['map: the coordinates kept', 'mapProblems', [{ file: O, from: '    area: areaCell(item.h3_res7),', to: '    area: areaCell(item.h3_res7),\n    lat: item.lat ?? null,\n    lon: item.lon ?? null,' }]],
  ["map: the cell id written into the page", 'mapProblems', [{ file: M, from: "areas.push({ points, centre: [x, y] });", to: "areas.push({ cell: a.cell, points, centre: [x, y] });" }, { file: M, from: "`<polygon class=\"hex-area\" points=\"${a.points}\"></polygon>", to: "`<polygon class=\"hex-area\" data-cell=\"${a.cell}\" points=\"${a.points}\"></polygon>" }]],
  ['map: an online event drawn', 'mapProblems', [{ file: M, from: "if (event.attendanceMode === 'online') return;", to: '' }]],
  ['map: an event with no area dropped from the list', 'mapProblems', [{ file: M, from: 'if (event.whereAddress || event.venue) offMap.push(i);', to: '' }]],
  ['map: one hexagon per event, not per area', 'mapProblems', [{ file: M, from: 'const seen = areas.find((a) => a.cell === event.area);', to: 'const seen = null;' }]],
  ["map: no neighbours drawn", 'mapProblems', [{ file: M, from: "&around=1`;", to: "&around=0`;" }]],
  ["map: the areas under the street layer", 'mapProblems', [{ file: M, from: "<g class=\"hex-streets\">${map.streets ? map.streets.svg : ''}</g><g class=\"hex-around\">${empty}</g><g class=\"hex-areas\">${filled}</g>", to: "<g class=\"hex-areas\">${filled}</g><g class=\"hex-around\">${empty}</g><g class=\"hex-streets\">${map.streets ? map.streets.svg : ''}</g>" }]],
  ['map: the areas opaque', 'mapProblems', [{ file: R, from: '.hex-area { fill: var(--accent); fill-opacity: 0.3;', to: '.hex-area { fill: var(--accent); fill-opacity: 0.9;' }]],
  ["map: the heading opens with the station's name, so \"Wear\" reads as a misspelt Where", 'mapProblems', [{ file: R, from: "`Where ${esc(s.name)} meets in person, by area.`", to: "`${esc(s.name)} in person, by area.`" }]],
  ["map: the showcase's own frame, not the one OurSharedEvents gave", 'mapProblems', [{ file: M, from: "viewBox=\"0 0 ${map.w} ${map.h}\"", to: "viewBox=\"0 0 640 360\"" }]],
  ["map: a number off its centre", 'mapProblems', [{ file: M, from: "x=\"${a.centre[0]}\" y=\"${a.centre[1]}\"", to: "x=\"${a.centre[1]}\" y=\"${a.centre[0]}\"" }]],
  ["map: cells sent out of the list's order", 'mapProblems', [{ file: O, from: "const cells = whereAreas(upcoming).areas.map((a) => a.cell);", to: "const cells = whereAreas(upcoming).areas.map((a) => a.cell).reverse();" }]],
  ["map: one map read once per station", 'mapProblems', [{ file: O, from: "if (cells.length) lists.set(mapKey(cells), cells);", to: "if (cells.length) lists.set(`${s.id}:${mapKey(cells)}`, cells);" }]],
  ["map: the street layer left out", 'mapProblems', [{ file: M, from: "${map.streets ? map.streets.svg : ''}", to: "" }]],
  ["map: street rules not in the stylesheet", 'mapProblems', [{ file: R, from: "return { html, css: map?.streets ? `\\n${map.streets.css}\\n` : '' };", to: "return { html, css: '' };" }]],
  ["map: streets with no credit", 'mapProblems', [{ file: R, from: "${map?.streets ? `<div class=\"where-credit\">${map.streets.credit}</div>` : ''}", to: "" }]],
  ["map: a credit with no streets", 'mapProblems', [{ file: R, from: "${map?.streets ? `<div class=\"where-credit\">${map.streets.credit}</div>` : ''}", to: "<div class=\"where-credit\"><p class=\"amap-credit\">Street map data \u00a9 OpenStreetMap contributors.</p></div>" }]],
  ["map: a 13th area asked for", 'mapProblems', [{ file: M, from: "export const MAP_AREAS_MAX = 12;", to: "export const MAP_AREAS_MAX = 13;" }]],
  ["map: an event in a 13th area dropped from the list", 'mapProblems', [{ file: M, from: "else beyond.push(i);", to: "" }]],
  ["map: read though it is switched off", 'mapProblems', [{ file: O, from: "  if (creator.sections?.map === false) return [];\n", to: "" }]],
  ['map: no list beside it', 'mapProblems', [{ file: R, from: '<ol class="areas" aria-label="Events by area">', to: '<ol class="areas-gone" hidden aria-label="Events by area">' }]],
  ['map: the list links nowhere', 'mapProblems', [{ file: R, from: 'return `<li><a href="#ev-${i}">${esc(event.title)}</a>', to: 'return `<li><a href="#ev-${i + 40}">${esc(event.title)}</a>' }]],
  ['map: above the events', 'mapProblems', [
    { file: R, from: "  ${where.html}\n\n", to: '' },
    { file: R, from: '  <section aria-labelledby="when-title" id="when">', to: "  ${where.html}\n  <section aria-labelledby=\"when-title\" id=\"when\">" },
  ]],
  ["map: not announced as an image", 'mapProblems', [{ file: M, from: "viewBox=\"0 0 ${map.w} ${map.h}\" role=\"img\" aria-labelledby", to: "viewBox=\"0 0 ${map.w} ${map.h}\" aria-labelledby" }]],
  ["map: labelled by nothing on the page", 'mapProblems', [{ file: R, from: "mapSvg(map, { labelledby: 'where-title where-note' })", to: "mapSvg(map, { labelledby: 'where-heading' })" }]],
  ["map: an empty frame on a station with no area", 'mapProblems', [{ file: R, from: "  if (!areas.length) return { html: '', css: '' };\n", to: "" }]],
  ["map: the switch ignored", 'mapProblems', [{ file: R, from: "const where = opt.show.map ? whereSection(s, schedule.upcoming, isLead, maps) : { html: '', css: '' };", to: "const where = whereSection(s, schedule.upcoming, isLead, maps);" }]],
  // The where map is OurSharedEvents' answer (OW-217): nothing of it is trusted, and a failed read stops nothing.
  ["map answer: the street layer's tags unread", 'mapAnswerProblems', [{ file: M, from: "if (tags.some((t) => !STREET_TAG.test(t))) return null;", to: "" }]],
  ["map answer: a stray bracket in the street layer passes", 'mapAnswerProblems', [{ file: M, from: "const tags = svg.match(/<[^<>]*>|[<>]/g) ?? [];", to: "const tags = svg.match(/<[^<>]*>/g) ?? [];" }]],
  ["map answer: any attribute on a street tag", 'mapAnswerProblems', [{ file: M, from: "(?: (?:class|aria-hidden|data-testid|data-z|width|height|x|y|d|text-anchor)=\"[A-Za-z0-9 .,-]*\")*", to: "(?: [a-z-]+=\"[^\"]*\")*" }]],
  ["map answer: any value in a street attribute", 'mapAnswerProblems', [{ file: M, from: "=\"[A-Za-z0-9 .,-]*\")*", to: "=\"[^\"<>]*\")*" }]],
  ["map answer: the street rules unread", 'mapAnswerProblems', [{ file: M, from: "if (!STREET_CSS.test(css) || /url\\s*\\(|expression|import|javascript/i.test(css)) return null;", to: "" }]],
  ["map answer: street rules may load an address", 'mapAnswerProblems', [{ file: M, from: "if (!STREET_CSS.test(css) || /url\\s*\\(|expression|import|javascript/i.test(css)) return null;", to: "if (!STREET_CSS.test(css)) return null;" }]],
  ["map answer: street rules may style the page", 'mapAnswerProblems', [{ file: M, from: "const STREET_CSS = /^(?:\\.as-[a-z0-9-]+(?:,\\.as-[a-z0-9-]+)*\\{", to: "const STREET_CSS = /^(?:[.a-z0-9-]+(?:,[.a-z0-9-]+)*\\{" }]],
  ["map answer: the credit unread", 'mapAnswerProblems', [{ file: M, from: "  if (!CREDIT.test(credit)) return null;\n", to: "" }]],
  ["map answer: a credit that credits nobody passes", 'mapAnswerProblems', [{ file: M, from: "  if (!hosts.includes('www.openstreetmap.org')) return null;\n", to: "" }]],
  ["map answer: a credit may link anywhere", 'mapAnswerProblems', [{ file: M, from: "<a href=\"https:\\/\\/(?:www\\.openstreetmap\\.org|protomaps\\.com)(?:\\/[A-Za-z0-9/_-]*)?\">", to: "<a href=\"https:\\/\\/[^\"<>]+\">" }]],
  ["map answer: streets kept with no credit", 'mapAnswerProblems', [{ file: M, from: "  if (typeof svg !== 'string' || typeof css !== 'string' || typeof credit !== 'string') return null;\n  if (svg.length > STREET_SVG_MAX || css.length > STREET_CSS_MAX || credit.length > CREDIT_MAX) return null;", to: "  if (typeof svg !== 'string' || typeof css !== 'string') return null;" }, { file: M, from: "  if (!CREDIT.test(credit)) return null;\n", to: "  if (credit === undefined) return { svg, css, credit: '' };\n" }]],
  ["map answer: an outline of any number of corners", 'mapAnswerProblems', [{ file: M, from: "if (typeof points !== 'string' || !SIX_CORNERS.test(points)) return null;", to: "if (typeof points !== 'string') return null;" }]],
  ["map answer: any text taken for an outline", 'mapAnswerProblems', [{ file: M, from: "if (typeof points !== 'string' || !SIX_CORNERS.test(points)) return null;\n", to: "if (typeof points !== 'string') return null;\n  if (points.length) return points;\n" }]],
  ["map answer: an outline outside the frame accepted", 'mapAnswerProblems', [{ file: M, from: "return inside ? points : null;", to: "return points;" }]],
  ["map answer: the centre unread", 'mapAnswerProblems', [{ file: M, from: "if (!points || ![x, y].every(Number.isFinite) || x < 0 || x > w || y < 0 || y > h) return null;", to: "if (!points) return null;" }]],
  ["map answer: a frame of any size", 'mapAnswerProblems', [{ file: M, from: "if (![w, h].every((n) => Number.isFinite(n) && n > 0 && n <= FRAME_MAX)) return null;", to: "" }]],
  ["map answer: another area's map accepted", 'mapAnswerProblems', [{ file: M, from: "const points = a?.cell === cells[i] ? outline(a.points, w, h) : null;", to: "const points = outline(a?.points, w, h);" }]],
  ["map answer: a map with an area missing accepted", 'mapAnswerProblems', [{ file: M, from: "if (body.areas.length !== cells.length || body.around.length > cells.length * 6) return null;", to: "" }]],
  ["map answer: an answer that says it failed accepted", 'mapAnswerProblems', [{ file: M, from: "if (!body || body.ok !== true ||", to: "if (!body ||" }]],
  ["map fail soft: a failed read stops the build", 'mapFailSoftProblems', [{ file: O, from: "    } catch (e) {\n      why = e?.name", to: "    } catch (e) {\n      throw e;\n      why = e?.name" }]],
  ["map fail soft: a refused read stops the build", 'mapFailSoftProblems', [{ file: O, from: "if (res.status !== 200) why = `answered ${res.status}`;\n      else {", to: "if (res.status !== 200) throw new Error(`OSE map answered ${res.status}`);\n      {" }]],
  ["map fail soft: a refusal is reported as something else", 'mapFailSoftProblems', [{ file: O, from: "if (res.status !== 200) why = `answered ${res.status}`;", to: "if (res.status !== 200) why = 'could not be read';" }]],
  ["map fail soft: an empty frame where the map is missing", 'mapFailSoftProblems', [{ file: R, from: "${map ? `<figure class=\"where-map\">${mapSvg(map, { labelledby: 'where-title where-note' })}</figure>` : ''}", to: "<figure class=\"where-map\">${map ? mapSvg(map, { labelledby: 'where-title where-note' }) : ''}</figure>" }]],
  ["map fail soft: the page speaks of a map it does not show", 'mapFailSoftProblems', [{ file: R, from: "` : `${size} The map could not be drawn when this page was built, so the areas are listed without it.`}", to: "` : `${size} The map shows where events are. It never shows where people are. The same events are listed below it.`}" }]],
  ["map fail soft: the list goes with the map", 'mapFailSoftProblems', [{ file: R, from: "  const item = (i) => {\n    const { event, link } = upcoming[i];\n    return `<li><a href=\"#ev-${i}\">", to: "  if (!map) return { html: '', css: '' };\n  const item = (i) => {\n    const { event, link } = upcoming[i];\n    return `<li><a href=\"#ev-${i}\">" }]],
  ["map fail soft: a read with no time limit", 'mapFailSoftProblems', [{ file: O, from: ", signal: globalThis.AbortSignal.timeout(MAP_TIMEOUT_MS) });", to: " });" }]],
  ["map fail soft: the build is not told", 'mapFailSoftProblems', [{ file: O, from: "if (why) mapsMissed.push(", to: "if (false) mapsMissed.push(" }]],
  ["map fail soft: one failed map loses the rest", 'mapFailSoftProblems', [{ file: O, from: "    if (why) mapsMissed.push(", to: "    if (why) return { maps: {}, mapsMissed: [`a map of ${cells.length} areas was left out: OurSharedEvents ${why}`] };\n    if (why) mapsMissed.push(" }]],
  ["map spacing: no wait between reads", 'mapSpacingProblems', [{ file: O, from: "if (wait > 0) await sleep(wait);", to: "" }]],
  ["map spacing: the gap too short", 'mapSpacingProblems', [{ file: O, from: "export const MAP_GAP_MS = 200;", to: "export const MAP_GAP_MS = 100;" }]],
  ["map spacing: waits whatever the answer took", 'mapSpacingProblems', [{ file: O, from: "const wait = MAP_GAP_MS - (clock() - last);", to: "const wait = MAP_GAP_MS;" }]],
  ["map contract: the frame staging gives is refused", 'mapContractProblems', [{ file: M, from: "const FRAME_MAX = 4096;", to: "const FRAME_MAX = 400;" }]],
  ["map contract: the neighbours not asked for", 'mapContractProblems', [{ file: M, from: "&around=1`;", to: "`;" }]],
  ["map contract: the outline rewritten", 'mapContractProblems', [{ file: M, from: "areas.push({ points, centre: [x, y] });", to: "areas.push({ points: points.split(' ').reverse().join(' '), centre: [x, y] });" }]],
  ["map contract: more areas asked for than OSE frames", 'mapContractProblems', [{ file: M, from: "export const MAP_AREAS_MAX = 12;", to: "export const MAP_AREAS_MAX = 20;" }]],
  // Online or in person (S13)
  ['mode: any text kept as a mode', 'modeProblems', [{ file: O, from: 'attendanceMode: MODES.includes(item.attendance_mode) ? item.attendance_mode : null,', to: 'attendanceMode: item.attendance_mode ?? null,' }]],
  ['mode: never read', 'modeProblems', [{ file: O, from: 'attendanceMode: MODES.includes(item.attendance_mode) ? item.attendance_mode : null,', to: 'attendanceMode: null,' }]],
  ['mode: not on the card', 'modeProblems', [{ file: R, from: "${mode ? `<span class=\"tag\">${esc(mode)}</span>` : ''}", to: '' }]],
  ['mode: an online event shows its place', 'modeProblems', [{ file: R, from: "const where = event.attendanceMode === 'online' ? 'Online' : event.whereAddress || event.venue;", to: 'const where = event.whereAddress || event.venue;' }]],
  ['mode: an event held both ways loses its place', 'modeProblems', [{ file: R, from: "const where = event.attendanceMode === 'online' ? 'Online' : event.whereAddress || event.venue;", to: "const where = event.attendanceMode !== 'in_person' && event.attendanceMode ? 'Online' : event.whereAddress || event.venue;" }]],
  ['mode: an event held both ways is off the map', 'modeProblems', [{ file: M, from: "if (event.attendanceMode === 'online') return;", to: "if (event.attendanceMode === 'online' || event.attendanceMode === 'both') return;" }]],
  ['mode: a class held another way than its slot passes', 'modeProblems', [{ file: SH, from: 'for (const s of own) if (s.mode !== event.attendanceMode) problems.push(', to: 'for (const s of own) if (false) problems.push(' }]],
  ['mode: both always labelled online', 'modeProblems', [{ file: SH, from: "both: 'Online and in person' };", to: "both: 'Online' };" }]],
  // Calendar feed (S8 follow-up)
  ['calendar: listed whatever OSE answered', 'calendarProblems', [{ file: O, from: "const feed = res?.status === 200 ? await res.text().catch(() => '') : '';\n    if (/^BEGIN:VCALENDAR\\r?\\n/.test(feed)) {", to: "const feed = res ? await res.text().catch(() => '') : '';\n    if (true) {" }]],
  ['calendar: any 200 taken for a feed', 'calendarProblems', [{ file: O, from: 'if (/^BEGIN:VCALENDAR\\r?\\n/.test(feed)) {', to: 'if (feed) {' }]],
  ['calendar: a missing feed stops the build', 'calendarProblems', [{ file: O, from: 'if (/^BEGIN:VCALENDAR\\r?\\n/.test(feed)) {', to: "if (!/^BEGIN:VCALENDAR\\r?\\n/.test(feed)) throw new Error('no calendar feed');\n    {" }]],
  ['calendar: never listed', 'calendarProblems', [{ file: O, from: 'calendar = `${origin}${path}`;', to: 'calendar = null;' }]],
  ['calendar: its text unchecked', 'calendarProblems', [{ file: O, from: "problems.push(...neutralProblems('the calendar feed', lines, terms));", to: '' }]],
  ['calendar: folded lines not joined', 'calendarProblems', [{ file: O, from: "feed.replace(/\\r?\\n[ \\t]/g, '')", to: 'feed' }]],
  ['calendar: a tracking parameter added', 'calendarProblems', [{ file: R, from: '<p class="calendar"><a href="${esc(calendar)}">', to: '<p class="calendar"><a href="${esc(calendar)}?utm_source=ourwkrp">' }]],
  ['calendar: any URL drawn', 'calendarProblems', [{ file: R, from: 'if (!calendar || !CALENDAR_URL.test(calendar)) return', to: 'if (!calendar) return' }]],
  ['calendar: on every station page', 'calendarProblems', [
    { file: R, from: 'function stationPage({ c, s, stations, schedule, theme, built, byId, opt, maps }) {', to: 'function stationPage({ c, s, stations, schedule, theme, built, byId, opt, maps, calendar }) {' },
    { file: R, from: "pages[`${s.id}/index.html`] = stationPage({ c, s,", to: "pages[`${s.id}/index.html`] = stationPage({ calendar: ose.calendar, c, s," },
    { file: R, from: "    ${partnerList(s, stationPartners(c, s, schedule.upcoming))}\n", to: "    ${partnerList(s, stationPartners(c, s, schedule.upcoming))}\n    ${calendarLine(calendar)}\n" },
  ]],
  ['calendar: read for a creator with no events', 'calendarProblems', [
    { file: O, from: "if (!links.length) return { origin, linked: [], dropped: [], calendar: null, maps: {}, mapsMissed: [] };", to: '' },
    { file: O, from: '  if (linked.length) {\n    await paced();\n    const path = calendarPath', to: '  if (true) {\n    await paced();\n    const path = calendarPath' },
  ]],
  ["placements: a station's own labels ignored", 'placementLabelProblems', [{ file: S, from: "(event.placements?.length ? event.placements : SHAPES[event.demo].placements)", to: "SHAPES[event.demo].placements" }]],
  ['wording: "the creator" is back', 'instanceWordingProblems', [{ file: R, from: "${esc(c.name)} sees all of it.", to: "The creator sees all of it." }]],
  ['wording: the fixed list of kinds is back', 'instanceWordingProblems', [{ file: R, from: "for this week's ${esc(orList(kinds))}.", to: "for this week's class, set or game night." }]],
  ['wording: the consent rule names nobody', 'instanceWordingProblems', [{ file: R, from: "and ${esc(c.name)} has accepted.", to: "and the other side has accepted." }]],
  ['wording: an instance with no kinds reads nothing', 'instanceWordingProblems', [{ file: R, from: "eventKinds(c).length ? eventKinds(c) : ['event']", to: "eventKinds(c)" }]],
  ['wording: kinds read from every station but the first', 'instanceWordingProblems', [{ file: R, from: "const kinds = creator.stations.flatMap(", to: "const kinds = creator.stations.slice(1).flatMap(" }]],
  ['unit: totals ignore an hour of exactly 5', 'totalProblems', [{ file: S, from: 'filter((n) => n >= FLOOR)', to: 'filter((n) => n > FLOOR)' }]],
  ['unit: hours all get the first count', 'bucketProblems', [{ file: S, from: 'n: shape.counts[i]', to: 'n: shape.counts[0]' }]],
  ['unit: the pacer never waits', 'pacingProblems', [{ file: S, from: 'if (stamps.length >= perMinute) {', to: 'if (false) {' }]],
  ['unit: the catalog overrides the creator', 'mergeProblems', [{ file: S, from: 'freq: s.freq ?? cat.freq,', to: 'freq: cat.freq,' }]],
  ['unit: dates in the wrong order', 'dateProblems', [{ file: S, from: "toLocaleDateString('en-GB'", to: "toLocaleDateString('en-US'" }]],
  ['slots: the week of the month off by one', 'slotProblems', [{ file: SH, from: 'Math.floor((day - 1) / 7)', to: 'Math.floor(day / 7)' }]],
  ['slots: times read in UTC', 'slotProblems', [{ file: SH, from: "const when = eventWhen(ev, slot.timezone || ev.timezone || 'UTC');", to: "const when = eventWhen(ev, 'UTC');" }]],
  ['slots: midnight reads 0 am', 'slotProblems', [{ file: SH, from: 'h % 12 === 0 ? 12 : h % 12', to: 'h % 12' }]],
  ['time: today reads as past', 'timeProblems', [{ file: SH, from: 'return last < todayIn(', to: 'return last <= todayIn(' }]],
  ['intents: a trial under On air', 'intentProblems', [{ file: SH, from: "link.intent === 'programme' && link.frequency === station.id && slotMatches(slot, event)", to: 'slotMatches(slot, event)' }]],
  ['intents: a programme off its slots accepted', 'intentProblems', [{ file: SH, from: 'if (!own.length) problems.push(', to: 'if (false) problems.push(' }]],
  ['intents: a mode unlike its slot accepted', 'intentProblems', [{ file: SH, from: 'if (s.mode !== event.attendanceMode) problems.push(', to: 'if (false) problems.push(' }]],
  ['frequency: every event on every station', 'intentProblems', [{ file: SH, from: 'isLead || onStation(link, station.id)', to: 'true' }]],
  ['order: latest first', 'intentProblems', [{ file: SH, from: '(a, b) => sortKey(a.event).localeCompare(sortKey(b.event));', to: '(a, b) => sortKey(b.event).localeCompare(sortKey(a.event));' }]],
  ['past: a moved programme blocks the build on past events', 'intentProblems', [{ file: SH, from: 'for (const { link, event, series } of upcoming) {', to: 'for (const { link, event, series } of mine) {' }]],
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
    const mislabelled = structuredClone(good);
    mislabelled.reports[1].placements = ['Table card', 'Garment tag'];
    expect(reportProblems(creator, mislabelled).join('\n')).toMatch(/wear: codes hung under "Table card, Garment tag", want "Table card, Stall sign"/);
    named.reports[0].pageText = 'Checked in: planted.person@example.com';
    expect(reportProblems(creator, named).join('\n')).toMatch(/email address/);
  });

  it('integration verdict (OSE): a lost card, an extra event, a dead code and a form target are each caught', async () => {
    const m = await realModules();
    const pages = await C.samplePages(m);
    const urls = [...new Set(Object.values(pages).flatMap((h) => [...h.matchAll(/data-code-url="([^"]*)"/g)].map((x) => x[1])))];
    const resolved = urls.map((url) => ({ url, status: 302, location: `${C.FAKE_ORIGIN}/events/evt_sample-0001` }));
    // The stand-in names campaigns in its bundle and serves the calendar feed, so both are expected.
    const withCampaigns = { campaigns: true, calendar: `${C.FAKE_ORIGIN}/brands/showcase-sample/calendar.ics`, series: true, modes: true };
    const lostCard = { ...pages, 'teach/index.html': pages['teach/index.html'].replace('<article class="event"', '<article class="gone"') };
    expect(oseVerdictProblems(plan(), C.sample(), lostCard, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/teach: 3 event cards, want 4/);
    const draftShown = { ...pages, 'teach/index.html': `${pages['teach/index.html']}<h3>Draft class (showcase demo)</h3>` };
    expect(oseVerdictProblems(plan(), C.sample(), draftShown, resolved, C.NOW).join('\n')).toMatch(/evt_sample-0007: "Draft class/);
    const dead = resolved.map((r, i) => (i === 0 ? { ...r, status: 404 } : r));
    expect(oseVerdictProblems(plan(), C.sample(), pages, dead, C.NOW).join('\n')).toMatch(/answered 404/);
    expect(oseVerdictProblems(plan(), C.sample(), pages, resolved, C.NOW, withCampaigns)).toEqual([]);
    expect(oseVerdictProblems(plan(), C.sample(), pages, resolved, C.NOW, { campaigns: true, series: true }).join('\n')).toMatch(/calendar links "index\.html [^"]*calendar\.ics", want ""/);
    expect(oseVerdictProblems(plan(), C.sample(), pages, resolved, C.NOW, { ...withCampaigns, series: false }).join('\n')).toMatch(/teach: series named "Thursday evening class[^"]*", want ""/);
    const lostSeries = { ...pages, 'teach/index.html': pages['teach/index.html'].replace('<span class="label">Series</span>', '<span class="label">Gone</span>') };
    expect(oseVerdictProblems(plan(), C.sample(), lostSeries, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/teach: series named/);
    // After a seed, OSE has named the campaign: the verdict follows the swapped id, and not a wrong one.
    const swapped = { ...C.sample(), campaigns: [{ frequency: 'wear', oseCampaignId: 'cmp_real-0001' }] };
    expect(oseVerdictProblems(plan(), swapped, pages, resolved, C.NOW, { ...withCampaigns, campaignIds: { cmp_sample_wear: 'cmp_real-0001' } })).toEqual([]);
    expect(oseVerdictProblems(plan(), swapped, pages, resolved, C.NOW, { ...withCampaigns, campaignIds: { cmp_sample_wear: 'cmp_other' } }).join('\n')).toMatch(/wear: station partners "Corner hardware[^"]*", want ""/);
    expect(oseVerdictProblems(plan(), C.sample(), pages, resolved, C.NOW, { ...withCampaigns, modes: false }).join('\n')).toMatch(/teach: modes shown "[^"]+", want ""/);
    const wrongMode = { ...pages, 'wear/index.html': pages['wear/index.html'].replace('<span class="tag">In person</span>', '<span class="tag">Online</span>') };
    expect(oseVerdictProblems(plan(), C.sample(), wrongMode, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/wear: modes shown/);
    const lostArea = { ...pages, 'wear/index.html': pages['wear/index.html'].replace('<polygon class="hex-area"', '<polygon class="gone"') };
    expect(oseVerdictProblems(plan(), C.sample(), lostArea, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/wear: 1 areas on the map, want 2/);
    const ownFrame = { ...pages, 'wear/index.html': pages['wear/index.html'].replace('<svg class="hex-map" viewBox="0 0 600 360"', '<svg class="hex-map" viewBox="0 0 640 360"') };
    expect(oseVerdictProblems(plan(), C.sample(), ownFrame, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/wear: its map is not in the frame OurSharedEvents draws/);
    const noMap = { ...pages, 'wear/index.html': pages['wear/index.html'].replace(/<figure class="where-map">[\s\S]*?<\/figure>/, '') };
    expect(oseVerdictProblems(plan(), C.sample(), noMap, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/wear: 0 areas on the map, want 2/);
    const noFeed = { ...pages, 'index.html': pages['index.html'].replace(/<p class="calendar">[\s\S]*?<\/p>/, '') };
    expect(oseVerdictProblems(plan(), C.sample(), noFeed, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/calendar links "", want "index\.html/);
    expect(oseVerdictProblems(plan(), C.sample(), pages, resolved, C.NOW, { calendar: withCampaigns.calendar, series: true }).join('\n')).toMatch(/wear: station partners "Corner hardware \(showcase demo\)", want ""/);
    const oneSided = { ...pages, 'teach/index.html': pages['teach/index.html'].replace('Print shop (showcase demo)</span>', 'Print shop (showcase demo)</span>, <span class="backer">Waiting cafe (showcase demo)</span>') };
    expect(oseVerdictProblems(plan(), C.sample(), oneSided, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/sponsor "Waiting cafe \(showcase demo\)" reached a page/);
    const lostStrip = { ...pages, 'wear/index.html': pages['wear/index.html'].replace('<p class="backers">', '<p class="gone">') };
    expect(oseVerdictProblems(plan(), C.sample(), lostStrip, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/wear: sponsor strips/);
    const lostPartner = { ...pages, 'wear/index.html': pages['wear/index.html'].replace('<ul class="partners"', '<ul class="gone"') };
    expect(oseVerdictProblems(plan(), C.sample(), lostPartner, resolved, C.NOW, withCampaigns).join('\n')).toMatch(/wear: station partners "", want "Corner hardware/);
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
