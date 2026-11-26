# Review canary fixtures

Two small handlers, read by `.github/workflows/claude-review-canary.yml`. They are
plain text (`.txt`), never imported, built or deployed.

- `clean.ts.txt` is safe: a bound D1 query.
- `planted.ts.txt` has one planted flaw: a SQL query built from a URL parameter
  (lines 9 to 11). The AI reviewer must name that file and a line in that range,
  and must not flag the clean file.

The canary is an eval for the reviewer itself. If you change these files, change the expected range in
`scripts/ci/review-canary-check.mjs` in the same commit.
