// Every showcase check as a function over the lib modules, returning problems.
// The layer tests call them on the real lib and expect none; born-red.test.mjs
// calls them on mutated copies and expects each to catch its planted fault.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHOWCASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(join(SHOWCASE, p), 'utf8'));
export const sample = () => json('fixtures/sample-creator.json');
export const catalog = () => json('categories.json');
export const theme = () => readFileSync(join(SHOWCASE, 'theme.css'), 'utf8');

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

// ── tag-level HTML helpers (escaped text never contains a literal "<") ────────
const tags = (html) => html.match(/<[a-zA-Z][^>]*>/g) ?? [];
const withoutValues = (tag) => tag.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");

/** Inline event handlers (onclick=…) on any element: a served page's CSP forbids them. */
export function inlineHandlerProblems(html) {
  return tags(html)
    .filter((t) => /\son[a-z]+\s*=/i.test(withoutValues(t)))
    .map((t) => `inline handler: ${t.slice(0, 80)}`);
}

/** Every href / src / srcset is https: or a local img/ file. */
export function urlProblems(html) {
  const out = [];
  for (const t of tags(html)) {
    for (const [, attr, value] of t.matchAll(/\s(href|src|srcset)\s*=\s*"([^"]*)"/gi)) {
      if (!/^(https:\/\/|img\/)/.test(value.trim())) out.push(`${attr}="${value.slice(0, 60)}"`);
    }
  }
  return out;
}

// ── 0. Security ───────────────────────────────────────────────────────────────
const PAYLOADS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'><svg onload=alert(1)>", '</script><script>alert(2)</script>'];
const KEEP = new Set(['id', 'category', 'slug', 'readOn', 'demo']);
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

/** Escaping: a creator whose every string field is an attack renders no live markup. */
export function escapingProblems(m) {
  const reports = seededReports();
  reports.reports = reports.reports.map((r) => ({ ...hostile(r), station: r.station, images: r.images, distinctScanners: r.distinctScanners }));
  const creator = hostile(sample());
  // Station names usually come from the catalog; a creator may override them,
  // and they reach both attributes and the inline script's data.
  creator.stations.forEach((s, i) => { s.name = `x${PAYLOADS[(i + 1) % PAYLOADS.length]}${PAYLOADS[3]}`; });
  const html = m.render.renderPage({ creator, catalog: catalog().categories, reports, theme: '' });
  const out = [];
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  if (scripts !== 1) out.push(`${scripts} <script> elements (the page has exactly one)`);
  if (/<(img|svg)\b[^>]*\son(error|load)\s*=/i.test(html.replace(/="[^"]*"/g, '=""'))) out.push('a field rendered a live element with a handler');
  out.push(...inlineHandlerProblems(html), ...urlProblems(html));
  return out;
}

/** Link allowlist: a non-https source never becomes a link. */
export function linkProblems(m) {
  const creator = sample();
  creator.sources = [
    { label: 'script link', url: 'javascript:alert(1)', usedFor: 'planted' },
    { label: 'plain http', url: 'http://example.com/', usedFor: 'planted' },
    { label: 'data link', url: 'data:text/html,hi', usedFor: 'planted' },
  ];
  const html = m.render.renderPage({ creator, catalog: catalog().categories, reports: { reports: [] }, theme: '' });
  return urlProblems(html);
}

/** No secrets published: the built folder holds no signed link, key or token. */
export function secretProblems(m) {
  const dir = mkdtempSync(join(tmpdir(), 'showcase-secrets-'));
  try {
    m.build.buildShowcase({ creator: sample(), reports: seededReports(), outDir: dir, catalog: catalog(), theme: theme() });
    return m.build.publishedTexts(dir).flatMap(([p, text]) => m.build.publishProblems(p.slice(dir.length + 1), text));
  } catch (e) {
    return [`build refused or failed: ${e.message.split('\n')[0]}`];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The publish gate refuses a page that would carry a secret or an identity. */
export function publishGateProblems(m) {
  const out = [];
  const cases = [
    ['an email in a report title', (r) => { r.reports[0].title = 'Hosted by planted.person@example.com'; }],
    ['a signed link in a creator field', (r, c) => { c.lede = 'See /sharedReport?eventId=x&token=abcdefghijklmnop'; }],
    ['an anonymous cookie in a place', (r, c) => { c.places.push(['ose_anon=abc123', 'planted']); }],
  ];
  for (const [what, plant] of cases) {
    const reports = seededReports();
    const creator = sample();
    plant(reports, creator);
    const dir = mkdtempSync(join(tmpdir(), 'showcase-gate-'));
    try {
      m.build.buildShowcase({ creator, reports, outDir: dir, catalog: catalog(), theme: theme() });
      out.push(`the build published ${what}`);
    } catch (e) {
      if (!/publish refused/.test(e.message)) out.push(`the build failed on ${what} for another reason: ${e.message.split('\n')[0]}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return out;
}

/** Never who: the rendered fixture page names no person, cookie or id. */
export function neverWhoProblems(m) {
  const html = m.render.renderPage({ creator: sample(), catalog: catalog().categories, reports: seededReports(), theme: theme() });
  return m.showcase.findIdentities(html).map((k) => `page carries an ${k}`);
}

/** Floor: a count under 5 reads "Fewer than 5", never the number. */
export function floorProblems(m) {
  const html = m.render.renderPage({ creator: sample(), catalog: catalog().categories, reports: seededReports(), theme: '' });
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

/** Served-page CSP readiness: no inline handlers on the real fixture page. */
export function cspProblems(m) {
  const html = m.render.renderPage({ creator: sample(), catalog: catalog().categories, reports: seededReports(), theme: theme() });
  return inlineHandlerProblems(html);
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

// ── 2. Contract ───────────────────────────────────────────────────────────────
/** The schema refuses what it must refuse. */
export function contractProblems(m) {
  const out = [];
  const refused = (mutate, pattern, what) => {
    const c = sample();
    mutate(c);
    const p = m.schema.creatorProblems(c, catalog()).join('\n');
    if (!pattern.test(p)) out.push(`accepted ${what}`);
  };
  if (m.schema.creatorProblems(sample(), catalog()).length) out.push('refused the valid fixture');
  refused((c) => { c.sources[0].url = 'http://example.com/'; }, /sources\.0\.url/, 'a non-https source');
  refused((c) => { c.stations[0].category = 'nowhere'; }, /not in categories\.json/, 'a missing category');
  refused((c) => { c.stations[0].category = 'spirit'; }, /not open yet/, 'a future category');
  refused((c) => { c.surprise = true; }, /surprise|Unrecognized|unrecognized/, 'an unknown field');
  refused((c) => { c.stations[1].id = c.stations[0].id; }, /used twice/, 'a repeated station id');
  refused((c) => { delete c.disclaimer; }, /disclaimer/, 'a file with no disclaimer');
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
