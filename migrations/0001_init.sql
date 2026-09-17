-- Core corpus tables.
--
-- This is the schema both store implementations run against: D1 in
-- production, and a local SQLite file for dev/tests. It is applied to both
-- from this file, so the two cannot drift.
--
-- No `segment_rtree` virtual table here (unlike the pre-D1 schema this
-- replaces): D1 doesn't support SQLite's rtree module. Radius search instead
-- does a plain indexed bounding-box scan over start_lat/start_lng — plenty
-- fast at this corpus's size (thousands, not millions, of segments).

CREATE TABLE activities (
  id INTEGER PRIMARY KEY,
  name TEXT,
  start_date TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_activities_start_date ON activities(start_date);

CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  name TEXT,
  distance_m REAL,
  average_grade REAL,
  elevation_high REAL,
  elevation_low REAL,
  start_lat REAL,
  start_lng REAL,
  end_lat REAL,
  end_lng REAL,

  -- Geometry (immutable once fetched; never refetched).
  polyline TEXT,
  bearing_deg REAL,
  directionality REAL,
  geometry_approximate INTEGER NOT NULL DEFAULT 0,
  wind_neutral INTEGER NOT NULL DEFAULT 0,

  -- Volatile fields with their own freshness.
  kom_seconds INTEGER,
  kom_fetched_at TEXT,

  -- Athlete's own performance on this segment.
  pr_seconds INTEGER,
  pr_activity_id INTEGER,
  pr_start_date TEXT,
  effort_count INTEGER,
  best_kom_rank INTEGER,
  has_baseline INTEGER NOT NULL DEFAULT 0,

  starred INTEGER NOT NULL DEFAULT 0,
  detail_fetched_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bounding-box prefilter for radius search (see repository.ts's
-- segmentsWithinRadius): narrows candidates by lat/lng range before the
-- exact great-circle distance filter runs in application code.
CREATE INDEX idx_segments_lat_lng ON segments(start_lat, start_lng);

CREATE TABLE segment_efforts (
  id INTEGER PRIMARY KEY,
  segment_id INTEGER NOT NULL REFERENCES segments(id),
  activity_id INTEGER NOT NULL REFERENCES activities(id),
  elapsed_time_s INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  pr_rank INTEGER,
  kom_rank INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_segment_efforts_segment ON segment_efforts(segment_id);
CREATE INDEX idx_segment_efforts_activity ON segment_efforts(activity_id);

-- Generic key/value progress tracking (backfill cursor, incremental sync cursor, etc).
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Last-observed Strava rate limit headers, so the budgeter can decide
-- whether it's safe to make a request before any response has been seen
-- in this process (e.g. right after a restart).
CREATE TABLE rate_limit_state (
  window TEXT PRIMARY KEY,
  limit_value INTEGER NOT NULL,
  usage_value INTEGER NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE forecast_cache (
  cache_key TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE historical_wind_cache (
  cache_key TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  timestamp TEXT NOT NULL,
  wind_speed_ms REAL,
  wind_direction_deg REAL,
  fetched_at TEXT NOT NULL
);

-- Strava OAuth tokens. Single row (id fixed at 1): replaces the local
-- data/strava-tokens.json file, since the GitHub Actions runner that now
-- performs sync is stateless between runs and needs a durable place to read
-- and refresh the token from.
CREATE TABLE oauth_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
