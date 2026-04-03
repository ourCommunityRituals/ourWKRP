---
name: verify-migrations
description: Verify D1 database schema is current by checking migration files against the codebase types and queries
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash
---

# Verify D1 Migrations

Check that the database schema matches what the code expects.

## Steps

1. Read all migration files in `migrations/` in order
2. Read `src/types.ts` for the TypeScript data model (Contributor, Playlist, Track, PlaylistTrack)
3. Search `src/` for all D1 queries (`WKRP_DB`, `.prepare(`, `.run(`, `.all(`, `.first(`)
4. Cross-reference:
   - Every column referenced in queries exists in the migration schema
   - Every TypeScript type field has a corresponding column
   - Indexes exist for columns used in WHERE/ORDER BY clauses
   - Foreign keys are properly defined

## Report

- List any mismatches between schema and code
- List any missing indexes for query patterns
- List any columns in schema not used by code (dead columns)
- Confirm migration order is correct (no dependency issues)
