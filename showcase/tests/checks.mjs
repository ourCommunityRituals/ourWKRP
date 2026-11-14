// Every showcase check as a function over the lib modules, returning problems.
// The layer tests call them on the real lib and expect none; born-red.test.mjs
// calls them on mutated copies and expects each to catch its planted fault.
import { cellToParent, gridDisk, latLngToCell } from 'h3-js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { fakeOse, fakeStreets, mapAreasAnswer, FAKE_ORIGIN, NOW, plan } from './fake-ose.mjs';

export const SHOWCASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(join(SHOWCASE, p), 'utf8'));
export const sample = () => json('fixtures/sample-creator.json');
export const catalog = () => json('categories.json');
export const theme = () => readFileSync(join(SHOWCASE, 'theme.css'), 'utf8');
export { NOW, FAKE_ORIGIN };

/** The fixture as a version 1 file: no field version 2 added, places as pairs. */
export function legacyCreator() {
  const c = sample();
  for (const k of ['oseBrand', 'events', 'campaigns', 'privateNames']) delete c[k];
  c.places = c.places.map((p) => (Array.isArray(p) ? p : [p.label, p.note ?? p.kind]));
  for (const s of c.stations) {
    delete s.why;
    delete s.programme;
  }
  c.schedule.rows = c.schedule.rows.map((r) => r.slice(0, 4));
  return c;
}

/** A seeded run's private work file, as the seed writes it: it carries signed links. */
export const seededReports = () => ({
  base: 'http://127.0.0.1:8917',
  seededAt: '2026-11-12T10:00:00.000Z',
  reports: [
    {
      station: 'teach', eventId: 'evt_demo_teach', title: 'Fix-it evening', date: '2026-10-31', scansSent: 30, rowsStored: 30,
      shape: 'medium', placements: ['Clip link', 'Room QR'], reportStatus: 200, distinctScanners: 27,
      reportPath: '/sharedReport?eventId=evt_demo_teach&token=planted.TOKEN-value_1234567890',
      images: { card: 'img/teach-card.jpg', desktop: 'img/teach-desktop.jpg', phone: 'img/teach-phone.jpg' },
    },
    {
      station: 'wear', eventId: 'evt_demo_wear', title: 'Saturday market stall', date: '2026-11-02', scansSent: 21, rowsStored: 21,
      shape: 'low', placements: ['Table card', 'Stall sign'], reportStatus: 200, distinctScanners: 3,
      reportPath: '/sharedReport?eventId=evt_demo_wear&token=planted.TOKEN-value_0987654321',
      images: { card: 'img/wear-card.jpg', desktop: 'img/wear-desktop.jpg', phone: 'img/wear-phone.jpg' },
    },
  ],
});

/** What the build reads from (stand-in) OSE for the fixture, through the module under test. */
export async function sampleOse(m, { creator = sample(), now = NOW, edit, fail, events, calls } = {}) {
  // The stand-in answers at once, so the wait between two map reads is skipped
  // here. mapSpacingProblems drives it with its own clock.
  return m.ose.readOse({ base: FAKE_ORIGIN, creator, fetch: fakeOse({ now, edit, fail, events, calls }), now, sleep: async () => {} });
}

/** Render every page of the fixture with its OSE data. */
export async function samplePages(m, { creator = sample(), reports = seededReports(), now = NOW, withTheme = false } = {}) {
  const ose = await sampleOse(m, { creator, now });
  return m.render.renderPages({ creator, catalog: catalog().categories, reports, theme: withTheme ? theme() : '', ose, now });
}

// ── tag-level HTML helpers (escaped text never contains a literal "<") ────────
const tags = (html) => html.match(/<[a-zA-Z][^>]*>/g) ?? [];
const withoutValues = (tag) => tag.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");

/** Inline event handlers (onclick=…) on any element: a served page's CSP forbids them. */
export function inlineHandlerProblems(html) {
  return tags(html)
    .filter((t) => /\son[a-z]+\s*=/i.test(withoutValues(t)))
    .map((t) => `inline handler: ${t.slice(0, 80)}`);
}

// A link between the creator's own pages: ../index.html, teach/index.html, ../wear/index.html.
const OWN_PAGE = /^(\.\.\/)?([a-z0-9]+(-[a-z0-9]+)*\/)?index\.html$/;
const OWN_ANCHOR = /^#ev-\d+$/;
const OWN_IMAGE = /^(\.\.\/)?img\/[a-z0-9-]+\.(jpg|png)$/;
/**
 * Every href / src / srcset is https:, one of the creator's own pages or images,
 * an event card on the same page,
 * or, on `origin` (the OSE the build read), a /q or /s code or the brand's
 * calendar feed.
 */
export function urlProblems(html, origin = null) {
  const out = [];
  const code = origin ? new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/((q|s)/[A-Za-z0-9_-]+|brands/[a-z0-9-]+/calendar\\.ics)$`) : null;
  for (const t of tags(html)) {
    for (const [, attr, value] of t.matchAll(/\s(href|src|srcset)\s*=\s*"([^"]*)"/gi)) {
      const v = value.trim();
      if (/^https:\/\//.test(v) || OWN_PAGE.test(v) || OWN_IMAGE.test(v) || (code && code.test(v))) continue;
      // The where map's list links to an event card on the same page.
      if (attr.toLowerCase() === 'href' && OWN_ANCHOR.test(v)) continue;
      out.push(`${attr}="${value.slice(0, 60)}"`);
    }
  }
  return out;
}

// ── 0. Security ───────────────────────────────────────────────────────────────
const PAYLOADS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'><svg onload=alert(1)>", '</script><script>alert(2)</script>'];
// Fields that are ids, enums or dates: the schema refuses an attack in them before render.
const KEEP = new Set(['id', 'category', 'slug', 'readOn', 'demo', 'frequency', 'oseEventId', 'intent', 'placement', 'until', 'cadence', 'day', 'week', 'time', 'timezone', 'mode', 'station', 'oseBrand', 'oseCampaignId']);
export function hostile(value, key = '', n = { i: 0 }) {
  if (typeof value === 'string') {
    if (KEEP.has(key)) return value;
    if (key === 'url') return 'javascript:alert(1)';
    return `x${PAYLOADS[n.i++ % PAYLOADS.length]}`;
  }
  if (Array.isArray(value)) return value.map((v) => hostile(v, key, n));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hostile(v, k, n)]));
  return value;
}

/** Escaping: a creator, a report and OSE text whose every string is an attack render no live markup, on any page. */
export async function escapingProblems(m) {
  const reports = seededReports();
  reports.reports = reports.reports.map((r) => ({ ...hostile(r), station: r.station, images: r.images, distinctScanners: r.distinctScanners }));
  const creator = hostile(sample());
  creator.schedule.rows = sample().schedule.rows.map((r) => [r[0], ...hostile(r.slice(1, 4)), ...r.slice(4)]);
  // Station names usually come from the catalog; a creator may override them,
  // and they reach attributes and the creator page's script data.
  creator.stations.forEach((s, i) => { s.name = `x${PAYLOADS[(i + 1) % PAYLOADS.length]}${PAYLOADS[3]}`; });
  // OSE text is hostile too: every event field and every code's word and label.
  const n = { i: 0 };
  const ose = await sampleOse(m, {
    creator: sample(),
    edit: (kind, body) => {
      if (kind === 'event') for (const k of ['title', 'name', 'what_short', 'who_host', 'why_purpose', 'how_details', 'where_address', 'venue']) body.item[k] = `x${PAYLOADS[n.i++ % 4]}`;
      if (kind === 'event' && body.series) body.series.name = `x${PAYLOADS[n.i++ % 4]}`;
      if (kind === 'bundle') for (const s of body.slots) { s.word = `x${PAYLOADS[n.i++ % 4]}`; s.label = s.word; }
      if (kind === 'sponsors') {
        for (const s of body.bundle.sponsors) {
          s.title = `x${PAYLOADS[n.i++ % 4]}`;
          if (s.campaign) s.campaign.title = `x${PAYLOADS[n.i++ % 4]}`;
        }
      }
      return body;
    },
  });
  const out = [];
  if (!ose.linked.some((x) => x.sponsors.some((sp) => sp.campaign))) out.push('the hostile build has no campaign partner to check');
  if (!ose.linked.some((x) => x.series)) out.push('the hostile build has no series to check');
  // Every layout's markup and the TV board, not only the default page set.
  for (const layout of ['dial', 'list', 'grid']) {
    const pages = m.render.renderPages({ creator: { ...creator, layout, display: 'tv' }, catalog: catalog().categories, reports, theme: '', ose, now: NOW });
    if (!pages['tv/index.html']) out.push('the hostile build has no TV board to check');
    for (const [path, html] of Object.entries(pages)) {
      const where = `${layout} ${path}`;
      const want = path === 'index.html' || path === 'tv/index.html' ? 1 : 0;
      const scripts = (html.match(/<script\b/gi) ?? []).length;
      if (scripts !== want) out.push(`${where}: ${scripts} <script> elements (want ${want})`);
      if (/<(img|svg)\b[^>]*\son(error|load)\s*=/i.test(html.replace(/="[^"]*"/g, '=""'))) out.push(`${where}: a field rendered a live element with a handler`);
      out.push(...inlineHandlerProblems(html).map((p) => `${where}: ${p}`), ...urlProblems(html, ose.origin).map((p) => `${where}: ${p}`));
    }
  }
  return out;
}

/** Link allowlist: a non-https source or place never becomes a link. */
export function linkProblems(m) {
  const creator = sample();
  creator.sources = [
    { label: 'script link', url: 'javascript:alert(1)', usedFor: 'planted' },
    { label: 'plain http', url: 'http://example.com/', usedFor: 'planted' },
    { label: 'data link', url: 'data:text/html,hi', usedFor: 'planted' },
  ];
  creator.places.push({ label: 'planted place', url: 'javascript:alert(1)', station: 'teach', kind: 'other' });
  const pages = m.render.renderPages({ creator: { ...creator, events: [] }, catalog: catalog().categories, reports: { reports: [] }, theme: '' });
  return Object.entries(pages).flatMap(([p, html]) => urlProblems(html).map((x) => `${p}: ${x}`));
}

/**
 * Evergreen links are plain (owner, 2026-11-12): each place link carries exactly
 * the URL the creator file gives, with nothing added and no counting path.
 */
export async function placeLinkProblems(m) {
  const pages = await samplePages(m);
  const out = [];
  const places = sample().places.filter((p) => !Array.isArray(p) && p.url);
  for (const [path, html] of Object.entries(pages)) {
    for (const [, href, label] of html.matchAll(/<li><a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)) {
      const p = places.find((x) => x.label === label);
      if (!p) continue;
      const raw = href.replaceAll('&amp;', '&');
      if (raw !== p.url) out.push(`${path}: place "${label}" links to ${raw}, not ${p.url}`);
      if (/\/(q|s)\/|utm_|[?&](ref|src|source)=ourwkrp/i.test(raw.slice(p.url.length))) out.push(`${path}: place "${label}" is routed through a counting path`);
    }
  }
  for (const p of places) {
    const hits = Object.values(pages).filter((h) => h.includes(`>${p.label}</a>`)).length;
    if (!hits) out.push(`place "${p.label}" is not linked on any page`);
  }
  return out;
}

/** No secrets published: the built folder holds no signed link, key or token. */
export async function secretProblems(m) {
  const dir = mkdtempSync(join(tmpdir(), 'showcase-secrets-'));
  try {
    const ose = await sampleOse(m);
    m.build.buildShowcase({ creator: sample(), reports: seededReports(), outDir: dir, catalog: catalog(), theme: theme(), ose, now: NOW });
    return m.build.publishedTexts(dir).flatMap(([p, text]) => m.build.publishProblems(p.slice(dir.length + 1), text));
  } catch (e) {
    return [`build refused or failed: ${e.message.split('\n')[0]}`];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Build into a throwaway folder; returns the error message, or null when it built. */
async function tryBuild(m, { creator = sample(), reports = seededReports(), ose } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'showcase-gate-'));
  try {
    m.build.buildShowcase({ creator, reports, outDir: dir, catalog: catalog(), theme: theme(), ose: ose ?? (await sampleOse(m, { creator })), now: NOW });
    return null;
  } catch (e) {
    return e.message;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The publish gate refuses a page that would carry a secret or an identity. */
export async function publishGateProblems(m) {
  const out = [];
  const cases = [
    ['an email in a report title', (r) => { r.reports[0].title = 'Hosted by planted.person@example.com'; }],
    ['a signed link in a creator field', (r, c) => { c.lede = 'See /sharedReport?eventId=x&token=abcdefghijklmnop'; }],
    ['an anonymous cookie in a place', (r, c) => { c.places.push(['ose_anon=abc123', 'planted']); }],
    ['an email on a station page', (r, c) => { c.stations[1].why = 'Write to planted.person@example.com'; }],
  ];
  for (const [what, plant] of cases) {
    const reports = seededReports();
    const creator = sample();
    plant(reports, creator);
    const err = await tryBuild(m, { creator, reports });
    if (err === null) out.push(`the build published ${what}`);
    else if (!/publish refused/.test(err)) out.push(`the build failed on ${what} for another reason: ${err.split('\n')[0]}`);
  }
  return out;
}

/** Never who: no rendered page names a person by email, cookie or id. */
export async function neverWhoProblems(m) {
  const pages = await samplePages(m, { withTheme: true });
  return Object.entries(pages).flatMap(([p, html]) => m.showcase.findIdentities(html).map((k) => `${p} carries an ${k}`));
}

/** Floor: a count under 5 reads "Fewer than 5", never the number. */
export async function floorProblems(m) {
  const html = (await samplePages(m))['index.html'];
  const out = [];
  if (/class="num[^"]*">3</.test(html)) out.push('the table prints 3 for a count under 5');
  if (/: 3 distinct scanners/.test(html)) out.push('an image description prints 3 for a count under 5');
  if (!/Fewer than 5/.test(html)) out.push('no count reads "Fewer than 5"');
  if (!/>27</.test(html)) out.push('a count at or over 5 is not printed as its number');
  for (const n of [0, 1, 4]) if (m.showcase.floorText(n) !== 'Fewer than 5') out.push(`floorText(${n}) = ${m.showcase.floorText(n)}`);
  if (m.showcase.floorText(5) !== '5') out.push(`floorText(5) = ${m.showcase.floorText(5)}`);
  return out;
}

/** Local-only seeding: the base guard takes this machine and nothing else. */
export function localOnlyProblems(m) {
  const out = [];
  for (const bad of ['https://stg.ourwkrp.com', 'https://oursharedevents.com', 'http://example.com:8917', 'http://127.0.0.1.evil.example:80', 'http://localhost', 'http://10.0.0.5:8917', 'file:///etc/passwd', '', undefined]) {
    let threw = false;
    try { m.showcase.assertLocalBase(bad); } catch { threw = true; }
    if (!threw) out.push(`accepted ${String(bad)}`);
  }
  for (const good of ['http://127.0.0.1:8917', 'http://localhost:8787']) {
    try { m.showcase.assertLocalBase(good); } catch { out.push(`refused ${good}`); }
  }
  for (const f of ['seed-local.mjs', 'capture-reports.mjs']) {
    if (!/assertLocalBase\(/.test(readFileSync(join(SHOWCASE, f), 'utf8'))) out.push(`${f} does not guard its base`);
  }
  return out;
}

/** The build reads a local OSE or OSE staging, never production or anything else. */
export function readBaseProblems(m) {
  const out = [];
  for (const bad of ['https://oursharedevents.com', 'https://www.oursharedevents.com', 'http://stg.oursharedevents.com', 'https://stg.oursharedevents.com.evil.example', 'https://stg.oursharedevents.com/', 'https://evil.example', 'http://10.0.0.5:8917', '', undefined]) {
    let threw = false;
    try { m.ose.assertReadBase(bad); } catch { threw = true; }
    if (!threw) out.push(`the build would read ${String(bad)}`);
  }
  for (const good of ['https://stg.oursharedevents.com', 'http://127.0.0.1:8917', 'http://localhost:8787']) {
    try { m.ose.assertReadBase(good); } catch { out.push(`refused ${good}`); }
  }
  if (!/readOse\(/.test(readFileSync(join(SHOWCASE, 'build-page.mjs'), 'utf8'))) out.push('build-page.mjs does not read OSE through readOse');
  return out;
}

// Every read the build may make, each spelled out. A new read is added here on
// purpose, never matched by a loose pattern.
const READS = [
  /^\/api\/v2\/events\?brand=[a-z0-9-]+$/,
  /^\/api\/v2\/events\/[^/?]+$/,
  /^\/api\/v2\/events\/[^/?]+\/poster-bundle(\?deployment=[^&]+)?$/,
  /^\/api\/v2\/events\/[^/?]+\/sponsor-bundle\?surface=public$/,
  /^\/brands\/[a-z0-9-]+\/calendar\.ics$/,
  // The where map: 1 to 12 resolution-7 cells and their neighbours, and nothing
  // else. A coordinate, a finer cell or any other parameter is not this read.
  /^\/api\/v2\/map\/areas\?cells=87[0-9a-f]{13}(,87[0-9a-f]{13}){0,11}&around=1$/,
];

/** The build's OSE reads are public reads: GET, no credential, no cookie. */
export async function readOnlyProblems(m) {
  const calls = [];
  await sampleOse(m, { calls });
  const out = [];
  if (!calls.length) out.push('no OSE read was made');
  for (const { url, init } of calls) {
    const headers = new globalThis.Headers(init.headers ?? {});
    if ((init.method ?? 'GET') !== 'GET') out.push(`${init.method} ${url}`);
    for (const h of ['authorization', 'cookie', 'x-ocr-internal']) if (headers.has(h)) out.push(`${url} sends ${h}`);
    if (init.credentials && init.credentials !== 'omit') out.push(`${url} sends credentials`);
    const path = url.slice(FAKE_ORIGIN.length);
    if (!READS.some((r) => r.test(path))) out.push(`unexpected read ${url}`);
  }
  if (!calls.some(({ url }) => url.includes('/api/v2/map/areas'))) out.push('no where map was read');
  return out;
}

/** Neutral until she agrees: OSE text naming the creator, a venture or her links stops the build. */
export async function neutralNameProblems(m) {
  const out = [];
  const cases = [
    ['her name in a title', 'event', (b) => { b.item.title = 'Class with Sam Sample'; }],
    ['a private name in how_details', 'event', (b) => { b.item.how_details = 'Run by Sample Studio.'; }],
    ['her store link in what_short', 'event', (b) => { b.item.what_short = 'Shop at https://example.com/shop?ref=fixture'; }],
    ['a venture in a code label', 'bundle', (b) => { b.slots[0].label = 'The market shop'; }],
  ];
  for (const [what, kind, plant] of cases) {
    let threw = null;
    try {
      await sampleOse(m, { edit: (k, body) => { if (k === kind) plant(body); return body; } });
    } catch (e) {
      threw = e.message;
    }
    if (!threw || !/not neutral/.test(threw)) out.push(`the build read ${what} without stopping`);
  }
  // A short name is still a name, matched as a whole word; and her first name
  // alone counts. A longer word that only contains it does not stop the build.
  const short = sample();
  short.name = 'Kai';
  const named = [
    ['her first name alone in a title', sample(), 'Class with Sam'],
    ['a 3-letter name in a title', short, 'Evening class with Kai'],
  ];
  for (const [what, creator, title] of named) {
    let threw = null;
    try {
      await sampleOse(m, { creator, edit: (k, b) => { if (k === 'event') b.item.title = title; return b; } });
    } catch (e) {
      threw = e.message;
    }
    if (!threw || !/not neutral/.test(threw)) out.push(`the build read ${what} without stopping`);
  }
  try {
    await sampleOse(m, { creator: short, edit: (k, b) => { if (k === 'event') b.item.title = 'Kaiser rolls and samples'; return b; } });
  } catch (e) {
    out.push(`a word that only contains her name stopped the build: ${e.message.split('\n')[1] ?? e.message}`);
  }
  return out;
}

/** The creator file is checked before OSE is read: a bad file makes no read at all. */
export async function fileFirstProblems(m) {
  const out = [];
  const cases = [
    ['a file with events but no oseBrand', (c) => { delete c.oseBrand; }],
    ['a place link that is not a URL', (c) => { c.places[1].url = 'not a url'; }],
  ];
  for (const [what, plant] of cases) {
    const creator = sample();
    plant(creator);
    const calls = [];
    let threw = null;
    try {
      await sampleOse(m, { creator, calls });
    } catch (e) {
      threw = e.message;
    }
    if (!threw || !/creator file refused/.test(threw)) out.push(`${what} was not refused before reading OSE (${threw?.split('\n')[0] ?? 'it read'})`);
    if (calls.length) out.push(`${what}: OSE was read ${calls.length} times first`);
  }
  return out;
}

/** An upcoming public event never loses its codes unseen: a failed bundle or an unknown placement stops the build. */
export async function lostCodeProblems(m) {
  const out = [];
  const cases = [
    ['a poster bundle that answered 503', { fail: (k) => (k === 'bundle' ? 503 : null) }, /poster bundle answered 503/],
    ['a placement OSE does not know', { edit: (k, b) => { if (k === 'bundle') { b.deploymentId = null; b.links = {}; } return b; } }, /is not an active placement/],
  ];
  for (const [what, opts, want] of cases) {
    let threw = null;
    try {
      await sampleOse(m, opts);
    } catch (e) {
      threw = e.message;
    }
    if (!threw || !want.test(threw)) out.push(`the build read ${what} without stopping`);
  }
  return out;
}

/** A linked event that is missing, not public, or another brand's drops off and fails nothing. */
export async function dropProblems(m) {
  const out = [];
  // The list says it is on the brand, but the event itself is another brand's.
  const ose = await sampleOse(m, {
    edit: (kind, body) => {
      if (kind === 'list') body.items.push({ id: 'evt_sample-0008', brand_id: 'showcase-sample' });
      return body;
    },
  });
  const ids = ose.linked.map((x) => x.link.oseEventId);
  for (const gone of ['evt_sample-0007', 'evt_sample-0008']) if (ids.includes(gone)) out.push(`${gone} was not dropped`);
  if (ose.dropped.length !== 2) out.push(`${ose.dropped.length} dropped, want 2`);
  const missing = await sampleOse(m, { events: plan().events.filter((e) => e.ref !== 'evt_sample-0001') });
  if (missing.linked.some((x) => x.link.oseEventId === 'evt_sample-0001')) out.push('a missing event was kept');
  const pages = m.render.renderPages({ creator: sample(), catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW });
  for (const t of ['Draft class', "Another brand's evening"]) if (Object.values(pages).some((h) => h.includes(t))) out.push(`"${t}" reached a page`);
  return out;
}

/** Served-page CSP readiness: no inline handlers on any fixture page. */
export async function cspProblems(m) {
  const pages = await samplePages(m, { withTheme: true });
  return Object.entries(pages).flatMap(([p, html]) => inlineHandlerProblems(html).map((x) => `${p}: ${x}`));
}

/** Report images are local img/ files only; any other path drops the image. */
export function imagePathProblems(m) {
  const out = [];
  for (const bad of ['javascript:alert(1)', '../../etc/passwd', 'https://elsewhere.example/x.jpg', 'img/../x.jpg', 'img/x.svg']) {
    const r = m.showcase.publicReport({ station: 'teach', images: { card: bad, desktop: bad, phone: bad } });
    if (r.images !== null) out.push(`kept image path ${bad}`);
  }
  return out;
}

// ── 0. Security: digital codes (S4) ───────────────────────────────────────────
const bundleOf = (slots, links = {}, deploymentId = null) => ({ deploymentId, links, slots });
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

/** Only OSE /q and /s URLs on the origin the build read become codes. */
export function codeOriginProblems(m) {
  const o = FAKE_ORIGIN;
  const out = [];
  const refuse = [
    ['an /s code on another host', bundleOf([{ kind: 'website', url: 'https://evil.example/s/Abc123' }])],
    ['a slot that is not an /s code', bundleOf([{ kind: 'website', url: `${o}/events/evt_x` }])],
    ['an external target with no code', bundleOf([{ kind: 'tickets', url: 'https://example.net/tickets' }])],
    ['an /s code with a query', bundleOf([{ kind: 'website', url: `${o}/s/Abc123?utm_source=x` }])],
    ['a placement code on another host', bundleOf([], { register: 'https://evil.example/q/qrt_0000000000000001?type=register' }, 'pd_x')],
    ['two placement codes', bundleOf([], { register: `${o}/q/qrt_0000000000000001?type=register`, checkin: `${o}/q/qrt_0000000000000002?type=checkin` }, 'pd_x')],
  ];
  for (const [what, b] of refuse) if (!throws(() => m.codes.codesFromBundle(b, o))) out.push(`accepted ${what}`);
  const good = m.codes.codesFromBundle(bundleOf([{ kind: 'public', word: 'EVENT', url: `${o}/s/Ev0001` }], { register: `${o}/q/qrt_0000000000000001?type=register`, checkin: `${o}/q/qrt_0000000000000001?type=checkin` }, 'pd_x'), o);
  if (good.map((c) => c.url).join(' ') !== `${o}/q/qrt_0000000000000001 ${o}/s/Ev0001`) out.push(`a good bundle gave ${good.map((c) => c.url).join(' ')}`);
  return out;
}

/** The page gate refuses a code that is not an OSE /q or /s URL, whatever put it there. */
export async function codeGateProblems(m) {
  const out = [];
  const cases = [
    ['a code on another host', (c) => { c.url = 'https://evil.example/q/qrt_0000000000000001'; }],
    ['a code to a form', (c) => { c.url = `${FAKE_ORIGIN}/events/evt_sample-0001/forms/register`; }],
    ['a code with a form query', (c) => { c.url = `${FAKE_ORIGIN}/q/qrt_0000000000000001?type=register`; }],
  ];
  for (const [what, plant] of cases) {
    const ose = await sampleOse(m);
    plant(ose.linked[0].codes[0]);
    const err = await tryBuild(m, { ose });
    if (err === null || !/publish refused/.test(err)) out.push(`the build published ${what}`);
  }
  // A code in markup the gate does not read is refused, not passed unread.
  const odd = `<figure class="code" data-kind="x" data-code-url="https://evil.example/q/qrt_0000000000000001">${m.codes.qrSvg('https://evil.example/q/qrt_0000000000000001')}</figure>`;
  if (!m.build.codeProblems('planted.html', odd, FAKE_ORIGIN).length) out.push('the gate passed a code in markup it does not read');
  return out;
}

/** Forms are the identified side: a check-in or register code, or a form query, never shows as a code. */
export async function formCodeProblems(m) {
  const out = [];
  let ose;
  try {
    ose = await sampleOse(m);
  } catch (e) {
    return [`reading the codes stopped: ${e.message.split('\n')[0]}`];
  }
  const codes = ose.linked.flatMap((x) => x.codes);
  if (codes.some((c) => m.codes.FORM_KINDS.has(c.kind) || c.kind === 'checkin' || c.kind === 'register')) out.push('a form code was kept');
  if (codes.some((c) => /[?&]type=|\/forms?\//.test(c.url))) out.push('a code carries a form path or query');
  if (!codes.some((c) => c.kind === 'track')) out.push('no placement /q code was read');
  return out;
}

/** Rasterise one of our QR SVGs (viewBox + one path of 1x1 squares) and decode it with jsQR, an independent decoder. */
export function decodeQrSvg(svg) {
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const path = svg.match(/<path class="qr-ink" d="([^"]*)"/);
  if (!vb || !path) return null;
  const n = Number(vb[1]);
  const scale = 4;
  const px = n * scale;
  const rgba = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const [, x, y] of path[1].matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = ((Number(y) * scale + dy) * px + (Number(x) * scale + dx)) * 4;
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0;
      }
    }
  }
  return jsQR(rgba, px, px)?.data ?? null;
}

/** Each code's QR decodes to exactly the URL its link carries and shows. */
export async function qrMatchProblems(m) {
  const pages = await samplePages(m);
  const out = [];
  let seen = 0;
  for (const [path, html] of Object.entries(pages)) {
    for (const [, url, inner] of html.matchAll(/<figure class="code" data-code-url="([^"]*)">([\s\S]*?)<\/figure>/g)) {
      seen++;
      const svg = inner.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? '';
      const decoded = decodeQrSvg(svg);
      const link = inner.match(/<a href="([^"]*)">([^<]*)<\/a>/);
      if (decoded !== url) out.push(`${path}: QR decodes to ${decoded}, link is ${url}`);
      if (!link || link[1] !== url || link[2] !== url) out.push(`${path}: the link for ${url} does not carry and show it`);
    }
  }
  if (!seen) out.push('no codes rendered');
  return out;
}

/** The page gate checks that each QR encodes its own link, whatever drew it. */
export function qrGateProblems(m) {
  const url = `${FAKE_ORIGIN}/s/Ev0001`;
  const other = m.codes.qrSvg(`${FAKE_ORIGIN}/s/Ev0002`);
  const html = `<figure class="code" data-code-url="${url}"><div>${other}</div><figcaption><a href="${url}">${url}</a></figcaption></figure>`;
  const found = m.build.codeProblems('planted.html', html, FAKE_ORIGIN);
  return found.some((p) => /does not encode it/.test(p)) ? [] : ['the gate passed a QR that encodes another URL'];
}

/** A past event shows no code and no card; a station with nothing upcoming shows no code. */
export async function pastCodeProblems(m) {
  const out = [];
  const pages = await samplePages(m);
  if (pages['teach/index.html'].includes('already held')) out.push('the past programme event is on the teach page');
  // Two months on, every fixture event is past: no page shows a code.
  const later = NOW + 60 * 86_400_000;
  const ose = await sampleOse(m, { now: NOW });
  const old = m.render.renderPages({ creator: sample(), catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: later });
  for (const [p, html] of Object.entries(old)) if (html.includes('class="code"')) out.push(`${p} shows a code for a past event`);
  if (!old['teach/index.html'].includes('Nothing is scheduled on this frequency yet.')) out.push('a frequency with nothing upcoming does not say so');
  return out;
}

// ── 2. Contract ───────────────────────────────────────────────────────────────
/** The schema refuses what it must refuse, and still takes a version 1 file. */
export function contractProblems(m) {
  const out = [];
  const refused = (mutate, pattern, what) => {
    const c = sample();
    mutate(c);
    const p = m.schema.creatorProblems(c, catalog()).join('\n');
    if (!pattern.test(p)) out.push(`accepted ${what}`);
  };
  if (m.schema.creatorProblems(sample(), catalog()).length) out.push(`refused the valid fixture: ${m.schema.creatorProblems(sample(), catalog())[0]}`);
  if (m.schema.creatorProblems(legacyCreator(), catalog()).length) out.push(`refused a version 1 file: ${m.schema.creatorProblems(legacyCreator(), catalog())[0]}`);
  refused((c) => { c.sources[0].url = 'http://example.com/'; }, /sources\.0\.url/, 'a non-https source');
  refused((c) => { c.stations[0].category = 'nowhere'; }, /not in categories\.json/, 'a missing category');
  refused((c) => { c.stations[0].category = 'spirit'; }, /not open yet/, 'a future category');
  refused((c) => { c.surprise = true; }, /surprise|Unrecognized|unrecognized/, 'an unknown field');
  refused((c) => { c.stations[1].id = c.stations[0].id; }, /used twice/, 'a repeated station id');
  refused((c) => { delete c.disclaimer; }, /disclaimer/, 'a file with no disclaimer');
  // Version 2: places.
  refused((c) => { c.places[1].url = 'http://example.com/shop'; }, /places\.1/, 'a non-https place');
  refused((c) => { c.places[1].station = 'nowhere'; }, /places\.1: station/, 'a place on an unknown station');
  refused((c) => { c.places[1].kind = 'billboard'; }, /places\.1/, 'an unknown place kind');
  // Version 2: frequency decides.
  refused((c) => { c.events[0].frequency = 'nowhere'; }, /events\.0: frequency/, 'an event on an unknown frequency');
  refused((c) => { c.campaigns[0].frequency = 'nowhere'; }, /campaigns\.0: frequency/, 'a campaign on an unknown frequency');
  refused((c) => { c.events[1].oseEventId = c.events[0].oseEventId; }, /linked twice/, 'one event on two frequencies');
  refused((c) => { delete c.events[0].intent; }, /events\.0\.intent/, 'an event without an intent');
  refused((c) => { c.events[0].intent = 'maybe'; }, /events\.0\.intent/, 'an unknown intent');
  refused((c) => { c.events[0].oseEventId = 'not-an-ose-id'; }, /events\.0\.oseEventId/, 'an id that is not OSE-shaped');
  refused((c) => { delete c.oseBrand; }, /oseBrand/, 'linked events with no brand');
  refused((c) => { delete c.events[4].until; }, /events\.4: a pop-up needs/, 'a pop-up without the end of its window');
  refused((c) => { c.events[0].until = '20:00'; }, /only a pop-up/, 'an until on a programme event');
  // Version 2: purposeful and scheduled.
  refused((c) => { delete c.stations[0].why; }, /teach: a frequency with events or a programme needs its why/, 'a frequency on air with no why');
  refused((c) => { delete c.stations[0].programme[0].day; }, /needs a day/, 'a weekly slot with no day');
  refused((c) => { c.stations[0].programme[0].cadence = 'hourly'; }, /programme\.0\.cadence/, 'an unknown cadence');
  refused((c) => { c.stations[0].programme[0].kind = 'set'; }, /not one of teach's event kinds/, "a slot kind outside its category's kinds");
  refused((c) => { delete c.stations[0].programme[0].timezone; }, /needs its timezone/, 'a slot time with no timezone');
  refused((c) => { c.stations[0].programme[0].timezone = 'Mars/Olympus'; }, /unknown timezone/, 'an unknown timezone');
  refused((c) => { c.stations[0].programme[0].mode = 'hybrid'; }, /programme\.0\.mode/, 'an unknown mode');
  refused((c) => { delete c.stations[0].programme[1].week; }, /needs a week/, 'a monthly slot with no week');
  // A demo event's own placement labels: 1 to 4 short labels, or none at all.
  refused((c) => { c.stations[1].event.placements = []; }, /stations\.1\.event\.placements/, 'an empty list of placement labels');
  refused((c) => { c.stations[1].event.placements = ['a', 'b', 'c', 'd', 'e']; }, /stations\.1\.event\.placements/, 'five placement labels');
  refused((c) => { c.stations[1].event.placements = ['x'.repeat(41)]; }, /stations\.1\.event\.placements/, 'a placement label over 40 characters');
  refused((c) => { c.stations[1].event.placements = ['  ']; }, /stations\.1\.event\.placements/, 'a blank placement label');
  {
    const c = sample();
    delete c.stations[1].event.placements;
    if (m.schema.creatorProblems(c, catalog()).length) out.push('refused a demo event with no placement labels');
  }
  // S10: the layout and display menu. An unknown option stops the build.
  refused((c) => { c.layout = 'carousel'; }, /^layout/m, 'an unknown layout');
  refused((c) => { c.stationOrder = 'random'; }, /^stationOrder/m, 'an unknown station order');
  refused((c) => { c.display = 'billboard'; }, /^display/m, 'an unknown display');
  refused((c) => { c.sections = { surprise: false }; }, /^sections/m, 'an unknown section');
  refused((c) => { c.sections = { reports: 'no' }; }, /^sections\.reports/m, 'a section switch that is not true or false');
  refused((c) => { c.sections = { sources: false }; }, /sources cannot be hidden/, 'hidden sources');
  for (const o of [{ layout: 'dial' }, { layout: 'list' }, { layout: 'grid' }, { stationOrder: 'next-event' }, { display: 'tv' }, { sections: { values: false, scatter: false, reports: false, schedule: false, sources: true } }]) {
    if (m.schema.creatorProblems({ ...sample(), ...o }, catalog()).length) out.push(`refused the menu option ${JSON.stringify(o)}`);
  }
  // S5: a schedule row names a linked event.
  refused((c) => { c.schedule.rows[1][4] = 'evt_sample-9999'; }, /schedule\.rows\.1/, 'a schedule row naming an unlinked event');
  return out;
}

/** Design system: no colour value lives in the renderer; colours come from theme.css. */
export function hexProblems(source) {
  return (source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => `colour value ${h} in the renderer`);
}

// ── 3. Unit ───────────────────────────────────────────────────────────────────
export function totalProblems(m) {
  const { SHAPES, expectedTotal, scansFor } = m.showcase;
  const out = [];
  const want = { high: [66, 66], medium: [30, 27], low: [21, 19] };
  for (const [k, [sent, total]] of Object.entries(want)) {
    if (scansFor(SHAPES[k]) !== sent) out.push(`${k} sends ${scansFor(SHAPES[k])}, want ${sent}`);
    if (expectedTotal(SHAPES[k]) !== total) out.push(`${k} reports ${expectedTotal(SHAPES[k])}, want ${total}`);
  }
  return out;
}

export function bucketProblems(m) {
  const out = [];
  for (const [k, shape] of Object.entries(m.showcase.SHAPES)) {
    const b = m.showcase.hourBuckets(shape, '2026-11-01');
    const sum = b.reduce((a, x) => a + x.n, 0);
    if (sum !== m.showcase.scansFor(shape)) out.push(`${k} buckets sum to ${sum}`);
    if (b.some((x) => !/^2026-11-01T\d{2}:00$/.test(x.bucket))) out.push(`${k} has a malformed bucket`);
    if (new Set(b.map((x) => x.bucket)).size !== b.length) out.push(`${k} repeats an hour`);
  }
  return out;
}

/** Pacing: with a fake clock, no 61-second window ever holds more than 50 scans. */
export async function pacingProblems(m) {
  let t = 0;
  const sent = [];
  const paced = m.showcase.createPacer({ now: () => t, sleep: async (ms) => { t += ms; } });
  for (let i = 0; i < 130; i++) {
    await paced();
    sent.push(t);
    t += 100; // a scan takes 100 ms
  }
  let worst = 0;
  for (let i = 0; i < sent.length; i++) worst = Math.max(worst, sent.filter((s) => s >= sent[i] && s - sent[i] <= 61_000).length);
  return worst > m.showcase.PER_MINUTE ? [`${worst} scans in one 61 s window (limit ${m.showcase.PER_MINUTE})`] : [];
}

export function mergeProblems(m) {
  const stations = m.showcase.mergeStations(sample(), catalog().categories, seededReports());
  const out = [];
  const teach = stations.find((s) => s.id === 'teach');
  if (teach.freq !== 89.1 || teach.name !== 'Teach') out.push('catalog defaults did not fill freq and name');
  const own = m.showcase.mergeStations({ stations: [{ ...sample().stations[0], name: 'Own name', freq: 90.3 }] }, catalog().categories);
  if (own[0].name !== 'Own name' || own[0].freq !== 90.3) out.push("the creator's copy did not win over the catalog");
  if (teach.reportCopy !== sample().stations[0].report) out.push('the station copy about its report was lost');
  if (teach.report?.distinctScanners !== 27) out.push('the station report was not attached');
  if ('reportPath' in (teach.report ?? {})) out.push('a merged station carries its signed report link');
  if (stations.find((s) => s.id === 'lead').report !== null) out.push('a station with no event got a report');
  return out;
}

export function dateProblems(m) {
  const got = m.showcase.fmtDate('2026-11-13');
  return got === '13 Nov 2026' ? [] : [`fmtDate gave ${got}`];
}

const ev = (startsAt, timezone = 'America/Chicago', extra = {}) => ({ startsAt, timezone, startDate: startsAt.slice(0, 10), endDate: startsAt.slice(0, 10), ...extra });

/** Slots: cadence, day, week of the month and time, read in the slot's own timezone. */
export function slotProblems(m) {
  const S = m.schedule;
  const out = [];
  const weekly = { cadence: 'weekly', day: 'thursday', time: '18:00', timezone: 'America/Chicago', mode: 'online', kind: 'class' };
  const cases = [
    [weekly, ev('2026-11-20T00:00:00Z'), true, 'Thursday 6 pm Chicago (Friday 00:00 UTC)'],
    [weekly, ev('2026-11-19T18:00:00Z'), false, 'Thursday 18:00 UTC (12 pm in Chicago)'],
    [weekly, ev('2026-11-18T00:00:00Z'), false, 'a Tuesday evening'],
    [{ ...weekly, cadence: 'daily-weekdays', day: undefined }, ev('2026-11-17T00:00:00Z'), true, 'a weekday at 6 pm'],
    [{ ...weekly, cadence: 'daily-weekdays', day: undefined }, ev('2026-11-22T00:00:00Z'), false, 'a Saturday at 6 pm'],
    [{ ...weekly, cadence: 'monthly', week: 'first', day: 'saturday', time: '10:00' }, ev('2026-12-05T16:00:00Z'), true, 'the first Saturday of December'],
    [{ ...weekly, cadence: 'monthly', week: 'first', day: 'saturday', time: '10:00' }, ev('2026-11-07T16:00:00Z'), true, 'the first Saturday of November, on the 7th'],
    [{ ...weekly, cadence: 'monthly', week: 'first', day: 'saturday', time: '10:00' }, ev('2026-12-12T16:00:00Z'), false, 'the second Saturday of December'],
    [{ ...weekly, cadence: 'monthly', week: 'second', day: 'saturday', time: '10:00' }, ev('2026-12-12T16:00:00Z'), true, 'the second Saturday of December'],
    [{ ...weekly, cadence: 'monthly', week: 'last', day: 'sunday', time: '12:00' }, ev('2026-11-29T18:00:00Z'), true, 'the last Sunday of November'],
    [{ ...weekly, cadence: 'monthly', week: 'last', day: 'sunday', time: '12:00' }, ev('2026-11-22T18:00:00Z'), false, 'the fourth but not last Sunday'],
    [{ cadence: 'as-announced', mode: 'online', kind: 'class' }, ev('2026-11-22T18:00:00Z'), true, 'any date, as announced'],
  ];
  for (const [slot, e, want, what] of cases) if (S.slotMatches(slot, e) !== want) out.push(`slotMatches is ${!want} for ${what}`);
  const texts = [
    [weekly, 'Every Thursday, 6 pm (Chicago time) · Online · class'],
    [{ ...weekly, cadence: 'monthly', week: 'first', day: 'saturday', time: '10:30', mode: 'in_person', purpose: 'the monthly workshop' }, 'First Saturday of the month, 10:30 am (Chicago time) · In person · class · the monthly workshop'],
    [{ cadence: 'daily-weekdays', time: '12:00', timezone: 'Europe/London', mode: 'both', kind: 'set' }, 'Mondays to Fridays, 12 pm (London time) · Online and in person · set'],
    [{ cadence: 'as-announced', mode: 'online', kind: 'class' }, 'As announced · Online · class'],
  ];
  for (const [slot, want] of texts) if (S.onAirText(slot) !== want) out.push(`onAirText gave "${S.onAirText(slot)}", want "${want}"`);
  for (const [t, want] of [['00:00', '12 am'], ['09:05', '9:05 am'], ['12:00', '12 pm'], ['17:30', '5:30 pm']]) if (S.fmtTime(t) !== want) out.push(`fmtTime(${t}) = ${S.fmtTime(t)}`);
  return out;
}

/** Past, today and the pop-up window. */
export function timeProblems(m) {
  const S = m.schedule;
  const out = [];
  const now = Date.parse('2026-11-16T15:00:00Z'); // 9 am in Chicago
  if (S.isPast(ev('2026-11-16T23:00:00Z'), now) !== false) out.push('an event later today reads as past');
  if (S.isPast(ev('2026-11-15T23:00:00Z'), now) !== true) out.push('yesterday reads as upcoming');
  if (S.isPast({ startDate: '2026-11-14', endDate: '2026-11-17', timezone: 'UTC' }, now) !== false) out.push('an event on its last day reads as past');
  const popup = S.whenText(ev('2026-11-21T18:00:00Z'), { intent: 'pop-up', until: '15:00' });
  if (popup !== 'Sat, 21 Nov 2026, 12 pm to 3 pm (Chicago time)') out.push(`a pop-up reads "${popup}"`);
  if (S.whenText({ startDate: '2026-11-21', timezone: 'UTC' }) !== 'Sat, 21 Nov 2026') out.push('a date-only event shows a time');
  return out;
}

/**
 * The four intents (owner, 2026-11-12): only a programme event stands under
 * "On air"; a one-off, pop-up or trial never does, and never gets a "next".
 * A programme event off every slot, a pop-up with no start time and a mode that
 * differs from its slot each stop the build. Frequency decides where an event shows.
 */
export async function intentProblems(m) {
  const S = m.schedule;
  const out = [];
  const ose = await sampleOse(m);
  const teach = sample().stations[0];
  const t = S.stationSchedule(teach, ose.linked, NOW);
  if (t.problems.length) out.push(`the fixture's teach schedule has problems: ${t.problems[0]}`);
  const nexts = t.onAir.map((o) => o.next?.link.oseEventId ?? null);
  if (nexts[0] !== 'evt_sample-0001') out.push(`the weekly slot's next is ${nexts[0]}, want evt_sample-0001`);
  if (nexts[1] !== null) out.push(`the monthly slot's next is ${nexts[1]}, want none (to be announced)`);
  // Move the trial onto the weekly slot's own day and time: it still never stands under On air.
  // It goes first, so a sort that let it stand under On air would pick it over
  // the programme event at the same time.
  const moved = ose.linked
    .filter((x) => x.link.intent === 'trial')
    .map((x) => ({ ...x, event: { ...x.event, startsAt: '2026-11-20T00:00:00Z', startDate: '2026-11-19', endDate: '2026-11-19' } }));
  const trialOnSlot = [...moved, ...ose.linked.filter((x) => x.link.intent !== 'trial')];
  const firstWeekly = S.stationSchedule(teach, trialOnSlot, NOW).onAir[0].next?.link.intent;
  if (firstWeekly !== 'programme') out.push(`a ${firstWeekly} stood under On air`);
  const order = t.upcoming.map((x) => x.event.startsAt);
  if (order.join() !== [...order].sort().join()) out.push('upcoming events are not soonest first');
  if (t.upcoming.some((x) => x.link.frequency !== 'teach' && !(x.link.also ?? []).includes('teach'))) out.push('teach lists an event that is not on it');
  const lead = S.stationSchedule(sample().stations[2], ose.linked, NOW, { isLead: true });
  if (!lead.upcoming.some((x) => x.link.frequency === 'wear') || !lead.upcoming.some((x) => x.link.frequency === 'teach')) out.push('Lead does not show the whole dial');
  const offSlot = ose.linked.map((x) => (x.link.oseEventId === 'evt_sample-0001' ? { ...x, event: { ...x.event, startsAt: '2026-11-19T01:00:00Z' } } : x));
  if (!S.stationSchedule(teach, offSlot, NOW).problems.some((p) => /matches none/.test(p))) out.push('a programme event off every slot was accepted');
  const noTime = ose.linked.map((x) => (x.link.intent === 'pop-up' ? { ...x, event: { ...x.event, startsAt: null } } : x));
  if (!S.stationSchedule(sample().stations[1], noTime, NOW).problems.some((p) => /pop-up needs a start time/.test(p))) out.push('a pop-up with no start time was accepted');
  const inPerson = ose.linked.map((x) => (x.link.oseEventId === 'evt_sample-0001' ? { ...x, event: { ...x.event, attendanceMode: 'in_person' } } : x));
  if (!S.stationSchedule(teach, inPerson, NOW).problems.some((p) => /differs from its slot/.test(p))) out.push("an event whose mode differs from its slot's was accepted");
  // A past event is not on the page, so a programme that has since moved never stops the build.
  const moved4 = ose.linked.map((x) => (x.link.oseEventId === 'evt_sample-0004' ? { ...x, event: { ...x.event, startsAt: '2026-11-10T01:00:00Z', startDate: '2026-11-09', endDate: '2026-11-09' } } : x));
  const pastOff = S.stationSchedule(teach, moved4, NOW).problems;
  if (pastOff.length) out.push(`a past programme event off today's slots stopped the build: ${pastOff[0]}`);
  const pastPopup = ose.linked.map((x) => (x.link.intent === 'pop-up' ? { ...x, event: { ...x.event, startsAt: null, startDate: '2026-11-07', endDate: '2026-11-07' } } : x));
  const pastNoTime = S.stationSchedule(sample().stations[1], pastPopup, NOW).problems;
  if (pastNoTime.length) out.push(`a past pop-up with no start time stopped the build: ${pastNoTime[0]}`);
  return out;
}

/** Every programme event carries its slot's purpose as its Why, not only the slot's next one. */
export async function slotWhyProblems(m) {
  const html = (await samplePages(m))['teach/index.html'];
  const n = (html.match(/<span class="label">Why<\/span>the evening room<\/p>/g) ?? []).length;
  return n === 2 ? [] : [`${n} teach events read the weekly slot's purpose as their Why, want 2`];
}

/** The creator page's When list runs in the same order as every station page: soonest first. */
export async function dialOrderProblems(m) {
  const ose = await sampleOse(m);
  // A date-only event on the pop-up's Saturday ends that day, so it comes after the pop-up's noon start.
  const sat = ose.linked.find((x) => x.link.oseEventId === 'evt_sample-0005').event.startDate;
  const linked = ose.linked.map((x) => (x.link.oseEventId === 'evt_sample-0006' ? { ...x, event: { ...x.event, startsAt: null, startDate: sat, endDate: sat } } : x));
  const pages = m.render.renderPages({ creator: sample(), catalog: catalog().categories, reports: seededReports(), theme: '', ose: { ...ose, linked }, now: NOW });
  const titles = (html, re) => [...html.matchAll(re)].map((x) => x[1]);
  const dial = titles(pages['index.html'].match(/<dt>When<\/dt><dd>([\s\S]*?)<\/dd>/)?.[1] ?? '', /<li>[^<]*?: ([^<]+?) \(<a /g);
  const lead = titles(pages['lead/index.html'], /<h3 id="ev-\d+">([^<]+)<\/h3>/g).slice(0, 5);
  return dial.join(' | ') === lead.join(' | ') ? [] : [`the dial lists ${dial.join(' | ')}; the stations list ${lead.join(' | ')}`];
}

/** "On air" is built from slot fields only: no text read from OSE reaches it. */
export async function onAirTextProblems(m) {
  const ose = await sampleOse(m, { edit: (k, b) => { if (k === 'event') b.item.title = b.item.name = 'PLANTEDTITLE'; return b; } });
  const html = m.render.renderPages({ creator: sample(), catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW })['teach/index.html'];
  const block = html.match(/<ul class="onair-list"[\s\S]*?<\/ul>/)?.[0] ?? '';
  const out = [];
  if (!block) out.push('the teach page has no On air list');
  if (/PLANTEDTITLE/.test(block)) out.push('an OSE title reached the On air list');
  if (!/Next date to be announced/.test(block)) out.push('a slot with no upcoming event does not say "Next date to be announced"');
  if (!/<span class="tag intent">Trying this out<\/span>/.test(html)) out.push('the trial does not read "Trying this out"');
  if (!/<span class="tag intent">On air<\/span>/.test(html)) out.push('a programme event does not read "On air"');
  const wear = m.render.renderPages({ creator: sample(), catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW })['wear/index.html'];
  if (!/<span class="tag intent">One time only<\/span>/.test(wear)) out.push('the one-off does not read "One time only"');
  if (!/<span class="tag intent">Pop-up<\/span>[\s\S]*?to 3 pm/.test(wear)) out.push('the pop-up does not read as a pop-up with its window');
  return out;
}

/** S5: a schedule row that is now an OSE event leaves the copied table; the rest stay, labelled copied. */
export async function retireProblems(m) {
  const html = (await samplePages(m))['index.html'];
  const table = html.match(/aria-label="Copied schedule"[\s\S]*?<\/table>/)?.[0] ?? '';
  const out = [];
  if (!table) out.push('the copied schedule is gone while it still has unlinked rows');
  if (table.includes('Launch evening')) out.push('a row that is an OSE event is still in the copied table');
  if (!table.includes('Winter repair cafe')) out.push('an unlinked row left the copied table');
  if (!/Copied from example\.com/.test(html)) out.push('the copied rows are not labelled as copied');
  const allLinked = sample();
  allLinked.schedule.rows = [allLinked.schedule.rows[1]];
  const ose = await sampleOse(m);
  const none = m.render.renderPages({ creator: allLinked, catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW })['index.html'];
  if (none.includes('Copied schedule')) out.push('an all-linked schedule still shows a copied table');
  return out;
}

/** One page per station plus the creator page, each with exactly one <h1>, linked through the tuner. */
export async function pageSetProblems(m) {
  const pages = await samplePages(m);
  const out = [];
  const want = ['index.html', ...sample().stations.map((s) => `${s.id}/index.html`)];
  if (Object.keys(pages).sort().join() !== want.sort().join()) out.push(`pages ${Object.keys(pages).join(', ')}`);
  for (const [p, html] of Object.entries(pages)) {
    const h1 = (html.match(/<h1\b/g) ?? []).length;
    if (h1 !== 1) out.push(`${p} has ${h1} <h1>`);
    if (p !== 'index.html' && !html.includes(`href="../${p}" aria-current="page"`)) out.push(`${p} does not mark itself in the tuner`);
    for (const w of ['Who', 'What', 'When', 'Where', 'How']) if (!html.includes(`<dt>${w}</dt>`)) out.push(`${p} has no ${w}`);
  }
  return out;
}

/** A demo event's codes hang under its own labels when it names any, else under its size's. */
export function placementLabelProblems(m) {
  const { placementsFor, SHAPES } = m.showcase;
  const out = [];
  const own = placementsFor({ demo: 'low', placements: ['Door card', 'Bar mat'] });
  if (own.join('|') !== 'Door card|Bar mat') out.push(`a station's own labels became ${own.join(', ')}`);
  for (const k of Object.keys(SHAPES)) {
    if (placementsFor({ demo: k }).join('|') !== SHAPES[k].placements.join('|')) out.push(`${k}: no labels given, but not the size's labels`);
  }
  const wear = sample().stations.find((s) => s.id === 'wear');
  if (placementsFor(wear.event).join('|') !== wear.event.placements.join('|')) out.push("the fixture's own labels are not used");
  return out;
}

/**
 * The fixed sentences fit any instance: they use its name where they said "the
 * creator", and its own event kinds where they listed "class, set or game night".
 */
export async function instanceWordingProblems(m) {
  const out = [];
  // What a visitor reads: no style or script, no tags.
  const page = (creator) => m.render.renderPages({ creator, catalog: catalog().categories, reports: seededReports(), theme: '', now: NOW })['index.html']
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // No linked events (no OSE needed), and no "creator" in the file's own copy: what is left is the fixed text.
  const strip = (creator) => {
    for (const k of ['events', 'campaigns']) delete creator[k];
    creator.sponsorship.title = 'Sponsors, by choice.';
    return creator;
  };
  const sam = page(strip(sample()));
  if (/\bthe creator\b/i.test(sam)) out.push('a fixed sentence still says "the creator"');
  if (/class, set or game night|which class, which game night/i.test(sam)) out.push('a fixed sentence still lists kinds the instance may not run');
  if (!sam.includes('Sam Sample picks the placement')) out.push('the placement rule does not name the instance');
  if (!sam.includes("this week's class, workshop or pop-up.")) out.push("the fixture's own kinds are not listed in station order");
  // An instance with one kind reads that kind alone; one with none reads "event".
  const bar = strip(sample());
  bar.name = 'The Corner Bar';
  bar.stations = bar.stations.filter((s) => s.id !== 'teach');
  const barPage = page(bar);
  if (!barPage.includes("this week's pop-up.")) out.push('a one-kind instance does not read its one kind');
  if (!barPage.includes('The Corner Bar has accepted')) out.push('the consent rule does not name the instance');
  if (/this week's [^.]*\b(class|workshop)\b/.test(barPage) || /Which [^.]*\b(class|workshop)\b[^.]* carries which sponsor/.test(barPage)) out.push('a kind the instance does not run reached a fixed sentence');
  const none = strip(sample());
  for (const s of none.stations) { s.event = null; delete s.programme; }
  if (!page(none).includes("this week's event.")) out.push('an instance with no kinds does not read "event"');
  return out;
}

const text = (html) => html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const pagesWith = async (m, over, edit) => {
  const creator = { ...sample(), ...over };
  edit?.(creator);
  const ose = await sampleOse(m, { creator });
  return m.render.renderPages({ creator, catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW });
};
const channelIds = (html) => [...(html.match(/<ul class="channels[^"]*"[\s\S]*?<\/ul>/)?.[0] ?? '').matchAll(/href="(?:\.\.\/)?([a-z0-9-]+)\/index\.html"/g)].map((x) => x[1]);

/** S10 layout: the same station links as a dial, a list or a grid; the default is the dial. */
export async function layoutProblems(m) {
  const out = [];
  const ids = sample().stations.map((s) => s.id);
  const plain = await pagesWith(m, {});
  for (const layout of ['dial', 'list', 'grid']) {
    const pages = await pagesWith(m, { layout });
    for (const [p, html] of Object.entries(pages)) {
      if (channelIds(html).join() !== ids.join()) out.push(`${layout} ${p}: station links ${channelIds(html).join(', ')}`);
      if ((html.match(/<h1\b/g) ?? []).length !== 1) out.push(`${layout} ${p}: not one <h1>`);
      const dial = /<svg class="dial"/.test(html);
      if ((layout === 'dial') !== dial) out.push(`${layout} ${p}: ${dial ? 'draws' : 'does not draw'} the dial`);
      if (layout !== 'dial' && !html.includes(`<ul class="channels ${layout}"`)) out.push(`${layout} ${p}: the stations are not laid out as a ${layout}`);
      if (layout !== 'dial' && !/<span class="t">Evening workshops<\/span>/.test(html)) out.push(`${layout} ${p}: a station does not carry its title`);
      if (p !== 'index.html' && !html.includes(`href="../${p}" aria-current="page"`)) out.push(`${layout} ${p}: does not mark itself`);
    }
    if (layout === 'dial' && JSON.stringify(pages) !== JSON.stringify(plain)) out.push('a file with no layout is not the dial');
  }
  return out;
}

/** S10 station order: the file's order by default; by next event when asked, Lead last, the empty after the busy. */
export async function stationOrderProblems(m) {
  const out = [];
  const reversed = (c) => { c.stations = [c.stations[1], c.stations[0], c.stations[2]]; };
  const file = await pagesWith(m, {}, reversed);
  if (channelIds(file['index.html']).join() !== 'wear,teach,lead') out.push(`file order reads ${channelIds(file['index.html']).join()}`);
  const next = await pagesWith(m, { stationOrder: 'next-event' }, reversed);
  // The fixture's soonest event is a teach trial (Tuesday); wear's first is Saturday.
  for (const [p, html] of Object.entries(next)) if (channelIds(html).join() !== 'teach,wear,lead') out.push(`next-event ${p} reads ${channelIds(html).join()}`);
  const quiet = await pagesWith(m, { stationOrder: 'next-event' }, (c) => { c.events = c.events.filter((e) => e.frequency !== 'teach'); c.schedule.rows = c.schedule.rows.map((r) => r.slice(0, 4)); });
  if (channelIds(quiet['index.html']).join() !== 'wear,teach,lead') out.push(`a station with nothing upcoming is not after the busy ones: ${channelIds(quiet['index.html']).join()}`);
  return out;
}

/** S10 sections: each switch hides its own section and nothing else. */
export async function sectionProblems(m) {
  const out = [];
  const marks = {
    values: (p) => text(p['index.html']).includes(sample().values.body),
    scatter: (p) => p['index.html'].includes('id="scatter-title"'),
    reports: (p) => Object.values(p).some((h) => /class="shot|aria-label="People per station"|Demo visitors/.test(h)),
    schedule: (p) => p['index.html'].includes('id="now-title"'),
  };
  const all = await pagesWith(m, {});
  for (const [k, on] of Object.entries(marks)) if (!on(all)) out.push(`${k} is not on the default page`);
  for (const k of Object.keys(marks)) {
    const pages = await pagesWith(m, { sections: { [k]: false } });
    for (const [other, on] of Object.entries(marks)) {
      if (other === k && on(pages)) out.push(`${k} is switched off and still shows`);
      if (other !== k && !on(pages)) out.push(`${other} went when only ${k} was switched off`);
    }
    for (const html of Object.values(pages)) if (!html.includes('<span class="eyebrow">Sources</span>')) out.push(`sources went with ${k}`);
  }
  const bare = await pagesWith(m, { sections: { values: false, reports: false } });
  if (bare['index.html'].includes('id="reports-title"')) out.push('the reporting section shows with nothing in it');
  return out;
}

/** S11 TV board: built only when asked; events and codes, no counts; a hold, a pause and a dwell a viewer can read in. */
export async function tvProblems(m) {
  const out = [];
  if ((await pagesWith(m, {}))['tv/index.html']) out.push('a TV board is built without display: tv');
  const pages = await pagesWith(m, { display: 'tv' });
  const tv = pages['tv/index.html'];
  if (!tv) return ['display: tv builds no TV board'];
  if ((tv.match(/<h1\b/g) ?? []).length !== 1) out.push('the TV board has not one <h1>');
  const panels = [...tv.matchAll(/<section class="panel" aria-labelledby="[^"]*" data-dwell="(\d+)">([\s\S]*?)<\/section>/g)];
  if (panels.length !== 2) out.push(`${panels.length} panels, want teach and wear`);
  if (/Every frequency in one view|class="tuner"/.test(tv)) out.push('Lead or the tuner is on the TV board');
  // No counts on a display: no report, no report image, no floor text, no placement labels.
  if (/class="shot|<img|scanners|Fewer than|Table card|Clip link|People per station/.test(tv)) out.push('a report or a count is on the TV board');
  // Its codes are station-page codes, and no more than two events a panel.
  const codes = (h) => [...h.matchAll(/data-code-url="([^"]*)"/g)].map((x) => x[1]);
  const pageCodes = new Set(['teach', 'wear'].flatMap((s) => codes(pages[`${s}/index.html`])));
  if (!codes(tv).length) out.push('the TV board shows no code');
  for (const u of codes(tv)) if (!pageCodes.has(u)) out.push(`the TV board shows a code no station page has: ${u}`);
  for (const [, dwell, body] of panels) {
    if ((body.match(/<article class="event"/g) ?? []).length > 2) out.push('a panel shows more than two events');
    const words = body.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    const want = Math.max(14, Math.ceil(5 + words * 0.6));
    if (Number(dwell) !== want) out.push(`a ${words}-word panel stays up ${dwell} s, want ${want}`);
  }
  if (m.render.dwellSeconds(0) !== 14 || m.render.dwellSeconds(30) !== 23 || m.render.dwellSeconds(50) !== 35) out.push('the dwell is not 3 s + reading at 100 words a minute + 2 s');
  // The hold and the pause: a rotating code must be holdable (guideline 70), and rotation pausable (WCAG 2.2.2).
  if (m.render.HOLD_SECONDS < 20) out.push(`a touch holds the panel ${m.render.HOLD_SECONDS} s, want at least 20`);
  if (!/var HOLD = (\d+);/.test(tv) || Number(tv.match(/var HOLD = (\d+);/)[1]) !== m.render.HOLD_SECONDS) out.push('the page does not carry the hold');
  if (!/<button type="button" class="tv-pause" aria-pressed="false" hidden>Pause<\/button>/.test(tv)) out.push('the TV board has no Pause button');
  if (!/addEventListener\("keydown", hold\)/.test(tv) || !/addEventListener\("pointerdown", hold\)/.test(tv)) out.push('a key or a tap does not hold the panel');
  if (!/prefers-reduced-motion: reduce\)"\)\.matches\) return;/.test(tv)) out.push('reduced motion does not stop the rotation');
  if (!tv.includes('.panel[hidden] { display: none; }')) out.push('a hidden panel would still show');
  return out;
}

// ── Partners (S9) and the calendar feed (S8 follow-up) ───────────────────────
const SPONSOR = 'Corner hardware (showcase demo)';
const CAMPAIGN = 'Winter tables (showcase demo)';
const cardsOf = (html) => html.match(/<article class="event"[\s\S]*?<\/article>/g) ?? [];
const stopped = async (run, want) => {
  try {
    await run();
  } catch (e) {
    return want.test(e.message) ? null : e.message;
  }
  return 'no error';
};

/**
 * Sponsors on an event card: only what OSE's public bundle lists, below the
 * title and date and above the rest, as text and never a control, and nothing
 * of a sponsor but its name leaves the bundle.
 */
export async function sponsorProblems(m) {
  const out = [];
  const calls = [];
  const ose = await sampleOse(m, { calls });
  const render = (o = ose, creator = sample()) => m.render.renderPages({ creator: { ...creator, display: 'tv' }, catalog: catalog().categories, reports: seededReports(), theme: '', ose: o, now: NOW });
  const pages = render();
  const all = Object.values(pages).join('\n');

  // Where the strip sits.
  const wear = cardsOf(pages['wear/index.html']);
  if (!wear.some((c) => c.includes(SPONSOR))) out.push('wear: the consented sponsor is not on its event');
  for (const [path, html] of Object.entries(pages)) {
    for (const card of cardsOf(html)) {
      const at = card.indexOf('class="backers"');
      if (at < 0) continue;
      const title = card.indexOf('</h3>');
      const when = card.indexOf('<span class="label">When</span>');
      const rest = ['Where', 'What', 'Host', 'Why', 'How'].map((l) => card.indexOf(`<span class="label">${l}</span>`)).filter((i) => i >= 0);
      const codes = card.indexOf('class="codes"');
      if (title < 0 || at < title) out.push(`${path}: a sponsor strip above the event title`);
      if (when < 0 || at < when) out.push(`${path}: a sponsor strip above the event date`);
      if (rest.some((i) => i < at) || (codes >= 0 && codes < at)) out.push(`${path}: a sponsor strip below the event's content`);
    }
  }

  // Only what the bundle lists: one side's yes is not enough, and a past event is never read.
  for (const name of ['Waiting cafe', 'Unsure bakery', "Last week's partner"]) if (all.includes(name)) out.push(`"${name}" reached a page`);
  if (!all.includes('Print shop (showcase demo)')) out.push('a sponsor with no campaign is missing from its event');
  if (calls.some((c) => /evt_sample-0004\/sponsor-bundle/.test(c.url))) out.push("a past event's sponsors were read");
  const reads = calls.filter((c) => /\/sponsor-bundle/.test(c.url));
  if (reads.some((c) => !c.url.endsWith('/sponsor-bundle?surface=public'))) out.push('a sponsor read that is not the public surface');

  // A station with no linked event shows no sponsor; nor does any page when OSE lists none.
  for (const [path, html] of Object.entries(pages)) {
    if (!cardsOf(html).length && /class="(backers|partners)"/.test(html) && path !== 'tv/index.html') out.push(`${path}: a sponsor on a page with no event`);
  }
  const none = render(await sampleOse(m, { edit: (k, b) => { if (k === 'sponsors') b.bundle.sponsors = []; return b; } }));
  if (/class="(backers|partners)"/.test(Object.values(none).join('\n'))) out.push('a sponsor shows though OSE lists none');
  if (Object.values(none).join('\n').includes(SPONSOR)) out.push('a sponsor name shows though OSE lists none');

  // Nothing but a name (and a campaign) leaves the bundle, and no beacon is ever fired.
  for (const [what, re] of [
    ['a beacon token', /\bbt_sb_/], ['a click token', /\bct_sb_/], ['a display token', /\bdt_sb_/], ['a sponsor website', /partner\.example\.org/],
    ['a sponsor logo', /\/sponsors\/[^"'\s]*\/logo/], ['a sponsor card link', /\/sponsors\/sb_/], ['an impression beacon', /\/impression\b/], ['a click beacon', /\/click\b/], ['a sponsor tier', /\bgold\b/],
  ]) {
    if (re.test(all)) out.push(`${what} reached a page`);
  }
  for (const x of ose.linked) for (const sp of x.sponsors) for (const k of Object.keys(sp)) if (!['id', 'title', 'campaign'].includes(k)) out.push(`the build kept a sponsor's ${k}`);

  // The one link is the event's own SPONSOR /s/ code.
  const withCode = wear.find((c) => c.includes(SPONSOR) && c.includes('class="codes"'));
  const strip = (card) => card?.match(/<p class="backers">[\s\S]*?<\/p>/)?.[0] ?? '';
  const href = strip(withCode).match(/<a href="([^"]*)"/)?.[1];
  if (href !== `${FAKE_ORIGIN}/s/Sp0005`) out.push(`the sponsor link is ${href ?? 'missing'}, not the event's SPONSOR code`);
  const noCode = wear.find((c) => c.includes('Launch evening'));
  if (!strip(noCode).includes(SPONSOR)) out.push('the event with no SPONSOR code lost its sponsor');
  if (/<a /.test(strip(noCode))) out.push('a sponsor link on an event with no SPONSOR code');

  // A sponsor is never a control: nobody filters, searches or sorts by it.
  if (/<(input|select|option|datalist|button|label|form|textarea)\b[^>]*>[^<]*(Corner hardware|Print shop|Winter tables)/i.test(all)) out.push('a sponsor name inside a control');
  if (/<(input|select|option|datalist|button|label|form|textarea)\b[^>]*(Corner hardware|Print shop|Winter tables)/i.test(all)) out.push('a sponsor name on a control');

  // A sponsor list that cannot be read stops the build; so does one that names the creator.
  const lost = await stopped(() => sampleOse(m, { fail: (k) => (k === 'sponsors' ? 503 : null) }), /sponsor bundle answered 503/);
  if (lost) out.push(`a sponsor bundle that answered 503 did not stop the build (${lost})`);
  const shapeless = await stopped(() => sampleOse(m, { edit: (k, b) => { if (k === 'sponsors') delete b.bundle; return b; } }), /sponsor bundle answered 200/);
  if (shapeless) out.push(`a sponsor bundle with no list did not stop the build (${shapeless})`);
  for (const [what, plant] of [
    ['a sponsor named after her', (b) => { b.bundle.sponsors[0].title = 'Sam Sample Hardware'; }],
    ['a campaign named after her', (b) => { b.bundle.sponsors[0].campaign = { id: 'cmp_x', title: 'Sample Studio season' }; }],
  ]) {
    const named = await stopped(() => sampleOse(m, { edit: (k, b) => { if (k === 'sponsors' && b.bundle.sponsors.length) plant(b); return b; } }), /not neutral/);
    if (named) out.push(`the build read ${what} without stopping (${named})`);
  }
  return out;
}

/** A station's campaign partner: once, at the top, only where the creator file and OSE agree. */
export async function partnerProblems(m) {
  const out = [];
  const ose = await sampleOse(m);
  const render = (creator = sample(), o = ose) => m.render.renderPages({ creator: { ...creator, display: 'tv' }, catalog: catalog().categories, reports: seededReports(), theme: '', ose: o, now: NOW });
  const lists = (html) => html.match(/<ul class="partners"[\s\S]*?<\/ul>/g) ?? [];
  const pages = render();
  const wear = pages['wear/index.html'];

  // Once, though two of the station's events list it; in the hero, before the events.
  const mine = lists(wear);
  if (mine.length !== 1) out.push(`wear: ${mine.length} partner lists, want 1`);
  const items = (mine[0] ?? '').match(/<li>/g) ?? [];
  if (items.length !== 1) out.push(`wear: the partner shows ${items.length} times at the top, want once`);
  if (!(mine[0] ?? '').includes(SPONSOR) || !(mine[0] ?? '').includes(CAMPAIGN)) out.push('wear: the partner or its campaign is not named');
  const at = wear.indexOf('<ul class="partners"');
  if (at < 0 || at < wear.indexOf('</h1>') || at > wear.indexOf('<nav class="tuner"') || at > wear.indexOf('<article class="event"')) out.push('wear: the partner is not at the top of the station');
  // Its link is the SPONSOR code of the soonest event that lists it.
  const href = (mine[0] ?? '').match(/<a href="([^"]*)"/)?.[1];
  if (href !== `${FAKE_ORIGIN}/s/Sp0005`) out.push(`wear: the partner link is ${href ?? 'missing'}, not the soonest event's SPONSOR code`);

  // Only on the frequency the creator file names.
  for (const [path, html] of Object.entries(pages)) {
    if (path !== 'wear/index.html' && path !== 'tv/index.html' && lists(html).length) out.push(`${path}: a partner on a frequency with no campaign`);
  }
  // The TV board names it on its station's panel, with no link to tap.
  const panel = (pages['tv/index.html'].match(/<section class="panel"[\s\S]*?<\/section>/g) ?? []).filter((p) => p.includes('class="partners"'));
  if (panel.length !== 1) out.push(`tv: ${panel.length} panels name a partner, want 1`);
  if (/<ul class="partners"[\s\S]*?<a /.test(panel[0]?.match(/<ul class="partners"[\s\S]*?<\/ul>/)?.[0] ?? '')) out.push('tv: the partner carries a link');

  // The creator file alone never makes a partner: OSE must list it under that campaign.
  const other = sample();
  other.campaigns = [{ frequency: 'wear', oseCampaignId: 'cmp_someone_else' }];
  if (lists(render(other)['wear/index.html']).length) out.push('a campaign OSE does not list made a partner');
  const noLink = sample();
  delete noLink.campaigns;
  const plain = render(noLink)['wear/index.html'];
  if (lists(plain).length) out.push('a partner shows though the creator file links no campaign');
  if (!plain.includes(SPONSOR)) out.push('without the campaign link, the sponsor left its event too');
  const unlisted = await sampleOse(m, { edit: (k, b) => { if (k === 'sponsors') for (const s of b.bundle.sponsors) delete s.campaign; return b; } });
  if (lists(render(sample(), unlisted)['wear/index.html']).length) out.push('a sponsor with no campaign became a station partner');

  // A campaign on Lead is the whole dial's.
  const lead = sample().stations.find((s) => (s.category ?? s.id) === 'lead')?.id;
  if (!lead) out.push('the fixture has no Lead station');
  else {
    const whole = sample();
    whole.campaigns = [{ frequency: lead, oseCampaignId: 'cmp_sample_wear' }];
    const p = render(whole);
    if (lists(p[`${lead}/index.html`]).length !== 1) out.push('a campaign on Lead does not show on Lead');
    if (lists(p['wear/index.html']).length) out.push('a campaign on Lead shows on another station');
  }
  return out;
}

/** The brand's calendar feed: linked only where OSE serves a real one, as a plain link, and held to the neutral rule. */
export async function calendarProblems(m) {
  const out = [];
  const want = `${FAKE_ORIGIN}/brands/showcase-sample/calendar.ics`;
  const render = (ose, creator = sample()) => m.render.renderPages({ creator, catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW });
  const links = (pages) => Object.entries(pages).flatMap(([path, html]) => [...html.matchAll(/<a href="([^"]*calendar\.ics[^"]*)"([^>]*)>/g)].map((x) => ({ path, href: x[1], rest: x[2] })));

  const ose = await sampleOse(m);
  if (ose.calendar !== want) out.push(`the build found ${ose.calendar ?? 'no feed'}, want ${want}`);
  const found = links(render(ose));
  if (found.length !== 1 || found[0].path !== 'index.html') out.push(`${found.length} calendar links (${found.map((f) => f.path).join(', ')}), want one on the creator page`);
  else if (found[0].href !== want || found[0].rest.trim()) out.push(`the calendar link is "${found[0].href}"${found[0].rest}, not the plain feed URL`);

  // Not served, refused at the edge, or not a calendar: left off, and the build goes on.
  for (const [what, opts] of [
    ['a 404', { fail: (k) => (k === 'calendar' ? 404 : null) }],
    ['a 403 challenge', { fail: (k) => (k === 'calendar' ? 403 : null) }],
    ['a page that is not a calendar', { edit: (k, b) => { if (k === 'calendar') b.text = '<!doctype html><title>Just a moment</title>'; return b; } }],
  ]) {
    let o = null;
    try {
      o = await sampleOse(m, opts);
    } catch (e) {
      out.push(`${what} stopped the build: ${e.message.split('\n')[0]}`);
      continue;
    }
    if (o.calendar !== null) out.push(`${what} was taken for a feed`);
    if (links(render(o)).length) out.push(`${what} still put a calendar link on a page`);
    if (o.linked.length !== ose.linked.length) out.push(`${what} changed the events read`);
  }

  // A feed naming the creator stops the build, folded across two lines or not.
  for (const [what, plant] of [
    ['a feed that names her', (b) => { b.text = b.text.replace('SUMMARY:', 'SUMMARY:Class with Sam Sample · '); }],
    ['a feed that names her across a folded line', (b) => { b.text = b.text.replace('SUMMARY:', 'SUMMARY:An evening with Sa\r\n m · '); }],
  ]) {
    const named = await stopped(() => sampleOse(m, { edit: (k, b) => { if (k === 'calendar') plant(b); return b; } }), /calendar feed names/);
    if (named) out.push(`the build read ${what} without stopping (${named})`);
  }

  // A URL that is not the feed's is never drawn, whatever the reader returned.
  for (const bad of [`${FAKE_ORIGIN}/brands/showcase-sample/calendar.ics?utm_source=ourwkrp`, 'javascript:alert(1)', `${FAKE_ORIGIN}/api/v2/admin/events`]) {
    if (links(render({ ...ose, calendar: bad })).length || Object.values(render({ ...ose, calendar: bad })).join('').includes(bad)) out.push(`"${bad}" was drawn as the calendar link`);
  }

  // No events linked: nothing is read, so no feed is listed.
  const calls = [];
  const bare = sample();
  for (const k of ['events', 'campaigns']) delete bare[k];
  bare.schedule.rows = bare.schedule.rows.filter((r) => r.length < 5);
  const none = await sampleOse(m, { creator: bare, calls });
  if (calls.length || none.calendar) out.push('a creator with no events read OSE for a feed');
  return out;
}

// ── Overlap (owner, 2026-11-13) ──────────────────────────────────────────────
/**
 * Stations are a playful way in, not boxes: an event or a campaign may show on
 * more than one. It still has one home, one set of codes and one programme slot,
 * so the play never costs the function.
 */
export async function overlapProblems(m) {
  const out = [];
  const ose = await sampleOse(m);
  const render = (creator = sample(), o = ose) => m.render.renderPages({ creator: { ...creator, display: 'tv' }, catalog: catalog().categories, reports: seededReports(), theme: '', ose: o, now: NOW });
  const pages = render();
  const TITLE = 'Launch evening (showcase demo)';
  const cards = (html) => cardsOf(html).filter((c) => c.includes(`>${TITLE}<`));

  // It shows on both stations, and once on Lead.
  const home = cards(pages['wear/index.html']);
  const guest = cards(pages['teach/index.html']);
  if (home.length !== 1) out.push(`wear shows the event ${home.length} times, want 1`);
  if (guest.length !== 1) out.push(`teach, where it also shows, has it ${guest.length} times, want 1`);
  if (cards(pages['lead/index.html']).length !== 1) out.push(`Lead shows the event ${cards(pages['lead/index.html']).length} times, want 1`);

  // One set of codes, on the station it lives on. Elsewhere the card names that station and links to it.
  if (!/class="codes"/.test(home[0] ?? '')) out.push('the event has no codes on the station it lives on');
  if (/<span class="tag">Wear<\/span>/.test(home[0] ?? '')) out.push('the event is tagged as away on its own station');
  if (/class="codes"|data-code-url/.test(guest[0] ?? '')) out.push('the event shows its codes again on a station it only also shows on');
  if (!/<span class="tag">Wear<\/span>/.test(guest[0] ?? '')) out.push('away from home, the card does not name the station it lives on');
  if (!/<a href="\.\.\/wear\/index\.html">Codes on the Wear page<\/a>/.test(guest[0] ?? '')) out.push('away from home, the card does not link to its codes');
  // Its consented sponsor travels with it.
  if (!(guest[0] ?? '').includes(SPONSOR)) out.push('the event lost its sponsor on the station it also shows on');
  // On a screen in the room nobody can tap through, so the board keeps the codes.
  if (/Codes on the/.test(pages['tv/index.html'])) out.push('the TV board sends a viewer to another page for codes');

  // The front page lists it once, under both stations.
  const when = pages['index.html'].match(/<dt>When<\/dt>[\s\S]*?<\/dd>/)?.[0] ?? '';
  const row = (when.match(/<li>[\s\S]*?<\/li>/g) ?? []).filter((li) => li.includes(TITLE));
  if (row.length !== 1) out.push(`the front page lists the event ${row.length} times, want 1`);
  else if (!/href="wear\/index\.html"/.test(row[0]) || !/href="teach\/index\.html"/.test(row[0])) out.push('the front page does not name both of its stations');

  // A programme event is held to the slots of the station it lives on only, and stands under On air there only.
  const both = sample();
  both.events[0].also = ['wear'];
  let wearPage = null;
  try {
    const built = render(both, await sampleOse(m, { creator: both }));
    wearPage = built['wear/index.html'];
    // The borrowed class is among the two events the board shows for Wear: it keeps its codes there.
    const wearPanel = (built['tv/index.html'].match(/<section class="panel"[\s\S]*?<\/section>/g) ?? []).find((x) => x.includes('100.9'));
    const borrowedCard = cardsOf(wearPanel ?? '').find((c) => c.includes('>Evening class (showcase demo)<'));
    if (!borrowedCard) out.push('the TV board does not show the borrowed class on the Wear panel');
    else if (/Codes on the/.test(borrowedCard) || !/class="codes"/.test(borrowedCard)) out.push('the TV board sends a viewer to another page for a borrowed event\'s codes');
  } catch (e) {
    out.push(`a programme event that also shows elsewhere stopped the build: ${e.message.split('\n')[1] ?? e.message}`);
  }
  if (wearPage && cardsOf(wearPage).length !== 3) out.push(`wear shows ${cardsOf(wearPage).length} events with a class added, want 3`);
  const wearStation = both.stations.find((s) => s.id === 'wear');
  const borrowed = { ...wearStation, programme: sample().stations[0].programme };
  const sched = m.schedule.stationSchedule(borrowed, ose.linked.map((x) => (x.link.oseEventId === 'evt_sample-0001' ? { ...x, link: both.events[0] } : x)), NOW);
  if (sched.onAir.some((o) => o.next)) out.push('an event stood under On air on a station it only also shows on');

  // A campaign may show on more than one station too.
  const wide = sample();
  wide.campaigns = [{ frequency: 'wear', also: ['teach'], oseCampaignId: 'cmp_sample_wear' }];
  const lists = (html) => (html.match(/<ul class="partners"[\s\S]*?<\/ul>/g) ?? []).flatMap((u) => u.match(/<li>/g) ?? []).length;
  const p = render(wide, await sampleOse(m, { creator: wide }));
  if (lists(p['wear/index.html']) !== 1) out.push('a campaign on two stations left the one it lives on');
  if (lists(p['teach/index.html']) !== 1) out.push('a campaign does not show on the station it also names');
  if (lists(pages['teach/index.html']) !== 0) out.push('a campaign shows on a station it does not name');

  // The creator file: `also` names real stations, other than its own and Lead, once each; an event is still linked once.
  const refused = (edit, want, what) => {
    const c = sample();
    edit(c);
    const problems = m.schema.creatorProblems(c, catalog());
    if (!problems.some((x) => want.test(x))) out.push(`${what} was accepted`);
  };
  if (m.schema.creatorProblems(sample(), catalog()).length) out.push(`the fixture, with an event on two stations, is refused: ${m.schema.creatorProblems(sample(), catalog())[0]}`);
  refused((c) => { c.events[5].also = ['nowhere']; }, /events\.5: also "nowhere" is not one of/, 'an event also on an unknown station');
  refused((c) => { c.events[5].also = ['wear']; }, /already its frequency/, 'an event also on its own station');
  refused((c) => { c.events[5].also = ['lead']; }, /is Lead/, 'an event also on Lead');
  refused((c) => { c.events[5].also = ['teach', 'teach']; }, /listed twice/, 'a station listed twice');
  refused((c) => { c.events[5].also = []; }, /events\.5\.also/, 'an empty also');
  refused((c) => { c.events.push({ frequency: 'teach', oseEventId: 'evt_sample-0006', intent: 'one-off' }); }, /linked twice/, 'the same event linked twice');
  refused((c) => { c.campaigns[0].also = ['nowhere']; }, /campaigns\.0: also "nowhere"/, 'a campaign also on an unknown station');
  // A station that only borrows events still has to say why it is on air.
  refused((c) => { c.events = [{ frequency: 'wear', also: ['teach'], oseEventId: 'evt_sample-0006', intent: 'one-off' }]; c.schedule.rows = c.schedule.rows.filter((r) => r.length < 5 || r[4] === 'evt_sample-0006'); delete c.stations[0].why; delete c.stations[0].programme; }, /stations\.teach: a frequency with events or a programme needs its why/, 'a station with only borrowed events and no why');
  return out;
}

// ── Declared series (S15 follow-up) ──────────────────────────────────────────
/**
 * A programme is something the organizer declared in OSE, not only a row in the
 * creator file: an upcoming programme event sits on a declared series, and that
 * series agrees with the slot it stands on. The page shows the series by name.
 */
export async function seriesProblems(m) {
  const out = [];
  const NAME = 'Thursday evening class (showcase demo)';
  const render = (ose, creator = sample()) => m.render.renderPages({ creator, catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW });
  const onEvent = (id, change) => ({ edit: (k, b, eid) => { if (k === 'event' && eid === id) change(b); return b; } });
  const built = async (opts, creator = sample()) => {
    try {
      return { pages: render(await sampleOse(m, { creator, ...opts }), creator) };
    } catch (e) {
      return { error: e.message };
    }
  };

  // What the build keeps: five fields, by name; none for an event on no series.
  const ose = await sampleOse(m);
  const of = (id) => ose.linked.find((x) => x.link.oseEventId === id)?.series;
  const kept = of('evt_sample-0001');
  if (JSON.stringify(kept) !== JSON.stringify({ id: 'ser_sample-0001', name: NAME, cadence: 'weekly', dayOfWeek: 4, hourOfDay: 18 })) out.push(`the build kept ${JSON.stringify(kept)} of the series`);
  if (of('evt_sample-0003') !== null) out.push(`the trial, on no series, reads ${JSON.stringify(of('evt_sample-0003'))}`);

  // The card names the series; an event on none has no such row.
  const base = await built({});
  if (base.error) return [...out, `the fixture did not build: ${base.error.split('\n')[1] ?? base.error}`];
  const teach = cardsOf(base.pages['teach/index.html']);
  const row = (card) => card.match(/<span class="label">Series<\/span>([^<]*)</)?.[1] ?? null;
  const classes = teach.filter((c) => c.includes('>Evening class (showcase demo)<'));
  if (classes.length !== 2 || classes.some((c) => row(c) !== NAME)) out.push(`the programme cards read ${classes.map(row).join(' / ')}, want the series name on both`);
  const trial = teach.find((c) => c.includes('Data class trial'));
  if (!trial || row(trial) !== null) out.push('a card for an event on no series names one');

  // A programme event OSE says is on no series stops the build.
  const none = await built(onEvent('evt_sample-0001', (b) => { b.series = null; }));
  if (!/evt_sample-0001: a programme event is not on a declared series/.test(none.error ?? '')) out.push(`a programme event on no declared series built (${none.error ?? 'no error'})`);
  // An OSE that does not say either way is not held to it, and shows no series.
  const silent = await built({ edit: (k, b) => { if (k === 'event') delete b.series; return b; } });
  if (silent.error) out.push(`an OSE that serves no series stopped the build: ${silent.error.split('\n')[1] ?? silent.error}`);
  else if (/<span class="label">Series<\/span>/.test(Object.values(silent.pages).join(''))) out.push('a series shows though OSE served none');
  // A one-off, pop-up or trial needs no series.
  const loose = await built({ edit: (k, b, id) => { if (k === 'event' && !['evt_sample-0001', 'evt_sample-0002', 'evt_sample-0004'].includes(id)) b.series = null; return b; } });
  if (loose.error) out.push(`an event that is not a programme was held to a series: ${loose.error.split('\n')[1] ?? loose.error}`);

  // The series and the slot state the same programme.
  for (const [what, change, want] of [
    ['another cadence', (b) => { b.series.cadence = 'biweekly'; }, /its series is biweekly but its slot is weekly/],
    ['another weekday', (b) => { b.series.day_of_week = 2; }, /its series is on tuesday but its slot is on thursday/],
    ['another hour', (b) => { b.series.hour_of_day = 19; }, /its series starts at 19:00 but its slot at 18:00/],
  ]) {
    const r = await built(onEvent('evt_sample-0001', change));
    if (!want.test(r.error ?? '')) out.push(`a series with ${what} than its slot built (${(r.error ?? 'no error').split('\n')[1] ?? 'no error'})`);
  }
  // A series that names no day or hour (as OSE allows) does not disagree with a slot that does.
  const open = await built(onEvent('evt_sample-0001', (b) => { b.series.day_of_week = null; b.series.hour_of_day = null; }));
  if (open.error) out.push(`a series that names no day or hour stopped the build: ${open.error.split('\n')[1] ?? open.error}`);

  // A series named after the creator stops the build.
  const named = await stopped(() => sampleOse(m, onEvent('evt_sample-0001', (b) => { b.series.name = 'Evenings with Sam Sample'; })), /series names/);
  if (named) out.push(`the build read a series named after her without stopping (${named})`);
  return out;
}

// ── The where map ────────────────────────────────────────────────────────────
/**
 * A station's in-person events by area: resolution-7 cells only, drawn from the
 * cell and nothing finer, see-through and above a street layer, with the same
 * events always listed beside it, below the events and their sponsors.
 */
export async function mapProblems(m) {
  const out = [];
  const A1 = latLngToCell(39.7817, -89.6501, 7);
  const A2 = latLngToCell(39.84, -89.6, 7);
  const render = (ose, creator = sample()) => m.render.renderPages({ creator: { ...creator, display: 'tv' }, catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW });
  const onEvent = (id, change) => ({ edit: (k, b, eid) => { if (k === 'event' && eid === id) change(b); return b; } });
  const section = (html) => html.match(/<section aria-labelledby="where-title"[\s\S]*?<\/section>/)?.[0] ?? '';
  const count = (html, re) => (html.match(re) ?? []).length;

  // What the build keeps of an event's place: the area, and no coordinate.
  const calls = [];
  const ose = await sampleOse(m, { calls });
  const ev = (id, o = ose) => o.linked.find((x) => x.link.oseEventId === id)?.event ?? {};
  if (ev('evt_sample-0005').area !== A1 || ev('evt_sample-0006').area !== A2) out.push(`the build kept areas ${ev('evt_sample-0005').area} and ${ev('evt_sample-0006').area}`);
  for (const x of ose.linked) for (const k of Object.keys(x.event)) if (/^(lat|lon|lng|latitude|longitude|h3_res9)$/i.test(k)) out.push(`the build kept an event's ${k}`);
  if (ev('evt_sample-0001').area !== null) out.push('an event with no place has an area');

  const pages = render(ose);
  const wear = section(pages['wear/index.html']);
  const all = Object.values(pages).join('\n');

  // The heading opens with Where and then names the station: a station called "Wear" must not read as a misspelt "Where" (owner, 2026-11-14).
  const title = (html) => html.match(/<h2 id="where-title"[^>]*>([^<]*)<\/h2>/)?.[1] ?? '';
  if (title(wear) !== 'Where Wear meets in person, by area.') out.push(`the wear map is headed "${title(wear)}"`);
  if (title(section(pages['lead/index.html'])) !== 'Where every frequency meets in person, by area.') out.push(`the lead map is headed "${title(section(pages['lead/index.html']))}"`);
  // Two areas, numbered as the list numbers them; the neighbours are outlines only.
  if (count(wear, /<polygon class="hex-area"/g) !== 2) out.push(`wear draws ${count(wear, /<polygon class="hex-area"/g)} areas, want 2`);
  const numbers = [...wear.matchAll(/<text class="hex-number"[^>]*>([^<]*)<\/text>/g)].map((x) => x[1]).join(',');
  if (numbers !== '1,2') out.push(`the areas are numbered "${numbers}", want 1,2`);
  const around = new Set([...gridDisk(A1, 1), ...gridDisk(A2, 1)].filter((c) => c !== A1 && c !== A2)).size;
  if (count(wear, /<polygon class="hex-empty"/g) !== around) out.push(`wear outlines ${count(wear, /<polygon class="hex-empty"/g)} neighbouring areas, want ${around}`);
  // Every outline is a hexagon inside the frame.
  for (const [, pts] of wear.matchAll(/<polygon class="hex-(?:area|empty)" points="([^"]*)"/g)) {
    const xy = pts.split(' ').map((p) => p.split(',').map(Number));
    if (xy.length !== 6) out.push(`an area is drawn with ${xy.length} corners`);
    if (xy.some(([x, y]) => !(x >= 0 && x <= 600 && y >= 0 && y <= 360))) out.push('an area is drawn outside the map');
  }
  // The drawing is OurSharedEvents': its frame, its outlines and its centres,
  // for the cells in the order the list numbers them. Nothing is projected here.
  const asked = calls.filter(({ url }) => url.includes('/api/v2/map/areas')).map(({ url }) => url.slice(FAKE_ORIGIN.length));
  if (!asked.includes(`/api/v2/map/areas?cells=${A1},${A2}&around=1`)) out.push(`the wear map was not asked for as its list numbers it (asked: ${asked.join(' ') || 'nothing'})`);
  if (new Set(asked).size !== asked.length) out.push('one map was read twice');
  const drawn = mapAreasAnswer(new globalThis.URLSearchParams({ cells: `${A1},${A2}`, around: '1' })).body;
  if (!/viewBox="0 0 600 360"/.test(wear.match(/<svg class="hex-map"[^>]*>/)?.[0] ?? '')) out.push('the map is not in the frame OurSharedEvents gave');
  const outlines = [...wear.matchAll(/<polygon class="hex-area" points="([^"]*)"/g)].map((x) => x[1]).join('|');
  if (outlines !== drawn.areas.map((a) => a.points).join('|')) out.push('the areas are not the outlines OurSharedEvents drew');
  const neighbours = [...wear.matchAll(/<polygon class="hex-empty" points="([^"]*)"/g)].map((x) => x[1]).join('|');
  if (neighbours !== drawn.around.map((a) => a.points).join('|')) out.push('the neighbouring areas are not the outlines OurSharedEvents drew');
  const at = [...wear.matchAll(/<text class="hex-number" x="([^"]*)" y="([^"]*)"/g)].map((x) => `${x[1]},${x[2]}`).join('|');
  if (at !== drawn.areas.map((a) => a.centre.join(',')).join('|')) out.push('a number is not where OurSharedEvents put its area\'s centre');
  // Layers from the ground up: streets, neighbours, areas. The areas are see-through.
  const order = ['<g class="hex-streets">', '<g class="hex-around">', '<g class="hex-areas">'].map((g) => wear.indexOf(g));
  if (order.some((i) => i < 0) || order[0] > order[1] || order[1] > order[2]) out.push('the map layers are not streets, then neighbours, then areas');
  const css = pages['wear/index.html'].match(/\.hex-area \{[^}]*\}/)?.[0] ?? '';
  const opacity = Number(css.match(/fill-opacity: ([0-9.]+)/)?.[1] ?? 1);
  if (!(opacity > 0 && opacity <= 0.5)) out.push(`an area's fill opacity is ${opacity}: a street layer under it would not read through`);

  // The list is always there, says the same thing, and links to cards on the page.
  const items = [...wear.matchAll(/<li><b>Area (\d+)<\/b><ul>([\s\S]*?)<\/ul><\/li>/g)];
  if (items.length !== 2) out.push(`the list has ${items.length} areas, want 2`);
  if (!/Table at a weekend market/.test(items[0]?.[2] ?? '') || !/Launch evening/.test(items[1]?.[2] ?? '')) out.push('the list does not name each area\'s event');
  for (const [, id] of wear.matchAll(/<a href="#(ev-\d+)">/g)) if (!pages['wear/index.html'].includes(`id="${id}"`)) out.push(`the list links to #${id}, which is not on the page`);
  for (const [path, html] of Object.entries(pages)) {
    if (/<svg class="hex-map"/.test(html) && !/<ol class="areas"/.test(html)) out.push(`${path}: a map with no list beside it`);
    const svg = html.match(/<svg class="hex-map"[^>]*>/)?.[0];
    if (svg) {
      if (!/role="img"/.test(svg)) out.push(`${path}: the map is not announced as an image`);
      for (const id of (svg.match(/aria-labelledby="([^"]*)"/)?.[1] ?? '').split(' ')) if (!id || !html.includes(`id="${id}"`)) out.push(`${path}: the map is labelled by "${id}", which is not on the page`);
    }
  }
  // Below the events (and so below every title, date and sponsor strip); never on the front page or the TV board.
  const page = pages['wear/index.html'];
  if (page.indexOf('id="where"') < page.lastIndexOf('<article class="event"')) out.push('the map sits above the events');
  for (const p of ['index.html', 'tv/index.html']) if (/hex-map/.test(pages[p].replace(/<style>[\s\S]*?<\/style>/g, ''))) out.push(`${p} carries a map`);
  // Nothing finer than the area reaches a page: no cell id, no coordinate.
  for (const [what, re] of [['a cell id', new RegExp(`${A1}|${A2}`)], ['a latitude', /39\.78|39\.84/], ['a longitude', /-89\.6/]]) if (re.test(all)) out.push(`${what} reached a page`);
  if (/<image|xlink:href|<script/.test(wear)) out.push('the map loads something or runs a script');
  for (const map of Object.values(ose.maps ?? {})) if (/"cell"/.test(JSON.stringify(map))) out.push('the build kept a cell id with a map');

  // No streets in the answer (OSE staging today): hexagons only, and no credit, because there is nothing to credit.
  if (!wear.includes('<g class="hex-streets"></g>')) out.push('a street layer is drawn though OurSharedEvents gave none');
  if (/amap-credit|where-credit|OpenStreetMap/.test(all.replace(/<style>[\s\S]*?<\/style>/g, ''))) out.push('a street credit shows with no streets');
  if (all.includes('.as-l{')) out.push('street rules are in a stylesheet with no streets');

  // Streets in the answer: the layer under the areas, its rules in the page's
  // stylesheet, and OpenStreetMap's credit beside the map. Only where a map is.
  const streets = fakeStreets();
  const paved = render(await sampleOse(m, { edit: (k, b) => { if (k === 'map') b.streets = fakeStreets(); return b; } }));
  const pavedWear = section(paved['wear/index.html']);
  if (!pavedWear.includes(`<g class="hex-streets">${streets.svg}</g><g class="hex-around">`)) out.push('the street layer OurSharedEvents gave is not under the areas');
  const sheets = (html) => (html.match(/<style>[\s\S]*?<\/style>/g) ?? []).join('');
  if (count(sheets(paved['wear/index.html']), /\.as-l\{/g) !== 1 || !sheets(paved['wear/index.html']).includes(streets.css)) out.push('the street rules are not in the page\'s stylesheet, once');
  if (pavedWear.split(streets.credit.html).length !== 2) out.push('OpenStreetMap\'s credit is not beside the map, once');
  if (pavedWear.indexOf(streets.credit.html) < pavedWear.indexOf('</figure>') || pavedWear.indexOf(streets.credit.html) > pavedWear.indexOf('<ol class="areas"')) out.push('the credit is not between the map and its list');
  for (const p of ['index.html', 'tv/index.html', 'play/index.html']) {
    if (paved[p] && /amap-credit|\.as-l\{|amap-s/.test(paved[p])) out.push(`${p} has no map and carries street rules or a credit`);
  }
  for (const [what, re] of [['a cell id', new RegExp(`${A1}|${A2}`)], ['a latitude', /39\.78|39\.84/], ['a longitude', /-89\.6/]]) if (re.test(Object.values(paved).join('\n'))) out.push(`${what} reached a page with streets`);

  // More areas than one map holds: the first 12 are drawn and numbered, the rest are still listed.
  const stall = ose.linked.find((x) => x.link.oseEventId === 'evt_sample-0006');
  const cells = gridDisk(A1, 2).slice(0, 14);
  const many = cells.map((cell, i) => ({ ...stall, link: { frequency: 'wear', intent: 'one-off', oseEventId: `evt_many-${i}` }, event: { ...stall.event, id: `evt_many-${i}`, title: `Stall ${i + 1} (showcase demo)`, area: cell, startDate: `2027-01-${String(i + 1).padStart(2, '0')}`, endDate: `2027-01-${String(i + 1).padStart(2, '0')}`, startsAt: null }, codes: [], sponsors: [] }));
  const lists = m.ose.mapLists(sample(), many, NOW);
  if (lists.some((l) => l.length > 12)) out.push(`a map of ${Math.max(...lists.map((l) => l.length))} areas would be asked for: OurSharedEvents frames 12`);
  const manyCalls = [];
  const read = await m.ose.readMaps({ origin: FAKE_ORIGIN, lists, fetch: fakeOse({ calls: manyCalls }), sleep: async () => {} });
  const crowded = section(render({ ...ose, linked: many, maps: read.maps })['wear/index.html']);
  if (count(crowded, /<polygon class="hex-area"/g) !== 12) out.push(`14 areas drew ${count(crowded, /<polygon class="hex-area"/g)} hexagons, want the first 12`);
  if (count(crowded, /<li><b>Area \d+<\/b>/g) !== 12) out.push(`14 areas list ${count(crowded, /<li><b>Area \d+<\/b>/g)} numbered areas, want 12`);
  const later = crowded.match(/beyond the 12 one map shows:<\/p><ul class="areas-off">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  if (!/Stall 13 /.test(later) || !/Stall 14 /.test(later) || count(later, /<li>/g) !== 2) out.push('the events in the 13th and 14th areas are not listed beside the map');

  // A cell finer than the area, or not a cell at all, is never drawn: the event is listed without an area.
  for (const [what, cell] of [['a resolution-9 cell', latLngToCell(39.7817, -89.6501, 9)], ['a resolution-5 cell', cellToParent(A1, 5)], ['a made-up cell', 'not-a-cell']]) {
    const o = await sampleOse(m, onEvent('evt_sample-0005', (b) => { b.item.h3_res7 = cell; }));
    if (ev('evt_sample-0005', o).area !== null) out.push(`${what} was kept as an area`);
    const w = section(render(o)['wear/index.html']);
    if (count(w, /<polygon class="hex-area"/g) !== 1) out.push(`${what} was drawn`);
    if (!/with no area on the map yet[\s\S]*Table at a weekend market/.test(w)) out.push(`an event given ${what} is not listed beside the map`);
  }
  // Two events in one area share it.
  const shared = await sampleOse(m, onEvent('evt_sample-0006', (b) => { b.item.h3_res7 = A1; }));
  const one = section(render(shared)['wear/index.html']);
  if (count(one, /<polygon class="hex-area"/g) !== 1 || count(one, /<li><a href="#ev-/g) !== 2) out.push('two events in one area are not drawn as one area with both listed');
  // An online event is nowhere.
  const online = await sampleOse(m, onEvent('evt_sample-0005', (b) => { b.item.attendance_mode = 'online'; }));
  const noOnline = section(render(online)['wear/index.html']);
  if (count(noOnline, /<polygon class="hex-area"/g) !== 1 || /Table at a weekend market/.test(noOnline)) out.push('an online event is on the map');

  // No in-person area, no map: not an empty frame.
  const apart = sample();
  delete apart.events[5].also;
  const teach = render(await sampleOse(m, { creator: apart }), apart)['teach/index.html'];
  if (/id="where"|<svg class="hex-map"/.test(teach)) out.push('a station with no in-person area shows a map');
  // The switch hides it everywhere and nothing else.
  const off = render(ose, { ...sample(), sections: { map: false } });
  if (Object.values(off).some((h) => /id="where"/.test(h))) out.push('the map is switched off and still shows');
  const offCalls = [];
  await sampleOse(m, { creator: { ...sample(), sections: { map: false } }, calls: offCalls });
  if (offCalls.some(({ url }) => url.includes('/api/v2/map/areas'))) out.push('the map is switched off and was still read');
  if (!cardsOf(off['wear/index.html']).length) out.push('the events went with the map');
  return out;
}

// ── The where map is OurSharedEvents' answer (OW-217) ────────────────────────
const isMapRead = (url) => String(url).includes('/api/v2/map/areas');
const whereOf = (html) => html.match(/<section aria-labelledby="where-title"[\s\S]*?<\/section>/)?.[0] ?? '';
const renderAll = (m, ose, creator = sample()) => m.render.renderPages({ creator, catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW });

/**
 * Security: the answer is another service's text and goes into the page as
 * markup, so nothing of it is trusted. A street layer that is anything but
 * streets is left out and the hexagons stay; an outline, a centre or a frame
 * that is anything but plain numbers, or an answer for other cells, means no
 * map at all. In no case does a planted string reach a page.
 */
export async function mapAnswerProblems(m) {
  const out = [];
  const good = fakeStreets();
  const hostile = '"><script>PLANTED()</script>';
  // Each case: [what, plant, whether the hexagons should still be drawn].
  const streetCases = [
    ['a script in the street layer', (b) => { b.streets.svg = good.svg.replace('</g>', '<script>PLANTED()</script></g>'); }],
    ['a handler on the street layer', (b) => { b.streets.svg = good.svg.replace('<g class="amap-s"', '<g onload="PLANTED()" class="amap-s"'); }],
    ['a link in the street layer', (b) => { b.streets.svg = good.svg.replace('</g>', '<a href="https://evil.example/PLANTED"><text>x</text></a></g>'); }],
    ['an image in the street layer', (b) => { b.streets.svg = good.svg.replace('</g>', '<image href="https://evil.example/PLANTED.png"/></g>'); }],
    ['a foreign object in the street layer', (b) => { b.streets.svg = good.svg.replace('</g>', '<foreignObject><p>PLANTED</p></foreignObject></g>'); }],
    ['an inline style in the street layer', (b) => { b.streets.svg = good.svg.replace('<path class="as-w"', '<path style="fill:url(https://evil.example/PLANTED)" class="as-w"'); }],
    ['an address in a street path', (b) => { b.streets.svg = good.svg.replace('d="M10,10L80,60"', 'd="url(https://evil.example/PLANTED)"'); }],
    ['a street layer that closes the map', (b) => { b.streets.svg = `</g></svg><script>PLANTED()</script><svg><g>${good.svg}`; }],
    ['a street layer with a stray bracket', (b) => { b.streets.svg = good.svg.replace('Springfield', 'PLANTED < Springfield'); }],
    ['street rules that close the stylesheet', (b) => { b.streets.css = `${good.css}</style><script>PLANTED()</script>`; }],
    ['street rules that import a stylesheet', (b) => { b.streets.css = `@import url(https://evil.example/PLANTED.css);${good.css}`; }],
    ['street rules that load an address', (b) => { b.streets.css = `${good.css}.as-l{background:url(https://evil.example/PLANTED)}`; }],
    ['street rules that restyle the page', (b) => { b.streets.css = `${good.css}body{display:none}`; }],
    ['a credit that links elsewhere', (b) => { b.streets.credit.html = good.credit.html.replace('https://protomaps.com', 'https://evil.example/PLANTED'); }],
    ['a credit on a look-alike host', (b) => { b.streets.credit.html = good.credit.html.replace('https://www.openstreetmap.org/', 'https://www.openstreetmap.org.evil.example/PLANTED/'); }],
    ['a credit with a script', (b) => { b.streets.credit.html = good.credit.html.replace('</p>', '<script>PLANTED()</script></p>'); }],
    ['a credit with a handler', (b) => { b.streets.credit.html = good.credit.html.replace('<p class="amap-credit"', '<p onclick="PLANTED()" class="amap-credit"'); }],
    ['a credit that does not credit OpenStreetMap', (b) => { b.streets.credit.html = '<p class="amap-credit">PLANTED: prepared by <a href="https://protomaps.com">Protomaps</a>.</p>'; }],
    ['streets with no credit', (b) => { delete b.streets.credit; b.streets.svg = good.svg.replace('Springfield', 'PLANTED'); }],
  ];
  const mapCases = [
    ['markup in an outline', (b) => { b.areas[0].points = `${b.areas[0].points}${hostile}`; }],
    ['an outline with five corners', (b) => { b.areas[0].points = b.areas[0].points.split(' ').slice(0, 5).join(' '); }],
    ['an outline outside the frame', (b) => { b.areas[0].points = b.areas[0].points.replace(/^[^,]*,/, '9999,'); }],
    ['markup in a neighbour\'s outline', (b) => { b.around[0].points = `1,1 2,2 3,3 4,4 5,5 6,6${hostile}`; }],
    ['markup in a centre', (b) => { b.areas[0].centre = [`300${hostile}`, 180]; }],
    ['a centre outside the frame', (b) => { b.areas[0].centre = [300, 9999]; }],
    ['markup in the frame', (b) => { b.frame.w = `600${hostile}`; }],
    ['a frame of no size', (b) => { b.frame.h = 0; }],
    ['a frame far too large', (b) => { b.frame.w = 1e9; }],
    ['an answer for another area', (b) => { b.areas[0].cell = b.around[0].cell; }],
    ['an answer with an area missing', (b) => { b.areas = b.areas.slice(1); }],
    ['an answer that says it failed', (b) => { b.ok = false; }],
  ];
  const run = async (plant) => {
    const ose = await sampleOse(m, { edit: (k, b) => { if (k === 'map') { b.streets = fakeStreets(); plant(b); } return b; } });
    return { ose, pages: renderAll(m, ose) };
  };
  const leaks = (what, pages) => {
    const all = Object.values(pages).join('\n');
    if (/PLANTED|evil\.example/.test(all)) out.push(`${what}: reached a page`);
    for (const [path, html] of Object.entries(pages)) {
      out.push(...inlineHandlerProblems(html).map((p) => `${what}: ${path}: ${p}`));
      if (path !== 'index.html' && !path.startsWith('tv/') && /<script/i.test(html)) out.push(`${what}: ${path} carries a script`);
    }
  };
  // The control: a street layer that is one is drawn, so the cases below fail for their fault and nothing else.
  const control = await run(() => {});
  if (!whereOf(control.pages['wear/index.html']).includes(good.svg) || !whereOf(control.pages['wear/index.html']).includes(good.credit.html)) out.push('a real street layer is refused');
  for (const [what, plant] of streetCases) {
    let pages;
    try {
      ({ pages } = await run(plant));
    } catch (e) {
      out.push(`${what}: stopped the build (${e.message.split('\n')[0]})`);
      continue;
    }
    leaks(what, pages);
    const wear = whereOf(pages['wear/index.html']);
    if ((wear.match(/<polygon class="hex-area"/g) ?? []).length !== 2) out.push(`${what}: the hexagons were lost with the streets`);
    if (!wear.includes('<g class="hex-streets"></g>')) out.push(`${what}: the street layer was still drawn`);
    if (/amap-credit|where-credit/.test(wear) || pages['wear/index.html'].includes('.as-l{')) out.push(`${what}: a credit or street rules stayed without the streets`);
  }
  for (const [what, plant] of mapCases) {
    let ose;
    let pages;
    try {
      ({ ose, pages } = await run(plant));
    } catch (e) {
      out.push(`${what}: stopped the build (${e.message.split('\n')[0]})`);
      continue;
    }
    leaks(what, pages);
    if (Object.keys(ose.maps).length) out.push(`${what}: taken for a map`);
    const wear = whereOf(pages['wear/index.html']);
    if (/<svg class="hex-map"/.test(wear)) out.push(`${what}: a map was drawn from it`);
    if ((wear.match(/<li><b>Area \d+<\/b>/g) ?? []).length !== 2) out.push(`${what}: the list went with the map`);
  }
  return out;
}

/**
 * A map read never stops a build. Late, refused, rate-limited, unreadable or
 * not a map: the page is built with its list, says the map is missing, draws
 * no empty frame, and the build is told why. One map failing leaves the others.
 */
export async function mapFailSoftProblems(m) {
  const out = [];
  const base = () => fakeOse({ now: NOW });
  const wrap = (onMap) => {
    const f = base();
    return async (url, init) => (isMapRead(url) ? onMap(url, init, f) : f(url, init));
  };
  const named = (name) => Object.assign(new Error(name), { name });
  const answers = (status, body, type = 'application/json') => async () => new globalThis.Response(body, { status, headers: { 'Content-Type': type } });
  const cases = [
    ['a 500', answers(500, '{"ok":false,"status":500}'), /answered 500/],
    ['a rate limit (429)', answers(429, '{"ok":false,"status":429,"code":"RATE_LIMITED"}'), /answered 429/],
    ['a refusal (400)', answers(400, '{"ok":false,"status":400,"code":"TOO_MANY_CELLS"}'), /answered 400/],
    ['an OSE with no such route (404)', answers(404, 'Not found', 'text/plain'), /answered 404/],
    ['an edge challenge (403, a page)', answers(403, '<!doctype html><title>Just a moment</title>', 'text/html'), /answered 403/],
    ['a 200 that is not JSON', answers(200, '<!doctype html><title>Just a moment</title>', 'text/html'), /could not be read/],
    ['a 200 that is not a map', answers(200, '{"ok":true,"status":200}'), /not a map/],
    ['a connection that fails', async () => { throw new TypeError('fetch failed'); }, /could not be read/],
    ['an answer that never comes', async () => { throw named('TimeoutError'); }, /gave no answer in 10 seconds/],
    ['a redirect', async () => { throw new TypeError('redirect mode is set to error'); }, /could not be read/],
  ];
  for (const [what, onMap, said] of cases) {
    let ose;
    try {
      ose = await m.ose.readOse({ base: FAKE_ORIGIN, creator: sample(), fetch: wrap(onMap), now: NOW, sleep: async () => {} });
    } catch (e) {
      out.push(`${what}: stopped the build (${e.message.split('\n')[0]})`);
      continue;
    }
    if (Object.keys(ose.maps).length) out.push(`${what}: a map was kept`);
    if (!ose.mapsMissed.length || !ose.mapsMissed.every((x) => said.test(x))) out.push(`${what}: the build was told "${ose.mapsMissed.join('; ')}"`);
    if (ose.linked.length !== (await sampleOse(m)).linked.length) out.push(`${what}: events were lost with the map`);
    const failed = await tryBuild(m, { ose });
    if (failed) out.push(`${what}: the pages did not build (${failed.split('\n')[0]})`);
    const pages = renderAll(m, ose);
    const wear = whereOf(pages['wear/index.html']);
    if (/<svg class="hex-map"|<figure class="where-map"|where-credit/.test(wear)) out.push(`${what}: a map or an empty frame was drawn`);
    if ((wear.match(/<li><b>Area \d+<\/b>/g) ?? []).length !== 2 || !/Table at a weekend market/.test(wear) || !/Launch evening/.test(wear)) out.push(`${what}: the list of areas is not on the page`);
    if (!/id="where-note"[^>]*>[^<]*could not be drawn when this page was built/.test(wear)) out.push(`${what}: the page does not say the map is missing`);
    if (/The same events are listed below it/.test(wear)) out.push(`${what}: the page speaks of a map it does not show`);
    if (!(pages['wear/index.html'].match(/<article class="event"/g) ?? []).length) out.push(`${what}: the events went with the map`);
  }
  // A read is given a time limit, so one that hangs cannot hold a build.
  const seen = [];
  await m.ose.readOse({ base: FAKE_ORIGIN, creator: sample(), fetch: wrap((url, init, f) => { seen.push(init); return f(url, init); }), now: NOW, sleep: async () => {} });
  if (!seen.length || !seen.every((init) => init?.signal instanceof globalThis.AbortSignal)) out.push('a map read has no time limit');
  if (m.ose.MAP_TIMEOUT_MS > 15_000) out.push(`a map read may hang for ${m.ose.MAP_TIMEOUT_MS} ms`);
  // One map failing leaves the others: only the two-area map is refused here.
  const partial = await sampleOse(m, { fail: (k, cells) => (k === 'map' && String(cells).includes(',') ? 429 : null) });
  const part = renderAll(m, partial);
  if (/<svg class="hex-map"/.test(whereOf(part['wear/index.html']))) out.push('a refused map was drawn');
  if (!/<svg class="hex-map"/.test(whereOf(part['teach/index.html']))) out.push('one map failing took another station\'s map with it');
  if (partial.mapsMissed.length !== 1 || !/a map of 2 areas was left out/.test(partial.mapsMissed[0])) out.push(`one refused map was reported as "${partial.mapsMissed.join('; ')}"`);
  // With every map read, nothing is reported missing.
  if ((await sampleOse(m)).mapsMissed.length) out.push('a map that was read is reported missing');
  return out;
}

/**
 * A build of many stations spaces its map reads: OurSharedEvents asks for
 * under 6 a second. Driven by a clock the check owns; no real time passes.
 */
export async function mapSpacingProblems(m) {
  const out = [];
  let t = 1_000_000;
  const starts = [];
  const f = fakeOse({ now: NOW });
  const cells = gridDisk(latLngToCell(39.7817, -89.6501, 7), 2).slice(0, 9);
  const lists = cells.map((c) => [c]);
  // Each answer takes 10 ms of the check's clock: far faster than the limit allows unspaced.
  const fetch = async (url, init) => { starts.push(t); t += 10; return f(url, init); };
  const { maps } = await m.ose.readMaps({ origin: FAKE_ORIGIN, lists, fetch, sleep: async (ms) => { t += ms; }, clock: () => t });
  if (Object.keys(maps).length !== lists.length) out.push(`${Object.keys(maps).length} of ${lists.length} maps were read`);
  for (let i = 0; i < starts.length; i += 1) {
    const inOneSecond = starts.filter((s) => s >= starts[i] && s < starts[i] + 1000).length;
    if (inOneSecond >= 6) {
      out.push(`${inOneSecond} map reads started within one second: OurSharedEvents asks for under 6`);
      break;
    }
  }
  // A slow answer is its own spacing: nothing more is waited.
  let waited = 0;
  t = 0;
  await m.ose.readMaps({ origin: FAKE_ORIGIN, lists: lists.slice(0, 3), fetch: async (url, init) => { t += 500; return f(url, init); }, sleep: async (ms) => { waited += ms; t += ms; }, clock: () => t });
  if (waited) out.push(`the build waited ${waited} ms between answers that were already half a second apart`);
  return out;
}

/**
 * Contract: the stand-in the other layers read is held to an answer recorded
 * from OSE staging on 2026-11-14 (fixtures/ose-map-areas.staging.json), and the
 * build takes that recorded answer for the map it is. The request is cells
 * only: OSE refuses a coordinate, a finer cell and a 13th cell.
 */
export function mapContractProblems(m) {
  const out = [];
  const recorded = json('fixtures/ose-map-areas.staging.json');
  const cells = recorded.areas.map((a) => a.cell);
  const path = m.map.mapPath(cells);
  if (path !== `/api/v2/map/areas?cells=${cells.join(',')}&around=1`) out.push(`the build asks ${path}`);
  const standIn = mapAreasAnswer(new URL(path, FAKE_ORIGIN).searchParams).body;
  for (const k of ['w', 'h', 'projection']) if (standIn.frame[k] !== recorded.frame[k]) out.push(`the stand-in's frame ${k} is ${standIn.frame[k]}, staging's is ${recorded.frame[k]}`);
  for (const k of ['scale', 'x0', 'y0']) if (Math.abs(standIn.frame[k] - recorded.frame[k]) > Math.abs(recorded.frame[k]) * 1e-9) out.push(`the stand-in's frame ${k} is ${standIn.frame[k]}, staging's is ${recorded.frame[k]}`);
  if (JSON.stringify(standIn.areas) !== JSON.stringify(recorded.areas)) out.push('the stand-in draws the area unlike staging');
  if (JSON.stringify(standIn.around) !== JSON.stringify(recorded.around)) out.push('the stand-in draws the neighbours unlike staging');
  if (recorded.streets !== null) out.push('the recorded answer has streets: record the street checks against it too');
  const map = m.map.mapFromAnswer(recorded, cells);
  if (!map) out.push('the build refuses the answer staging gave');
  else {
    if (map.w !== 600 || map.h !== 360) out.push(`the build reads a frame of ${map.w} by ${map.h}`);
    if (map.areas.length !== 1 || map.around.length !== 6 || map.streets !== null) out.push('the build reads the recorded answer as something else');
    if (map.areas[0].points !== recorded.areas[0].points || map.areas[0].centre.join() !== recorded.areas[0].centre.join()) out.push('the build changes the outline or the centre staging gave');
  }
  if (m.map.MAP_AREAS_MAX !== 12) out.push(`the build would ask for ${m.map.MAP_AREAS_MAX} areas: OSE frames 12`);
  const refusal = (q) => mapAreasAnswer(new globalThis.URLSearchParams(q)).body.code;
  const res9 = latLngToCell(39.7817, -89.6501, 9);
  const thirteen = gridDisk(cells[0], 2).slice(0, 13).join(',');
  for (const [q, code] of [[{ cells: cells[0], lat: '39.78' }, 'COORDINATES_NOT_ACCEPTED'], [{ cells: res9 }, 'CELL_RESOLUTION'], [{ cells: thirteen }, 'TOO_MANY_CELLS'], [{ cells: 'not-a-cell' }, 'CELL_INVALID'], [{}, 'CELLS_REQUIRED'], [{ cells: cells[0], around: '2' }, 'AROUND_INVALID']]) {
    if (refusal(q) !== code) out.push(`the stand-in answers ${refusal(q)} where OSE answers ${code}`);
  }
  return out;
}

// ── Online or in person (S13) ────────────────────────────────────────────────
/**
 * Every event says how it is held, as OSE states it: the card carries the mode,
 * an online event has no place on the page, an event held both ways keeps its
 * place, and a programme event's mode is its slot's.
 */
export async function modeProblems(m) {
  const out = [];
  const render = (ose, creator = sample()) => m.render.renderPages({ creator, catalog: catalog().categories, reports: seededReports(), theme: '', ose, now: NOW });
  const onEvent = (id, change) => ({ edit: (k, b, eid) => { if (k === 'event' && eid === id) change(b); return b; } });
  const tagsOf = (card) => [...(card.match(/<p class="tags">[\s\S]*?<\/p>/)?.[0] ?? '').matchAll(/<span class="tag[^"]*">([^<]*)<\/span>/g)].map((x) => x[1]);
  const whereOf = (card) => card.match(/<span class="label">Where<\/span>([^<]*)</)?.[1] ?? null;
  const card = (pages, page, title) => cardsOf(pages[page]).find((c) => c.includes(`>${title}<`)) ?? '';

  // What the build keeps: the mode OSE states, and nothing for a value that is not a mode.
  const ose = await sampleOse(m);
  const modeOf = (id, o = ose) => o.linked.find((x) => x.link.oseEventId === id)?.event.attendanceMode;
  if (modeOf('evt_sample-0001') !== 'online' || modeOf('evt_sample-0005') !== 'in_person') out.push(`the build read modes ${modeOf('evt_sample-0001')} and ${modeOf('evt_sample-0005')}, want online and in_person`);
  const odd = await sampleOse(m, onEvent('evt_sample-0003', (b) => { b.item.attendance_mode = 'hybrid-ish'; }));
  if (modeOf('evt_sample-0003', odd) !== null) out.push('a value that is not a mode was kept as one');

  // The card says how the event is held.
  const pages = render(ose);
  const klass = card(pages, 'teach/index.html', 'Evening class (showcase demo)');
  const stall = card(pages, 'wear/index.html', 'Table at a weekend market (showcase demo)');
  if (!tagsOf(klass).includes('Online')) out.push(`the online class is tagged ${tagsOf(klass).join(', ')}`);
  if (!tagsOf(stall).includes('In person')) out.push(`the in-person stall is tagged ${tagsOf(stall).join(', ')}`);
  if (whereOf(klass) !== 'Online') out.push(`the online class reads Where: ${whereOf(klass)}`);
  if (whereOf(stall) !== '100 Market Street, Springfield') out.push(`the stall reads Where: ${whereOf(stall)}`);

  // An online event has no place on any page, whatever else the row carries.
  const leaky = await sampleOse(m, onEvent('evt_sample-0001', (b) => { b.item.where_address = '9 Hidden Lane, Springfield'; b.item.venue = '9 Hidden Lane, Springfield'; b.item.location = '9 Hidden Lane, Springfield'; b.item.h3_res7 = latLngToCell(39.7817, -89.6501, 7); }));
  const leakyPages = render(leaky);
  if (Object.values(leakyPages).join('').includes('Hidden Lane')) out.push('an online event\'s place reached a page');
  if ((leakyPages['teach/index.html'].match(/<polygon class="hex-area"/g) ?? []).length !== 1) out.push('an online event was put on the map');

  // Held both ways: it says so, keeps its place, and is on the map.
  const both = await sampleOse(m, onEvent('evt_sample-0005', (b) => { b.item.attendance_mode = 'both'; }));
  const bothPages = render(both);
  const bothCard = card(bothPages, 'wear/index.html', 'Table at a weekend market (showcase demo)');
  if (!tagsOf(bothCard).includes('Online and in person')) out.push(`an event held both ways is tagged ${tagsOf(bothCard).join(', ')}`);
  if (whereOf(bothCard) !== '100 Market Street, Springfield') out.push('an event held both ways lost its place');
  if ((bothPages['wear/index.html'].match(/<polygon class="hex-area"/g) ?? []).length !== 2) out.push('an event held both ways is off the map');

  // A programme event's mode is its slot's: the weekly class is online, so an in-person one stops the build.
  let stoppedBy = null;
  try {
    render(await sampleOse(m, onEvent('evt_sample-0001', (b) => { b.item.attendance_mode = 'in_person'; b.item.where_address = '1 Class Road, Springfield'; })));
  } catch (e) {
    stoppedBy = e.message;
  }
  if (!/evt_sample-0001: its mode \(in_person\) differs from its slot's \(online\)/.test(stoppedBy ?? '')) out.push(`a programme event held another way than its slot built (${(stoppedBy ?? 'no error').split('\n')[1] ?? 'no error'})`);

  // An OSE from before the field: no mode shown, nothing stopped, and the place still reads.
  let old = null;
  try {
    old = render(await sampleOse(m, { edit: (k, b) => { if (k === 'event') delete b.item.attendance_mode; return b; } }));
  } catch (e) {
    out.push(`an OSE that serves no mode stopped the build: ${e.message.split('\n')[1] ?? e.message}`);
  }
  if (old) {
    const oldStall = card(old, 'wear/index.html', 'Table at a weekend market (showcase demo)');
    if (tagsOf(oldStall).some((t) => ['Online', 'In person', 'Online and in person'].includes(t))) out.push('a mode shows though OSE served none');
    if (whereOf(oldStall) !== '100 Market Street, Springfield') out.push('with no mode served, the place went');
  }
  return out;
}
