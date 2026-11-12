# Creator showcase

A private OurWKRP pitch page for one creator, built from data. The creator's roles
are stations on a radio dial, drawn from a shared category catalog. Each station
with an event shows a real OurSharedEvents (OSE) SharedReport for a demo event,
captured from a local OSE run with simulated visitors and labelled as demo.

This folder is the **container**. It holds no real creator.

| Path | What it is |
| --- | --- |
| `categories.json` | The station catalog. A category may be used by no creator yet (Spirit is `future`). |
| `fixtures/sample-creator.json` | Sam Sample, a fictional creator. CI builds only this. |
| `creators/` | Real creator files. **Git ignores every `*.json` here**: a real creator file names a real person and is shared only as a private page. |
| `lib/` | `showcase.mjs` (floor, merge, pacing, allowlists, secret and identity detectors), `schema.mjs` (the creator and catalog contract), `render.mjs` (the page), `build.mjs` (the publish gate), `theme.mjs` (`theme.css` generator). |
| `theme.css` | GENERATED from the pinned `@ocr/ui`: the token sheet plus the OW brand. Never edit it. The page holds no colour value of its own. |
| `.ose-ref` | The OurSharedEvents commit CI seeds against. |
| `seed-local.mjs`, `capture-reports.mjs`, `build-page.mjs` | The three steps, below. |
| `start-local-ose.ps1`, `start-local-ose.sh` | Start a throwaway local OSE worker with random keys. |
| `tests/` | The pyramid in `TESTING.md`, run by `.github/workflows/showcase.yml`. |

## Privacy

- `work/<slug>/reports.json` holds signed SharedReport links. It is git-ignored and never published.
- `local-ose.env.json` holds the throwaway local admin key. It is git-ignored.
- `out/<slug>/` is the only publishable folder: `index.html`, a public `reports.json` (counts and image paths only) and `img/`. The build refuses to write it if any text in it carries a signed link, a key, a token, an email address, an anonymous cookie or an id.
- Seeding and capture refuse any worker that is not `127.0.0.1` or `localhost`.

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
