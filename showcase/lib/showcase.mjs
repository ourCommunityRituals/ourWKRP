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
