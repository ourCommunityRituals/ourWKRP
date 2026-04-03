---
name: sync-contributor
description: Manually trigger a Spotify library sync for a specific contributor against the running dev server
disable-model-invocation: true
argument-hint: "<userId>"
allowed-tools: Bash Read
---

# Sync Contributor

Trigger a full Spotify sync for contributor **$ARGUMENTS**.

## Pre-checks

1. Verify dev server is running: `curl -s http://localhost:8787/health`
   - If not running, tell the user to start it with `/dev`
2. Verify the contributor exists: `curl -s http://localhost:8787/auth/session/$ARGUMENTS`

## Trigger sync

```bash
curl -s -X POST http://localhost:8787/spotify/sync/$ARGUMENTS
```

## Report results

- Number of playlists synced
- Number of tracks synced
- Number of audio features fetched
- Any errors or rate limits hit

If the sync fails with a 401, the contributor's Spotify token may have expired — check token refresh logic.
