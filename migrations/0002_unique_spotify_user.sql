-- Add UNIQUE constraint on spotify_user_id
-- Prevents duplicate contributor rows when same Spotify account re-authenticates
CREATE UNIQUE INDEX idx_contributors_spotify_user ON contributors(spotify_user_id);
