# Audio Features Provider — Spike

**Status:** Spike — analysis, no code
**Product:** ourWKRP
**Ticket:** OW-120
**Last updated:** 2026-08-28

## The 403 reality

Spotify's `/audio-features` endpoint (energy, valence, danceability, tempo,
acousticness, instrumentalness) is closed to Spotify apps registered after the
November 2024 API restriction. The call does not rate-limit, degrade, or
partially succeed — it returns **403 for every request, permanently**, for the
credentials in question. There is no quota to wait out and no scope to add.

OW-120 makes that failure honest: `spotifyFetch` raises a typed
`not_entitled` error, `getAudioFeatures` isolates each batch of 100 and returns
`{ features, status }`, the sync result carries `audio_features_status`, and
the catalog/create pages hide their audio-feature controls unless
`/api/stats` reports `has_audio_features`. What OW-120 does **not** do is
replace the data. That is the question here.

## What we already hold

- **`tracks.isrc`** — populated on every Spotify sync (`external_ids.isrc`) and
  indexed (`idx_tracks_isrc`). ISRC is the recording-level key most external
  catalogs can be joined on.
- **`track_identifiers`** — `(platform, platform_id)` keyed, already writing
  `spotify` rows. A second provider is a new `platform` value, not a migration.
- **`tracks.canonical_title` / `canonical_artist`** — normalized fallback join
  keys for anything without an ISRC.
- **Last.fm client** — `getTrackTags` / `getArtistTags` are wired and the
  Last.fm sync engine already writes `tracks.genre` from the top artist tag.
- **CSV import** — `parseExportifyCsv` already parses energy, valence,
  danceability and tempo columns straight into `tracks`.

## Candidates

| Candidate | Fit | Cost |
|---|---|---|
| **AcousticBrainz** | Real acoustic features, but the project is **frozen and read-only since 2022** — no new submissions, keyed on MBID (needs ISRC → MusicBrainz → MBID resolution), coverage skews pre-2022 | Two-hop lookup per track; permanently stale for new music |
| **ListenBrainz metadata** | Live, ISRC/MBID-resolvable, good provenance story; but its payload is listen/tag metadata, **not** energy/valence/danceability | Would change what the filters mean |
| **Deezer per-track fields** | Live public API, exposes BPM and gain per track | Two of six fields; no valence/danceability, so the chip set stays half-empty |
| **Degrade to Last.fm tags** | Already in the codebase; tags ("chill", "upbeat", "party") map to the *intent* behind the chips without pretending to be measurements | Tag-based filtering is a different UX, not a drop-in for sliders |

## Current mitigation

**CSV import (Exportify).** Anyone who exports their library through Exportify
brings real audio features with them, and the importer already stores them.
That path is live today and needs no new dependency — where OSP-onboarded
programs need feature filters now, this is the answer.

## Recommendation

**DEFER.** No candidate returns the six fields the current UI is built on, so
adopting one means redesigning the filters anyway — cheaper to keep the honest
gate plus Exportify import until real demand tells us whether people want
*measurements* (revisit Deezer + AcousticBrainz) or *vibes* (promote the
Last.fm tags we already store).
