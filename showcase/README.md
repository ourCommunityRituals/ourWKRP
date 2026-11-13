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
- `out/<slug>/` is the only publishable folder: `index.html`, `<station>/index.html` per station, a public `reports.json` (counts and image paths only) and `img/`. Share it as a folder or a zip. The build refuses to write it if any text in it carries a signed link, a key, a token, an email address, an anonymous cookie or an id, or if any code on it is not an OSE `/q` or `/s` URL.
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
| `events[]` | `{ frequency, oseEventId, intent, placement?, until? }`. `frequency` is a station id; `intent` is one-off, pop-up, programme or trial; `placement` is the showcase placement (its `/q` code); `until` ends a pop-up's window (OSE events have no end time). |
| `campaigns[]` | `{ frequency, oseCampaignId }`. Validated now; shown once OSE serves campaigns (S14, S9). |
| `stations[].event.placements[]` | 1 to 4 short labels (40 characters each) for where a demo event's codes hung, in the instance's own words. Absent: the demo size's labels. |
| `privateNames[]` | Other names she or her ventures go by. Never shown; kept out of OSE text. |
| `schedule.rows[]` 5th item | The OSE event id a copied row became. That row leaves the copied table. |

## Any instance, not only a creator

The same container builds a site for a person, a venue or an organizer. The fixed
sentences use the instance's `name` where a person would be named, and list the
event kinds its own stations run (each station's demo `event.kind`, then its
programme slots' kinds), so a bar reads "game night" and is never told about a
class it does not hold. Give a demo event its own `placements` when the size's
labels do not fit.

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
