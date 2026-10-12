-- Strava tokens live in STRAVA_TOKEN_PATH (FileTokenStore) now that sync runs
-- locally; this table only held them for the hosted GitHub Actions sync.
DROP TABLE IF EXISTS oauth_tokens;
