// A stand-in for OSE's public API, built from the fixture's seed plan, so the
// read, render and gate layers are tested without a worker. It answers the
// public reads the build makes, in OSE's own response shapes (see
// handlers/events.ts, handlers/poster-bundle.ts and handlers/sponsors.ts at the
// .ose-ref commit). All of it is served at that commit: a sponsor's
// `campaign: { id, title }` in the sponsor bundle, the brand calendar feed at
// /brands/<brand>/calendar.ics, and the declared series beside each event
// (`series`, OSE ADR-029), and the public area map (`/api/v2/map/areas`, OSE
// ADR-033; handlers/map-areas.ts and lib/street-map.ts). The contract layer
// holds the map stand-in to an answer recorded from OSE staging.
// The integration layer runs the same build against a real local worker.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cellToBoundary, cellToLatLng, getResolution, gridDisk, isValidCell, latLngToCell } from 'h3-js';
import { planDate, zonedInstant } from '../lib/plan.mjs';

const SHOWCASE = join(dirname(fileURLToPath(import.meta.url)), '..');

export const FAKE_ORIGIN = 'http://127.0.0.1:8917';
/** A fixed Monday, so every test reads the same programme. */
export const NOW = Date.parse('2026-11-16T15:00:00Z');

export const plan = () => JSON.parse(readFileSync(join(SHOWCASE, 'fixtures', 'sample-ose-events.json'), 'utf8'));

const WORDS = { public: 'EVENT', website: 'MORE', checkin: 'CHECK IN', register: 'REGISTER', tickets: 'TICKETS', sponsor: 'SPONSOR', signup: 'SIGN UP' };
const PREFIX = { public: 'Ev', website: 'Wb', checkin: 'Ck', register: 'Rg', tickets: 'Tk', sponsor: 'Sp', signup: 'Su' };
const num = (ref) => ref.replace(/\D/g, '').padStart(4, '0');

/** The public projection of one plan event, as OSE would serve it. */
export function planItem(ev, { brand, now }) {
  const day = planDate(ev.on, now, ev.timezone);
  return {
    id: ev.ref,
    brand_id: ev.brand ?? brand,
    title: ev.title,
    name: ev.title,
    status: ev.state === 'draft' ? 'draft' : 'active',
    start_date: day,
    end_date: day,
    timezone: ev.timezone,
    starts_at: ev.time ? zonedInstant(day, ev.time, ev.timezone) : null,
    what_short: ev.what_short ?? null,
    who_host: ev.who_host ?? null,
    why_purpose: ev.why_purpose ?? null,
    how_details: ev.how_details ?? null,
    where_address: ev.where_address ?? null,
    location: ev.where_address ?? null,
    venue: ev.where_address ?? null,
    // How the event is held (OSE S13). OSE requires it at create; a row from before the field reads in person.
    attendance_mode: ev.mode ?? 'in_person',
    // OSE derives an event's cells from the coordinates an admin gives (lib/h3-tagging.ts)
    // and serves the event's place in its public read: lat, lon and the resolution-7 cell.
    lat: ev.lat ?? null,
    lon: ev.lon ?? null,
    h3_res7: Number.isFinite(ev.lat) && Number.isFinite(ev.lon) ? latLngToCell(ev.lat, ev.lon, 7) : null,
  };
}

/**
 * One sponsor row of the public bundle. Like OSE, it carries more than a page
 * may show: tokens, a website and a tier, which the build must leave behind.
 */
const sponsorRow = (sp, eventId) => ({
  id: sp.id,
  event_id: eventId,
  name: sp.name,
  title: sp.name,
  logo_url: `/api/v2/sponsors/${sp.id}/logo`,
  website_url: `https://partner.example.org/${sp.id}`,
  card_url: `/sponsors/${sp.id}`,
  tier: 'gold',
  click_token: `ct_${sp.id}`,
  display_token: `dt_${sp.id}`,
  beacon_token: `bt_${sp.id}`,
  is_active: 1,
  ...(sp.campaign ? { campaign: { id: sp.campaign.id, title: sp.campaign.title } } : {}),
});

/** Both sides said yes: the stand-in for OSE's SPONSOR_ON_SHOW_SQL. */
const onShow = (sp) => sp.sponsorAccepted !== false && sp.organizerAccepted !== false;

// ── The public area map, as OSE draws it (lib/street-map.ts) ─────────────────
const MAP_W = 600;
const MAP_H = 360;
const MAX_AREA_CELLS = 12;
const COORDINATE_PARAMS = ['lat', 'lon', 'lng', 'latitude', 'longitude', 'coords', 'coordinates', 'position', 'geo'];

/** Latitude and longitude to Web Mercator world units, origin top-left. */
function toWorld(lat, lng) {
  const s = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

function frameForCells(cells, w = MAP_W, h = MAP_H, pad = 0.08) {
  const pts = cells.flatMap((c) => cellToBoundary(c).map(([lat, lng]) => toWorld(lat, lng)));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [xMin, xMax, yMin, yMax] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((w * (1 - 2 * pad)) / Math.max(xMax - xMin, 1e-9), (h * (1 - 2 * pad)) / Math.max(yMax - yMin, 1e-9));
  return { w, h, scale, x0: (xMin + xMax) / 2 - w / 2 / scale, y0: (yMin + yMax) / 2 - h / 2 / scale };
}

const fx = (v) => Number(v.toFixed(1));
const project = (f, lat, lng) => {
  const [x, y] = toWorld(lat, lng);
  return [(x - f.x0) * f.scale, (y - f.y0) * f.scale];
};
const outline = (f, cell) => cellToBoundary(cell).map(([lat, lng]) => project(f, lat, lng)).map(([x, y]) => `${fx(x)},${fx(y)}`).join(' ');

/**
 * OSE's answer to GET /api/v2/map/areas, as `{ status, body }`. Like OSE
 * staging today (no street archive loaded), `streets` is null.
 */
export function mapAreasAnswer(searchParams) {
  const refuse = (code) => ({ status: 400, body: { ok: false, status: 400, code, error: code } });
  for (const name of searchParams.keys()) if (COORDINATE_PARAMS.includes(name.toLowerCase())) return refuse('COORDINATES_NOT_ACCEPTED');
  const raw = searchParams.getAll('cells').join(',');
  if (!raw) return refuse('CELLS_REQUIRED');
  const cells = [...new Set(raw.split(','))];
  if (cells.length > MAX_AREA_CELLS) return refuse('TOO_MANY_CELLS');
  for (const cell of cells) {
    if (!isValidCell(cell)) return refuse('CELL_INVALID');
    if (getResolution(cell) !== 7) return refuse('CELL_RESOLUTION');
  }
  const aroundParam = searchParams.get('around');
  if (aroundParam !== null && aroundParam !== '0' && aroundParam !== '1') return refuse('AROUND_INVALID');
  const own = new Set(cells);
  const around = aroundParam === '1' ? [...new Set(cells.flatMap((c) => gridDisk(c, 1)))].filter((c) => !own.has(c)) : [];
  const frame = frameForCells([...cells, ...around]);
  return {
    status: 200,
    body: {
      ok: true,
      status: 200,
      frame: { projection: 'web-mercator', w: frame.w, h: frame.h, scale: frame.scale, x0: frame.x0, y0: frame.y0 },
      areas: cells.map((cell, i) => {
        const [x, y] = project(frame, ...cellToLatLng(cell));
        return { cell, n: i + 1, points: outline(frame, cell), centre: [fx(x), fx(y)] };
      }),
      around: around.map((cell) => ({ cell, points: outline(frame, cell) })),
      streets: null,
    },
  };
}

/**
 * A street layer in the shape OSE returns one (lib/street-map.ts `STREET_STYLE`
 * and its layer markup, lib/attendee-map.ts `streetCredit`), for a test to
 * plant in an answer. Staging serves none until its street archive is loaded,
 * so this is the stand-in's copy of the shape, not a recorded answer.
 */
export const fakeStreets = () => ({
  svg: '<g class="amap-s" aria-hidden="true" data-testid="amap-streets" data-z="12"><rect class="as-l" width="600" height="360"/><path class="as-w" d="M0,300L600,320L600,360L0,360Z"/><path class="as-v" d="M10,10L80,60"/><path class="as-r as-1" d="M0,40L600,60M120,0L140,360"/><path class="as-r as-2" d="M0,180L600,200"/><path class="as-r as-3" d="M300,0L320,360"/><text class="as-t" x="150" y="90" text-anchor="middle">Springfield &amp; O&#39;Fallon</text></g>',
  css: '.as-l{fill:var(--surface)}.as-w{fill:var(--info);opacity:.3}.as-v,.as-r{fill:none;stroke-linecap:round}.as-v{stroke:var(--info);opacity:.5;stroke-width:2}.as-r{stroke:var(--border-strong)}.as-1{stroke:var(--border);stroke-width:1.2}.as-2{stroke-width:2.5}.as-3{stroke-width:4}.as-t{fill:var(--text-muted);font:600 22px system-ui;paint-order:stroke;stroke:var(--bg);stroke-width:4}',
  credit: {
    html: '<p class="amap-credit" data-testid="amap-credit">Street map data © <a href="https://www.openstreetmap.org/copyright/en">OpenStreetMap</a> contributors, prepared by <a href="https://protomaps.com">Protomaps</a>.</p>',
    osm: 'https://www.openstreetmap.org/copyright/en',
  },
});

/**
 * A fetch that answers like OSE. `edit(kind, body)` may change a response
 * before it is sent, and `fail(kind, id)` may return a status to answer with
 * instead, for tests that plant a fault in what OSE returns.
 */
export function fakeOse({ brand = 'showcase-sample', now = NOW, origin = FAKE_ORIGIN, calls = [], edit = (_k, b) => b, fail = () => null, events = plan().events, series = plan().series ?? [] } = {}) {
  const items = events.map((ev) => [ev, planItem(ev, { brand, now })]);
  // The confirmed series an event sits on, as OSE's public read shows it: five fields.
  const seriesOf = (ref) => {
    const s = series.find((x) => x.events.includes(ref));
    return s ? { id: s.ref, name: s.name, cadence: s.cadence, day_of_week: s.day_of_week ?? null, hour_of_day: s.hour_of_day ?? null } : null;
  };
  const json = (status, body) => new globalThis.Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(String(url));
    if (u.origin !== origin) throw new Error(`fake OSE: unexpected origin ${u.origin}`);
    if (u.pathname === '/api/v2/map/areas') {
      const failed = fail('map', u.searchParams.get('cells'));
      if (failed) return json(failed, { ok: false, status: failed, code: failed === 429 ? 'RATE_LIMITED' : 'PLANTED', error: 'planted failure' });
      const answer = mapAreasAnswer(u.searchParams);
      return json(answer.status, answer.status === 200 ? edit('map', answer.body) : answer.body);
    }
    if (u.pathname === '/api/v2/events') {
      const b = u.searchParams.get('brand') || 'root';
      const shown = items.filter(([, i]) => i.brand_id === b && i.status === 'active').map(([, i]) => i);
      const onSeries = Object.fromEntries(shown.map((i) => [i.id, seriesOf(i.id)]).filter(([, s]) => s));
      return json(200, edit('list', { ok: true, status: 200, items: shown, sponsor_titles: {}, series: onSeries }));
    }
    const feed = u.pathname.match(/^\/brands\/([^/]+)\/calendar\.ics$/);
    if (feed) {
      const b = decodeURIComponent(feed[1]);
      const shown = items.filter(([, i]) => i.brand_id === b && i.status === 'active').map(([, i]) => i);
      const failed = fail('calendar', b);
      if (failed || !shown.length) return new globalThis.Response('Not found', { status: failed || 404 });
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...shown.flatMap((i, k) => ['BEGIN:VEVENT', `UID:event-${k + 1}@ose.example`, `SUMMARY:${i.title}`, `DTSTART;VALUE=DATE:${i.start_date.replaceAll('-', '')}`, 'END:VEVENT']), 'END:VCALENDAR', ''];
      return new globalThis.Response(edit('calendar', { text: lines.join('\r\n') }).text, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
    }
    const bundle = u.pathname.match(/^\/api\/v2\/events\/([^/]+)\/poster-bundle$/);
    const backing = u.pathname.match(/^\/api\/v2\/events\/([^/]+)\/sponsor-bundle$/);
    const one = u.pathname.match(/^\/api\/v2\/events\/([^/]+)$/);
    const id = decodeURIComponent((bundle ?? backing ?? one)?.[1] ?? '');
    const hit = items.find(([, i]) => i.id === id);
    if (!hit) return json(404, { ok: false, status: 404, error: 'Event not found' });
    const [ev, item] = hit;
    if (item.status !== 'active') return json(403, { ok: false, status: 403, code: 'NOT_RENDERABLE' });
    const failed = fail(bundle ? 'bundle' : backing ? 'sponsors' : 'event', id);
    if (failed) return json(failed, { ok: false, status: failed, error: 'planted failure' });
    if (one) return json(200, edit('event', { ok: true, status: 200, item, series: seriesOf(id) }, id));
    if (backing) {
      const rows = (ev.sponsors ?? []).filter(onShow).map((sp) => sponsorRow(sp, id));
      return json(200, edit('sponsors', { ok: true, status: 200, bundle: { sponsors: rows, surface_sponsors: { posterTop: rows, tvTop: rows, tvSide: rows, mobileBanner: rows }, rotation_config: { sponsorSlots: Math.max(rows.length, 1), rotationMs: 5000 } } }, id));
    }
    const n = num(ev.ref);
    const dep = u.searchParams.get('deployment');
    const deployment = dep && dep === ev.placementRef ? { id: dep, token: `qrt_${n.padStart(16, '0')}` } : null;
    const links = {};
    for (const type of ['register', 'checkin', 'survey', 'email-signup']) {
      links[type] = deployment ? `${origin}/q/${deployment.token}?type=${type}` : `${origin}/events/${id}/forms/${type}`;
    }
    const slots = [{ kind: 'public' }, ...(ev.codes ?? [])].map((c) => ({
      kind: c.kind,
      word: WORDS[c.kind] ?? c.kind.toUpperCase(),
      label: WORDS[c.kind] ?? c.kind,
      code: `${PREFIX[c.kind] ?? 'Xx'}${n}`,
      url: `${origin}/s/${PREFIX[c.kind] ?? 'Xx'}${n}`,
      qr: 'data:image/png;base64,AAAA',
    }));
    return json(200, edit('bundle', { ok: true, status: 200, eventId: id, event: item, eventStatus: 'active', deploymentId: deployment?.id ?? null, qr: {}, links, labels: {}, slots, sponsors: [] }));
  };
}
