// Every showcase check as a function over the lib modules, returning problems.
// The layer tests call them on the real lib and expect none; born-red.test.mjs
// calls them on mutated copies and expects each to catch its planted fault.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { fakeOse, FAKE_ORIGIN, NOW, plan } from './fake-ose.mjs';

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
      shape: 'low', placements: ['Table card', 'Garment tag'], reportStatus: 200, distinctScanners: 3,
      reportPath: '/sharedReport?eventId=evt_demo_wear&token=planted.TOKEN-value_0987654321',
      images: { card: 'img/wear-card.jpg', desktop: 'img/wear-desktop.jpg', phone: 'img/wear-phone.jpg' },
    },
  ],
});

/** What the build reads from (stand-in) OSE for the fixture, through the module under test. */
export async function sampleOse(m, { creator = sample(), now = NOW, edit, fail, events, calls } = {}) {
  return m.ose.readOse({ base: FAKE_ORIGIN, creator, fetch: fakeOse({ now, edit, fail, events, calls }), now });
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
const OWN_IMAGE = /^(\.\.\/)?img\/[a-z0-9-]+\.(jpg|png)$/;
/**
 * Every href / src / srcset is https:, one of the creator's own pages or images,
 * or an OSE /q or /s code on `origin` (the OSE the build read).
 */
export function urlProblems(html, origin = null) {
  const out = [];
  const code = origin ? new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(q|s)/[A-Za-z0-9_-]+$`) : null;
  for (const t of tags(html)) {
    for (const [, attr, value] of t.matchAll(/\s(href|src|srcset)\s*=\s*"([^"]*)"/gi)) {
      const v = value.trim();
      if (/^https:\/\//.test(v) || OWN_PAGE.test(v) || OWN_IMAGE.test(v) || (code && code.test(v))) continue;
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
      if (kind === 'bundle') for (const s of body.slots) { s.word = `x${PAYLOADS[n.i++ % 4]}`; s.label = s.word; }
      return body;
    },
  });
  const pages = m.render.renderPages({ creator, catalog: catalog().categories, reports, theme: '', ose, now: NOW });
  const out = [];
  for (const [path, html] of Object.entries(pages)) {
    const want = path === 'index.html' ? 1 : 0;
    const scripts = (html.match(/<script\b/gi) ?? []).length;
    if (scripts !== want) out.push(`${path}: ${scripts} <script> elements (want ${want})`);
    if (/<(img|svg)\b[^>]*\son(error|load)\s*=/i.test(html.replace(/="[^"]*"/g, '=""'))) out.push(`${path}: a field rendered a live element with a handler`);
    out.push(...inlineHandlerProblems(html).map((p) => `${path}: ${p}`), ...urlProblems(html, ose.origin).map((p) => `${path}: ${p}`));
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
    if (!/\/api\/v2\/events(\?brand=|\/[^/]+(\/poster-bundle)?(\?deployment=[^&]+)?$)/.test(url)) out.push(`unexpected read ${url}`);
  }
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
  if (t.upcoming.some((x) => x.link.frequency !== 'teach')) out.push('teach lists an event from another frequency');
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
