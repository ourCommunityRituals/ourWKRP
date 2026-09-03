# OCR_VISION — ourWKRP (OW)

> Product-level vision, derived from the org-level source of truth
> [`OCR-docs/docs/OCR_VISION.md`](https://github.com/ourCommunityRituals/OCR-docs/blob/main/docs/OCR_VISION.md)
> (vendored copy: `.ocr-standards/docs/OCR_VISION.md`). If it is not written there, it does not exist
> at the org level. One of the four governance files every OCR repo carries
> (`CLAUDE.md`, `docs/OCR_VISION.md`, `README.md`, `SKILL.md`).

---

## What OW is in the product line

OW is the **named layer** of the platform — community music curation with voluntary attribution.
Same architecture and brand as OSE, **separate database**, opposite identity invariant.

- **identity_mode: named** — contributors register with a name ("the act of registering is the
  consent"); Spotify / Last.fm / CSV are optional linked libraries, never an identity prerequisite.
- **Free, community-based** — a cultural statement, not a revenue product (org VISION §7).
- **Hybrid-capable** — anonymous participation/voting/aggregates + named public personalities
  (DJs, curators); the named roster and anonymous aggregates are a structurally impossible join
  (org VISION §6.5.1, brain #22).
- **OSE seam** — OW consumes OSE's SharedReport read API as a client (ADR-011); it never reads
  OSE's database.

## Where the detail lives

| Topic                           | Home                                              |
| ------------------------------- | ------------------------------------------------- |
| Architecture, endpoints, data model | `CLAUDE.md` §2 (route table = `src/router.ts` header) |
| Fist-of-Five competition format      | `docs/features/fist-of-five-competition.md`   |
| Story backlog                        | `STORIES.md` + Linear team OurWKRP             |
| Org registry, corridors, NCR         | `OCR-docs/docs/OCR_VISION.md` §7–§9            |

---

_Created 2026-09-03 (reconciliation pass). Owner: Matt._
