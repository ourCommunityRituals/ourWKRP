// The "where" map: the areas a station's in-person events are in, as inline
// SVG. The showcase does not draw it. OurSharedEvents does, and the build reads
// its answer (GET /api/v2/map/areas, OSE ADR-033), so there is one map renderer:
// the frame, every outline and the street layer come from that one answer, and
// this file holds no projection of its own.
//
// The rules of the hexagon map standard still hold here:
//   - an area is an H3 cell at resolution 7, about 5 square kilometres, and
//     nothing finer is ever asked for or drawn;
//   - a hexagon stands for events, which are public listings, never for people,
//     so the map carries no count of people and needs no floor;
//   - no cell id, coordinate or address is written into the markup: only the
//     projected numbers OurSharedEvents returned;
//   - there is no script and no request from the visitor's browser: the build
//     reads the map once, and the page that carries it is as static as the page
//     without it;
//   - the map is an alternative view. The list beside it is the real content,
//     so when the map cannot be read the page is built with the list alone.
//
// What OurSharedEvents returns is still text from another service, and it goes
// into the page as markup. So nothing of it is used until it has been checked
// here, shape by shape: see `mapFromAnswer` and `streetLayer`.
import { getResolution, isValidCell } from 'h3-js';

/** The one grain a public map is drawn at. */
export const MAP_RESOLUTION = 7;

/** OurSharedEvents frames at most this many areas in one answer. */
export const MAP_AREAS_MAX = 12;

/** An area OSE gave for an event, or null when it is not a resolution-7 cell. */
export function areaCell(cell) {
  return typeof cell === 'string' && isValidCell(cell) && getResolution(cell) === MAP_RESOLUTION ? cell : null;
}

/**
 * A station's upcoming in-person events, by area. An online event is nowhere,
 * so it is left out. An in-person event OSE gives no area for is kept apart: it
 * is still listed, and it is never guessed onto the map.
 *
 * One map holds at most 12 areas, the most OurSharedEvents frames at once. The
 * first 12, soonest event first, are drawn. An event in a later area is kept in
 * `beyond`: still listed, not drawn. Two requests would give two frames, and
 * two frames are not one map.
 *
 * @param {{event: object}[]} upcoming  soonest first
 * @returns {{areas: {cell: string, at: number[]}[], offMap: number[], beyond: number[]}}  indexes into `upcoming`
 */
export function whereAreas(upcoming) {
  const areas = [];
  const offMap = [];
  const beyond = [];
  upcoming.forEach(({ event }, i) => {
    if (event.attendanceMode === 'online') return;
    if (!event.area) {
      if (event.whereAddress || event.venue) offMap.push(i);
      return;
    }
    const seen = areas.find((a) => a.cell === event.area);
    if (seen) seen.at.push(i);
    else if (areas.length < MAP_AREAS_MAX) areas.push({ cell: event.area, at: [i] });
    else beyond.push(i);
  });
  return { areas, offMap, beyond };
}

/** What one station's map is filed under between the read and the page: its cells, in the list's order. */
export const mapKey = (cells) => cells.join(',');

/**
 * The one read a map is: cells only, in the order the list numbers them, with
 * their neighbours. No latitude, longitude or address is ever sent.
 */
export const mapPath = (cells) => `/api/v2/map/areas?cells=${cells.join(',')}&around=1`;

// A frame is a few hundred units a side. Anything far from that is not a frame.
const FRAME_MAX = 4096;
const NUMBER = '-?\\d{1,5}(?:\\.\\d{1,3})?';
const SIX_CORNERS = new RegExp(`^${NUMBER},${NUMBER}(?: ${NUMBER},${NUMBER}){5}$`);

/** A hexagon's `points`, or null: exactly six plain number pairs, every corner inside the frame. */
function outline(points, w, h) {
  if (typeof points !== 'string' || !SIX_CORNERS.test(points)) return null;
  const inside = points.split(' ').every((p) => {
    const [x, y] = p.split(',').map(Number);
    return x >= 0 && x <= w && y >= 0 && y <= h;
  });
  return inside ? points : null;
}

// The street layer is OurSharedEvents' markup: groups, a ground rectangle,
// street paths and place names. Every tag in it is read here, and a tag or an
// attribute that is not on these two lists means it is not a street layer.
// No attribute on the list can load, link, run or style anything, and a value
// is letters, digits, spaces and . , - only, so it holds no address either.
const STREET_SVG_MAX = 2_000_000;
const STREET_TAG = /^<(?:\/(?:g|rect|path|text)|(?:g|rect|path|text)(?: (?:class|aria-hidden|data-testid|data-z|width|height|x|y|d|text-anchor)="[A-Za-z0-9 .,-]*")*\/?)>$/;
// The street rules style the street layer's own classes and nothing else on the page.
const STREET_CSS = /^(?:\.as-[a-z0-9-]+(?:,\.as-[a-z0-9-]+)*\{[^{}<>@\\]*\})+$/;
const STREET_CSS_MAX = 4000;
// OpenStreetMap's credit: one paragraph of text with links to OpenStreetMap and Protomaps, and to nowhere else.
const CREDIT = /^<p class="amap-credit"(?: data-testid="[a-z-]+")?>(?:[^<>]|<a href="https:\/\/(?:www\.openstreetmap\.org|protomaps\.com)(?:\/[A-Za-z0-9/_-]*)?">[^<>]+<\/a>)+<\/p>$/;
const CREDIT_MAX = 600;

/**
 * The street layer of an answer, or null when there is none or it is not what
 * a street layer may be. Streets never show without OpenStreetMap's credit, so
 * a layer whose credit is missing or links anywhere else is dropped whole. A
 * dropped layer leaves the hexagons: it never stops a build.
 *
 * @returns {{svg: string, css: string, credit: string} | null}
 */
export function streetLayer(streets) {
  if (!streets || typeof streets !== 'object') return null;
  const { svg, css } = streets;
  const credit = streets.credit?.html;
  if (typeof svg !== 'string' || typeof css !== 'string' || typeof credit !== 'string') return null;
  if (svg.length > STREET_SVG_MAX || css.length > STREET_CSS_MAX || credit.length > CREDIT_MAX) return null;
  if (!/^<g[ >]/.test(svg) || !svg.endsWith('</g>')) return null;
  const tags = svg.match(/<[^<>]*>/g) ?? [];
  if (tags.some((t) => !STREET_TAG.test(t)) || /[<>]/.test(svg.replace(/<[^<>]*>/g, ''))) return null;
  if (!STREET_CSS.test(css) || /url\s*\(|expression|import|javascript/i.test(css)) return null;
  if (!CREDIT.test(credit) || !credit.includes('https://www.openstreetmap.org/')) return null;
  return { svg, css, credit };
}

/**
 * What the page keeps of OurSharedEvents' answer for `cells`, or null when the
 * answer is not a map of exactly those cells in that order. Only drawn numbers
 * are kept: the cell ids in the answer are compared and then left behind.
 *
 * @param {unknown} body   the route's JSON answer
 * @param {string[]} cells the cells asked for, in the list's order
 * @returns {{w: number, h: number, areas: {points: string, centre: number[]}[], around: {points: string}[], streets: object|null} | null}
 */
export function mapFromAnswer(body, cells) {
  if (!body || body.ok !== true || !body.frame || !Array.isArray(body.areas) || !Array.isArray(body.around)) return null;
  const { w, h } = body.frame;
  if (![w, h].every((n) => Number.isFinite(n) && n > 0 && n <= FRAME_MAX)) return null;
  if (body.areas.length !== cells.length || body.around.length > cells.length * 6) return null;
  const areas = [];
  for (const [i, a] of body.areas.entries()) {
    const points = a?.cell === cells[i] ? outline(a.points, w, h) : null;
    const [x, y] = Array.isArray(a?.centre) && a.centre.length === 2 ? a.centre : [];
    if (!points || ![x, y].every(Number.isFinite) || x < 0 || x > w || y < 0 || y > h) return null;
    areas.push({ points, centre: [x, y] });
  }
  const around = [];
  for (const c of body.around) {
    const points = outline(c?.points, w, h);
    if (!points) return null;
    around.push({ points });
  }
  return { w, h, areas, around, streets: streetLayer(body.streets) };
}

/**
 * The map as inline SVG, in layers from the ground up: OurSharedEvents' street
 * layer when it gave one, the neighbouring areas as outlines, then the areas
 * themselves, see-through and numbered in the order the list gives them.
 *
 * @param {NonNullable<ReturnType<typeof mapFromAnswer>>} map
 */
export function mapSvg(map, { labelledby }) {
  const empty = map.around.map((c) => `<polygon class="hex-empty" points="${c.points}"></polygon>`).join('');
  const filled = map.areas
    .map((a, i) => `<polygon class="hex-area" points="${a.points}"></polygon><text class="hex-number" x="${a.centre[0]}" y="${a.centre[1]}" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`)
    .join('');
  return `<svg class="hex-map" viewBox="0 0 ${map.w} ${map.h}" role="img" aria-labelledby="${labelledby}"><g class="hex-streets">${map.streets ? map.streets.svg : ''}</g><g class="hex-around">${empty}</g><g class="hex-areas">${filled}</g></svg>`;
}
