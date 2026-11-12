// A stand-in for OSE's public API, built from the fixture's seed plan, so the
// read, render and gate layers are tested without a worker. It answers the
// three public reads the build makes, in OSE's own response shapes (see
// handlers/events.ts and handlers/poster-bundle.ts at the .ose-ref commit).
// The integration layer runs the same build against a real local worker.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  };
}

/**
 * A fetch that answers like OSE. `edit(kind, body)` may change a response
 * before it is sent, for tests that plant a fault in what OSE returns.
 */
export function fakeOse({ brand = 'showcase-sample', now = NOW, origin = FAKE_ORIGIN, calls = [], edit = (_k, b) => b, events = plan().events } = {}) {
  const items = events.map((ev) => [ev, planItem(ev, { brand, now })]);
  const json = (status, body) => new globalThis.Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(String(url));
    if (u.origin !== origin) throw new Error(`fake OSE: unexpected origin ${u.origin}`);
    if (u.pathname === '/api/v2/events') {
      const b = u.searchParams.get('brand') || 'root';
      return json(200, edit('list', { ok: true, status: 200, items: items.filter(([, i]) => i.brand_id === b && i.status === 'active').map(([, i]) => i), sponsor_titles: {} }));
    }
    const bundle = u.pathname.match(/^\/api\/v2\/events\/([^/]+)\/poster-bundle$/);
    const one = u.pathname.match(/^\/api\/v2\/events\/([^/]+)$/);
    const id = decodeURIComponent((bundle ?? one)?.[1] ?? '');
    const hit = items.find(([, i]) => i.id === id);
    if (!hit) return json(404, { ok: false, status: 404, error: 'Event not found' });
    const [ev, item] = hit;
    if (item.status !== 'active') return json(403, { ok: false, status: 403, code: 'NOT_RENDERABLE' });
    if (one) return json(200, edit('event', { ok: true, status: 200, item }));
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
