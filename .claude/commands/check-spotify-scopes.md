Audit the Spotify OAuth scopes requested vs. the API endpoints actually used in the codebase.

1. Find the SCOPES constant in `src/auth/spotify-oauth.ts`
2. Search all files in `src/spotify/` for Spotify API endpoint paths
3. Cross-reference: are there scopes requested that aren't needed? Are there API calls that need scopes not yet requested?
4. Reference: https://developer.spotify.com/documentation/web-api/concepts/scopes

Report any mismatches.
