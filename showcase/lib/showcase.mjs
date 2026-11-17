// Pure helpers for the creator showcase. No file or network access here, so
// every rule the tests hold the container to is checked on this code directly.

/** The count floor: a published count under this reads in words, never as a number. */
export const FLOOR = 5;

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export const fmtDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const floorText = (n) => (n === null || n === undefined ? 'Not yet counted' : n < FLOOR ? 'Fewer than 5' : String(n));

/** Seeding and capture talk only to a worker on this machine. */
const LOCAL_BASE = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;
export function assertLocalBase(base) {
  if (typeof base !== 'string' || !LOCAL_BASE.test(base)) throw new Error(`refusing non-local base ${String(base)}`);
  return base;
}

/** A source link must be https:. Anything else renders as plain text. */
export function safeHttpsUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Report images are files the capture step wrote next to the page, nothing else. */
export function safeImagePath(p) {
  return typeof p === 'string' && /^img\/[a-z0-9-]+\.(jpg|png)$/.test(p) ? p : null;
}

// Demo shapes: scans per hour across one event. The page labels them illustrative.
// Some shapes keep an hour under the floor on purpose, so the floor shows.
export const SHAPES = {
  high: { hours: [17, 18, 19, 20, 21], counts: [7, 16, 23, 14, 6], placements: ['Clip link', 'Luma page', 'Door QR'] },
  medium: { hours: [18, 19, 20, 21], counts: [6, 12, 9, 3], placements: ['Clip link', 'Room QR'] },
  low: { hours: [12, 13, 14, 15], counts: [5, 8, 6, 2], placements: ['Table card', 'Garment tag'] },
};

/** The labels a demo event's codes hang under: its own when it names any, else its size's. */
export const placementsFor = (event) => (event.placements?.length ? event.placements : SHAPES[event.demo].placements);

export const scansFor = (shape) => shape.counts.reduce((a, b) => a + b, 0);

/** What the report must show: the scans sent, less every hour under the floor. */
export const expectedTotal = (shape) => shape.counts.filter((n) => n >= FLOOR).reduce((a, b) => a + b, 0);

/** The hour buckets one event's scans are spread over. They sum to the scans sent. */
export function hourBuckets(shape, day) {
  return shape.hours.map((h, i) => ({ bucket: `${day}T${String(h).padStart(2, '0')}:00`, n: shape.counts[i] }));
}

// OSE counts at most ~60 scans a minute from one caller (lib/public-read-limit.ts).
// The pacer keeps every demo scan a counted scan.
export const PER_MINUTE = 50;
export function createPacer({ perMinute = PER_MINUTE, windowMs = 61_000, now = Date.now, sleep } = {}) {
  const stamps = [];
  return async function paced() {
    let t = now();
    while (stamps.length && t - stamps[0] > windowMs) stamps.shift();
    if (stamps.length >= perMinute) {
      await sleep(windowMs - (t - stamps[0]) + 1);
      t = now();
      while (stamps.length && t - stamps[0] > windowMs) stamps.shift();
    }
    stamps.push(now());
  };
}

/**
 * The nightly roll-up (scan_aggregates), run on the local worker as its 03:00
 * cron would run it, through the scheduled route `wrangler dev --test-scheduled`
 * serves (both start-local-ose scripts pass that flag). A trigger can answer
 * "ok" and still write nothing (wrangler's Local Explorer did, on Windows), so
 * this waits until every seeded event has totals and stops the seed otherwise:
 * a report minted before its totals are written is an empty report.
 * `countRolledUp(eventId)` reads how many roll-up rows the event has.
 */
export const ROLL_UP_CRON = '0 3 * * *';
export async function runRollUp({ base, eventIds, fetch: f, countRolledUp, sleep, timeoutMs = 30_000, stepMs = 500 }) {
  const url = `${assertLocalBase(base)}/__scheduled?cron=${encodeURIComponent(ROLL_UP_CRON)}`;
  const res = await f(url, { method: 'GET' });
  if (!res.ok) throw new Error(`roll-up: /__scheduled answered ${res.status}`);
  let waiting = [...eventIds];
  for (let waited = 0; ; waited += stepMs) {
    const still = [];
    for (const id of waiting) if (!((await countRolledUp(id)) > 0)) still.push(id);
    waiting = still;
    if (!waiting.length) return;
    if (waited >= timeoutMs) throw new Error(`roll-up: no scan totals for ${waiting.join(', ')} after ${timeoutMs / 1000} s; their reports would be empty`);
    await sleep(stepMs);
  }
}

/**
 * A SharedReport's total as OSE gives it: a number, or null when OSE has no
 * total to show. Anything else, a missing field included, is a broken contract.
 */
export function reportTotal(body) {
  const n = body?.report?.distinct_scanners;
  if (n === null || typeof n === 'number') return n;
  throw new Error(`contract: shared-report has no distinct_scanners (${n === undefined ? 'missing' : typeof n})`);
}

/** Stations: catalog defaults, the creator's copy wins. */
export function mergeStations(creator, catalog, reports = { reports: [] }) {
  const byStation = Object.fromEntries((reports.reports ?? []).map((r) => [r.station, r]));
  return creator.stations.map((s) => {
    const cat = catalog.find((k) => k.id === (s.category ?? s.id)) ?? {};
    return {
      ...cat,
      ...s,
      freq: s.freq ?? cat.freq,
      name: s.name ?? cat.name,
      reportCopy: s.report,
      report: byStation[s.id] ? publicReport(byStation[s.id]) : null,
    };
  });
}

/**
 * The only report fields that may leave the machine: what the page shows.
 * Report links carry a signed token, so `reportPath`, `base` and anything else
 * the seed recorded stay in the private work file.
 */
export function publicReport(r) {
  const images = r.images
    ? Object.fromEntries(Object.entries(r.images).map(([k, v]) => [k, safeImagePath(v)]).filter(([, v]) => v))
    : null;
  return {
    station: r.station,
    title: r.title,
    placements: Array.isArray(r.placements) ? r.placements.map(String) : [],
    distinctScanners: typeof r.distinctScanners === 'number' ? r.distinctScanners : null,
    images: images && images.card && images.desktop ? images : null,
  };
}

const SECRET_PATTERNS = [
  ['signed report link', /sharedReport\?[^"'\s]*token=/i],
  ['token parameter', /[?&]token=[A-Za-z0-9._~%-]{8,}/],
  ['report path field', /"reportPath"\s*:/],
  ['bearer credential', /Bearer\s+[A-Za-z0-9._~+/-]{8,}/],
  ['local admin key', /showcase-local-[0-9a-f]{6,}/],
  ['admin key field', /"adminKey"\s*:/],
  ['JSON web token', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
];
/** Names of the secret shapes found in a published file's text. */
export function findSecrets(text) {
  return SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const IDENTITY_PATTERNS = [
  ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['anonymous cookie', /ose_anon\s*=/i],
  ['anonymous id field', /anon(ymous)?_?id/i],
  ['identifier (UUID)', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
];
/** Never who: names of the identity shapes found in published text. */
export function findIdentities(text) {
  return IDENTITY_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}
