# Creator showcase

A private OurWKRP pitch site for one creator, built from data. The creator's roles
are stations on a radio dial, drawn from a shared category catalog. The creator
page is the dial; each station has its own page answering the five Ws and How:
its purpose (why), its programme ("On air"), its upcoming OurSharedEvents (OSE)
events read from OSE at build time, each with its OSE codes as a QR and a link,
and a real SharedReport for a demo event, captured from a local OSE run with
simulated visitors and labelled as demo.

This folder is the **container**. It holds no real creator.

| Path | What it is |
| --- | --- |
| `categories.json` | The station catalog. A category may be used by no creator yet (Spirit is `future`). |
| `fixtures/sample-creator.json` | Sam Sample, a fictional creator. CI builds only this. |
| `fixtures/sample-ose-events.json` | The OSE events Sam's file links, by day rather than date: the local seed creates them, and the tests stand them in for OSE. |
| `creators/` | Real creator files. **Git ignores every `*.json` here**: a real creator file names a real person and is shared only as a private page. |
| `lib/` | `showcase.mjs` (floor, merge, pacing, allowlists, secret and identity detectors), `schema.mjs` (the creator and catalog contract, v2), `schedule.mjs` (programme slots, intents, On air), `ose.mjs` (the build's public OSE reads and the neutral-name check), `codes.mjs` (OSE `/q` and `/s` codes, drawn with OW's QR encoder `src/lib/qr.ts`), `render.mjs` (the pages), `build.mjs` (the publish and code gates), `plan.mjs` (seed-plan dates), `theme.mjs` (`theme.css` generator). |
| `theme.css` | GENERATED from the pinned `@ocr/ui`: the token sheet plus the OW brand. Never edit it. The page holds no colour value of its own. |
| `.ose-ref` | The OurSharedEvents commit CI seeds against. |
| `seed-local.mjs`, `capture-reports.mjs`, `build-page.mjs` | The three steps, below. |
| `start-local-ose.ps1`, `start-local-ose.sh` | Start a throwaway local OSE worker with random keys. |
| `tests/` | The pyramid in `TESTING.md`, run by `.github/workflows/showcase.yml`. |

## Privacy

- `work/<slug>/reports.json` holds signed SharedReport links. It is git-ignored and never published.
- `local-ose.env.json` holds the throwaway local admin key. It is git-ignored.
- `out/<slug>/` is the only publishable folder: `index.html`, `<station>/index.html` per station, `tv/index.html` when the file asks for the TV board, a public `reports.json` (counts and image paths only) and `img/`. Share it as a folder or a zip. The build refuses to write it if any text in it carries a signed link, a key, a token, an email address, an anonymous cookie or an id, or if any code on it is not an OSE `/q` or `/s` URL.
- Seeding and capture refuse any worker that is not `127.0.0.1` or `localhost`. The build reads OSE's public API only (GET, no key), from a local worker or OSE staging, never production.
- Until the creator agrees, OSE carries neutral text only. The build stops if anything it reads from OSE names her, a name in `privateNames`, a place or one of her links.
- Place links are plain: shown exactly as the creator file gives them, never counted.

## The creator file (contract v2)

Version 1 files still validate. Version 2 adds, all optional:

| Field | What it is |
| --- | --- |
| `places[]` as `{ label, note, url, station, kind }` | An https link on a station page. `kind`: store, school, product, social, calendar, other. |
| `stations[].why` | The frequency's purpose. Required once it has events or a programme. |
| `stations[].programme[]` | Slots: `cadence` (daily-weekdays, weekly, biweekly, monthly, as-announced), `day`, `week` (monthly), `time`, `timezone`, `mode` (online, in_person, both), `kind` (one of the category's `eventKinds`), `purpose`. |
| `oseBrand` | The OSE brand the events live on (never `root`). |
| `events[]` | `{ frequency, also?, oseEventId, intent, placement?, until? }`. `frequency` is the station the event lives on; `also` lists other stations it shows on (see Overlap); `intent` is one-off, pop-up, programme or trial; `placement` is the showcase placement (its `/q` code); `until` ends a pop-up's window (OSE events have no end time). |
| `campaigns[]` | `{ frequency, oseCampaignId }`. The campaign's partner shows once at the top of that station, only when OSE's public sponsor bundle lists a sponsor under that campaign on one of the station's upcoming events (OSE S14). Lead takes a whole-dial campaign. |
| `stations[].event.placements[]` | 1 to 4 short labels (40 characters each) for where a demo event's codes hung, in the instance's own words. Absent: the demo size's labels. |
| `layout` | How the stations are laid out: `dial` (the default), `list` (a column) or `grid` (cards). List and grid draw no dial and show each station's title. |
| `stationOrder` | `file` (the default: the file's order) or `next-event` (soonest next event first; a station with nothing upcoming after those; Lead last). |
| `sections` | Switches, each `true` or `false`, all shown by default: `values`, `scatter` ("Where the work lives"), `reports`, `schedule`, `sources`. `sources: false` is refused while the file lists any source. |
| `display` | `page` (the default) or `tv`: also build `tv/index.html`, a board for a screen in the room. |
| `privateNames[]` | Other names she or her ventures go by. Never shown; kept out of OSE text. |
| `schedule.rows[]` 5th item | The OSE event id a copied row became. That row leaves the copied table. |

## Any instance, not only a creator

The same container builds a site for a person, a venue or an organizer. The fixed
sentences use the instance's `name` where a person would be named, and list the
event kinds its own stations run (each station's demo `event.kind`, then its
programme slots' kinds), so a bar reads "game night" and is never told about a
class it does not hold. Give a demo event its own `placements` when the size's
labels do not fit.

## Overlap: stations are a way in, not boxes

The dial, the stations and their frequencies are a playful way to present what
someone does. They carry no meaning the system depends on, and they overlap
(owner, 2026-11-13: function over fashion, always; playful, not a joke).

- An event or a campaign has one home, `frequency`, and may list other stations in `also`. It then shows on each of them.
- Its codes stay on the station it lives on. Elsewhere its card names that station and links to it, so one event has one set of codes and its counts are not split by where it was listed. The TV board keeps the codes, since nobody can tap through on a screen.
- A programme event is held to the slots of the station it lives on, and stands under "On air" there only.
- Lead shows every station already, so it is never listed in `also`. An event is still linked once.

## Online or in person

Every event says how it is held, as OurSharedEvents states it: online, in
person, or both. The card carries that. An online event has no place: its card
reads "Online", and it is not on the map. An event held both ways keeps its
place. A `programme` event must be held the way its slot says, or the build stops.

## The where map

A station page maps its in-person events by area, below the events themselves.
The showcase does not draw the map. OurSharedEvents does, and the build reads
its drawing, so there is one map renderer (OW-217, OSE ADR-033):

```
GET <OSE>/api/v2/map/areas?cells=<cell>,<cell>…&around=1
```

- One read per station, at build time, with the station's areas in the order its list numbers them. Cells only: no coordinate and no address is ever sent, and the page asks nothing of anyone.
- An area is an H3 cell at resolution 7, about 5 square kilometres. Nothing finer is kept, asked for or drawn: the build reads the area OSE publishes for an event and leaves its coordinates behind.
- The map shows where events are, never where people are, so it carries no count of people.
- The frame (600 by 360), each outline and each number's place are used exactly as OurSharedEvents returns them. No cell id or coordinate is written into the page.
- When the answer carries a street layer, it goes under the see-through areas, its rules go in the page's stylesheet, and OpenStreetMap's credit shows beside the map. No streets, no credit. OSE staging answers with no streets until its street archive is loaded (OSE-1883).
- Nothing in the answer is trusted. A street layer that holds anything but groups, a rectangle, paths and text, rules that style anything but the street layer, or a credit that links anywhere but OpenStreetMap and Protomaps is left out, and the hexagons stay. An outline, a centre or a frame that is not plain numbers inside the frame, or an answer for other cells, means no map.
- The read never stops a build. Late (10 seconds), refused, rate-limited or not a map: the page is built with the list alone and says the map could not be drawn, and the build prints why. It is not retried; the next build reads again. There is no second drawing to fall back on.
- One map holds 12 areas, the most OurSharedEvents frames. A station with more draws its first 12 (soonest event first) and lists the events in the others below.
- Map reads are at least 200 ms apart, so a build of many stations stays under the 6 a second OurSharedEvents asks for.
- The map is never the only route. The same events are listed below it, each linked to its card, and an in-person event with no area yet is listed too.

An online event is nowhere, so it is not on the map. `sections.map: false` hides the map, and then it is not read. Building needs `h3-js` only to check that an area is a resolution-7 cell (a dev dependency: nothing is added to the Worker).

## A programme is declared in OurSharedEvents

A `programme` slot in the creator file says when a station is on air. The
organizer also declares that programme in OurSharedEvents as a series. The
build holds the two together:

- an upcoming `programme` event must sit on a declared series;
- the series and the slot must state the same cadence, weekday and hour (a series that names no day or hour agrees with any);
- the event's card names the series.

A one-off, a pop-up or a trial needs no series. A trial joins one when the organizer promotes it.

## Partners and the calendar feed

A sponsor reaches a page only from OurSharedEvents' public sponsor bundle, where
both sides have accepted and the event has sponsors switched on. Nothing in the
creator file can add one.

- On an event card the strip reads "Backed by", below the title and date.
- A campaign the creator file puts on a frequency shows its partner once, at the top of that station.
- The only link is the event's own SPONSOR code, so a tap is counted like any other code. The page sends OSE nothing else: no impression or click beacon, no logo request.
- A sponsor is text, never a control: nobody can filter, search or sort by it.

Where OSE serves the brand's calendar feed, the creator page links it under
"When" as a plain link. The page counts nothing on it.

## The TV board (`display: tv`)

A screen in the room, built beside the pages at `tv/index.html`. Large type, one
station at a time, each with its programme and its next two events and their
codes. A display shows no counts, so no report is drawn on it. Lead is left
off: it is the whole dial and would repeat every other panel.

A rotating screen must never take a code away from someone lining up a phone, so:

- each panel stays up long enough to read: 3 s to notice, reading at 100 words a minute, 2 s to act, never under 14 s;
- any key, tap or click holds the panel for 20 s, with the time left on screen;
- Pause stops the rotation until Resume;
- with reduced motion, or without the script, every panel shows and nothing rotates.

An unknown layout, order, display or section stops the build. It never falls back silently.

## Make a page

From the repository root, with OurSharedEvents checked out beside it:

```bash
pwsh showcase/start-local-ose.ps1 -Worker ../ourSharedEvents/workers/oursharedevents
```

Then, in a second terminal:

```bash
node showcase/seed-local.mjs showcase/creators/<slug>.json
```

```bash
node showcase/capture-reports.mjs <slug>
```

```bash
node showcase/build-page.mjs showcase/creators/<slug>.json
```

For a real creator, `build-page.mjs` reads her linked events from the base in
`--ose` (or the local worker): the owner makes them on OSE staging by hand, with
neutral titles, and builds with `--ose https://stg.oursharedevents.com`. The
fixture's events come from its plan instead: seed with
`--plan showcase/fixtures/sample-ose-events.json` and build
`showcase/work/sample-creator/creator.json`.

The seed sends at most 50 scans a minute (OSE counts about 60 a minute from one
caller), so a creator with many stations takes a few minutes. Publish
`out/<slug>/` privately.

## Tests

```bash
npm run test:showcase
```

```bash
npm run test:showcase:e2e
```

Regenerate `theme.css` after a hub pin bump:

```bash
UPDATE_THEME=1 npx vitest run --config showcase/vitest.config.mjs showcase/tests/contract.test.mjs
```
