// The "where" map: the areas a station's in-person events are in, drawn at
// build time as inline SVG, the way OurSharedEvents draws its own maps (the
// hexagon map standard):
//   - an area is an H3 cell at resolution 7, about 5 square kilometres, and
//     nothing finer is ever drawn;
//   - its outline comes from the cell alone, never from a latitude or longitude;
//   - a hexagon stands for events, which are public listings, never for people,
//     so the map carries no count of people and needs no floor;
//   - there is no script and no request to anyone: the page that carries the
//     map is as static as the page without it;
//   - the map is an alternative view. The list beside it is the real content.
import { cellToBoundary, getResolution, gridDisk, isValidCell } from 'h3-js';

/** The one grain a public map is drawn at. */
export const MAP_RESOLUTION = 7;

/** An area OSE gave for an event, or null when it is not a resolution-7 cell. */
export function areaCell(cell) {
  return typeof cell === 'string' && isValidCell(cell) && getResolution(cell) === MAP_RESOLUTION ? cell : null;
}

/**
 * A station's upcoming in-person events, by area. An online event is nowhere,
 * so it is left out. An in-person event OSE gives no area for is kept apart: it
 * is still listed, and it is never guessed onto the map.
 *
 * @param {{event: object}[]} upcoming  soonest first
 * @returns {{areas: {cell: string, at: number[]}[], offMap: number[]}}  indexes into `upcoming`
 */
export function whereAreas(upcoming) {
  const areas = [];
  const offMap = [];
  upcoming.forEach(({ event }, i) => {
    if (event.attendanceMode === 'online') return;
    if (!event.area) {
      if (event.whereAddress || event.venue) offMap.push(i);
      return;
    }
    const seen = areas.find((a) => a.cell === event.area);
    if (seen) seen.at.push(i);
    else areas.push({ cell: event.area, at: [i] });
  });
  return { areas, offMap };
}

const WIDTH = 640;
const HEIGHT = 360;
const PAD = 0.1;

/**
 * The map as inline SVG, in layers from the ground up: a street layer (empty
 * here: the showcase has no streets of its own, and the group is where
 * OurSharedEvents' drawn streets go once it offers them), the neighbouring
 * areas as outlines, then the areas themselves, see-through and numbered in the
 * order the list gives them. No cell id, coordinate or
 * address is written into the markup: only projected numbers.
 */
export function mapSvg(areas, { labelledby }) {
  const own = new Set(areas.map((a) => a.cell));
  const around = [...new Set(areas.flatMap((a) => gridDisk(a.cell, 1)))].filter((c) => !own.has(c));
  const rings = new Map([...own, ...around].map((c) => [c, cellToBoundary(c)]));
  const all = [...rings.values()].flat();
  const lats = all.map((p) => p[0]);
  const lons = all.map((p) => p[1]);
  const latMin = Math.min(...lats);
  const lonMin = Math.min(...lons);
  // Equirectangular with longitude scaled by latitude: true enough across a few cells.
  const kx = Math.cos((((latMin + Math.max(...lats)) / 2) * Math.PI) / 180);
  const spanX = Math.max((Math.max(...lons) - lonMin) * kx, 1e-9);
  const spanY = Math.max(Math.max(...lats) - latMin, 1e-9);
  const scale = Math.min((WIDTH * (1 - 2 * PAD)) / spanX, (HEIGHT * (1 - 2 * PAD)) / spanY);
  const x = (lon) => (lon - lonMin) * kx * scale + (WIDTH - spanX * scale) / 2;
  const y = (lat) => HEIGHT - ((lat - latMin) * scale + (HEIGHT - spanY * scale) / 2);
  const points = (ring) => ring.map((p) => `${x(p[1]).toFixed(1)},${y(p[0]).toFixed(1)}`).join(' ');
  const centre = (ring) => [ring.reduce((n, p) => n + x(p[1]), 0) / ring.length, ring.reduce((n, p) => n + y(p[0]), 0) / ring.length];

  const empty = around.map((c) => `<polygon class="hex-empty" points="${points(rings.get(c))}"></polygon>`).join('');
  const filled = areas
    .map((a, i) => {
      const ring = rings.get(a.cell);
      const [cx, cy] = centre(ring);
      return `<polygon class="hex-area" points="${points(ring)}"></polygon><text class="hex-number" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`;
    })
    .join('');
  return `<svg class="hex-map" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="${labelledby}"><g class="hex-streets"></g><g class="hex-around">${empty}</g><g class="hex-areas">${filled}</g></svg>`;
}
