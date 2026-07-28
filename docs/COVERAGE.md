# Test Coverage Map — ourWKRP

> **Living document.** This is the source of truth for what is *actually* tested by **wired**
> automation (in CI), per endpoint and per user flow. Update it as each
> [OW-88](https://linear.app/oursharedevents/issue/OW-88) story closes — coverage docs that
> drift are worse than none.

## Definition of Done (the standard this map enforces)

1. **Every feature/story/code ships executable tests that prove it works or not** — explicitly
   including automated **Postman (API)** + **Playwright (E2E)** flows wired into CI, not just unit tests.
2. **Existing functionality is held to the same bar** — backfilled, nothing exempt.
3. **Two-phased pipeline**: a fast **check-in layer** (lint, typecheck, contract, unit, security,
   secret-scan, fuzz) gates the **automation layer** (Postman API + Playwright E2E).

## How to read this

| Mark | Meaning |
|------|---------|
| ✅ | Wired into CI **and** asserts behavior |
| 🟡 | Renders / runs but assertions are thin (doesn't prove behavior) |
| 🔴 | No wired automated coverage at any layer |
| — | N/A at this layer |

"Wired" = runs in CI. The **`ourwkrp.api.postman_collection.json`** collection is **NOT counted** — it
has 42 requests but zero assertions and is wired into nothing (see [OW-95](https://linear.app/oursharedevents/issue/OW-95)).
Only `ourwkrp.postman_collection.json` (Core Flows) runs via `npm run test:postman`.

**Out of scope here:** security *controls* (rate limit, CSP, CSRF, headers) are covered by the
security test tier + deploy smoke under [OW-78](https://linear.app/oursharedevents/issue/OW-78) /
[OW-87](https://linear.app/oursharedevents/issue/OW-87). This map is feature/flow coverage.

---

## API endpoints

### Launch path

| Method | Path | Postman | E2E | Status | Story |
|--------|------|:------:|:---:|--------|-------|
| GET | `/health` | ✅ | — | covered | — |
| POST | `/auth/register` | ✅ | ✅ | covered (heavy E2E setup + identity boundaries) | — |
| GET | `/auth/start` | 🔴 | ✅ | redirect asserted (name+gen) | — |
| GET | `/auth/callback` | 🔴 | 🔴 | **gap** — OAuth completion untested | [OW-94](https://linear.app/oursharedevents/issue/OW-94) |
| POST | `/auth/logout` | 🔴 | 🔴 | **gap** — session teardown untested | [OW-89](https://linear.app/oursharedevents/issue/OW-89) |
| GET | `/auth/session/me` | ✅ | ✅ | covered (401/200 identity boundary) | — |
| POST | `/import/:contributorId` | ✅ | 🟡 | happy path only; error/cap paths missing | [OW-93](https://linear.app/oursharedevents/issue/OW-93) |
| GET | `/api/tracks` | ✅ | 🟡 | API covered; search/filter behavior thin | [OW-92](https://linear.app/oursharedevents/issue/OW-92) |
| GET | `/api/stats` | ✅ | 🟡 | API covered; page visibility-only | — |
| GET | `/api/contributors` | 🔴 | — | gap | [OW-90](https://linear.app/oursharedevents/issue/OW-90) |
| GET | `/api/contributors/:id` | 🔴 | — | gap | [OW-90](https://linear.app/oursharedevents/issue/OW-90) |
| GET | `/api/contributors/:id/brands` | 🔴 | — | gap | [OW-90](https://linear.app/oursharedevents/issue/OW-90) |
| GET | `/api/contributors/:id/portfolio` | 🔴 | ✅ | covered via portfolio UI; direct API assertion missing | [OW-90](https://linear.app/oursharedevents/issue/OW-90) |
| GET | `/api/layers` | 🔴 | — | gap | [OW-90](https://linear.app/oursharedevents/issue/OW-90) |
| GET | `/api/brands` | 🔴 | — | gap | [OW-90](https://linear.app/oursharedevents/issue/OW-90) |
| DELETE | `/api/contributors/:id/identity` | 🔴 | 🔴 | **gap (privacy-critical)** — erasure unit-tested only | [OW-89](https://linear.app/oursharedevents/issue/OW-89) |
| POST | `/api/playlists` | ✅ | 🟡 | create API covered; E2E renders form but never creates | [OW-91](https://linear.app/oursharedevents/issue/OW-91) |
| GET | `/api/playlists/:id` | ✅ | — | covered (single + by-contributor) | — |
| POST | `/api/playlists/:id/tracks` | ✅ | — | add covered | — |
| DELETE | `/api/playlists/:id/tracks` | 🔴 | — | gap — remove untested | [OW-91](https://linear.app/oursharedevents/issue/OW-91) |
| GET | `/api/playlists/:id/export` | 🔴 | — | gap | [OW-91](https://linear.app/oursharedevents/issue/OW-91) |
| POST | `/api/portfolio` | 🔴 | ✅ | covered via UI; direct API assertion missing | [OW-90](https://linear.app/oursharedevents/issue/OW-90) |
| DELETE | `/api/portfolio/:id` | 🔴 | ✅ | covered via UI; direct API assertion missing | [OW-90](https://linear.app/oursharedevents/issue/OW-90) |

### Post-launch (tracked, not launch-blocking)

| Method | Path | Status | Story |
|--------|------|--------|-------|
| POST | `/spotify/sync/:userId` | legacy/deprecated — decide test-or-retire | [OW-101](https://linear.app/oursharedevents/issue/OW-101) |
| POST | `/api/sets`, `/api/sets/:id/tracks`, `/api/sets/:id/end` | 🔴 DJ attribution engine (Fist of Five) | [OW-98](https://linear.app/oursharedevents/issue/OW-98) |
| POST | `/api/attributions` | 🔴 DJ attribution engine | [OW-98](https://linear.app/oursharedevents/issue/OW-98) |
| GET | `/dj/:id/stats`, `/dj/:id/live` | 🔴 (live page offline-state covered in E2E) | [OW-98](https://linear.app/oursharedevents/issue/OW-98) |
| GET | `/auth/lastfm/start`, `/auth/lastfm/callback` | 🔴 Last.fm | [OW-99](https://linear.app/oursharedevents/issue/OW-99) |
| POST | `/lastfm/sync/:userId` · GET `/lastfm/status/:userId` | 🔴 Last.fm | [OW-99](https://linear.app/oursharedevents/issue/OW-99) |
| GET | `/api/export/tracks` | 🔴 | [OW-100](https://linear.app/oursharedevents/issue/OW-100) |
| GET | `/api/sponsors/:id/report` | 🔴 | [OW-100](https://linear.app/oursharedevents/issue/OW-100) |
| GET | `/api/events/:id/music` | 🔴 OSE integration | [OW-100](https://linear.app/oursharedevents/issue/OW-100) |

---

## Pages (Playwright)

| Page | Status | Notes |
|------|--------|-------|
| `/` (connect/landing) | ✅ | connect form, opt-in, empty/whitespace/XSS name guards, double-submit lock |
| `/catalog` | ✅ / 🟡 | renders + anonymous access ✅; search/filter *behavior* thin → [OW-92](https://linear.app/oursharedevents/issue/OW-92) |
| `/create` | 🟡 | form + sliders render; no actual playlist creation → [OW-91](https://linear.app/oursharedevents/issue/OW-91) |
| `/import` | ✅ | upload happy path + gating + session persistence; error paths → [OW-93](https://linear.app/oursharedevents/issue/OW-93) |
| `/stats` | 🟡 | visibility-only, no data assertions |
| `/dashboard` (DJ) | 🟡 | `start-set-btn` visible only; no start-set interaction (post-launch) |
| `/contributor/:id` | ✅ | portfolio add/remove/validate + owner-vs-visitor authz + public view |
| `/dj/:id`, `/dj/:id/poster` | ✅ / 🔴 | offline live page + poster ✅; active set 🔴 (post-launch) → [OW-98](https://linear.app/oursharedevents/issue/OW-98) |

Mobile workability (375×812) audits 9 surfaces for no-h-scroll, 44px touch targets, 16px input font, CTA-above-fold, viewport meta.

---

## Identity choice (anonymous vs opt-in) — best-covered concern

Tested as **hard boundaries**, not happy paths: anonymous browsing never creates a session
(`session/me` → 401); opt-in requires a deliberate act (empty/whitespace name → no account);
name + Browse = opt-in (→ 200); owner-vs-visitor authz on profiles. Fat-finger, whitespace-trim,
markup-sanitization, and double-submit all covered.

Known nuance: the 3-rung model (identified / anonymous / **untracked**) only distinguishes
identified vs anonymous in E2E; an explicitly *untracked* mode is not yet asserted distinctly.

---

## Structural / process

- **CI is not yet two-phased** — automation runs in parallel with the fast layer → [OW-96](https://linear.app/oursharedevents/issue/OW-96).
- **No DoD enforcement** — nothing fails a PR that adds behavior without flow tests → [OW-97](https://linear.app/oursharedevents/issue/OW-97).
- **Two Postman collections** — orphaned `.api` one must be wired or deleted → [OW-95](https://linear.app/oursharedevents/issue/OW-95).
- **Negative/authz paths (401/403)** asserted almost nowhere in Postman → [OW-89](https://linear.app/oursharedevents/issue/OW-89) / [OW-94](https://linear.app/oursharedevents/issue/OW-94).
- `CLAUDE.md` route table ("10 routes") is **stale** — real surface is ~40 endpoints (this doc is authoritative).

_Last audited: 2026-06-08. Baseline: ~9–11 happy-path requests wired; ~25 endpoints with no automated coverage._
