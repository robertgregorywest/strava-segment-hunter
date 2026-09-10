-- Core corpus tables.

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

-- Spatial index over segment start points for radius search.
CREATE VIRTUAL TABLE segment_rtree USING rtree(
  id,
  min_lat, max_lat,
  min_lng, max_lng
);

CREATE TRIGGER segments_rtree_ai AFTER INSERT ON segments
WHEN NEW.start_lat IS NOT NULL AND NEW.start_lng IS NOT NULL
BEGIN
  INSERT INTO segment_rtree(id, min_lat, max_lat, min_lng, max_lng)
  VALUES (NEW.id, NEW.start_lat, NEW.start_lat, NEW.start_lng, NEW.start_lng);
END;

CREATE TRIGGER segments_rtree_au AFTER UPDATE ON segments
BEGIN
  DELETE FROM segment_rtree WHERE id = OLD.id;
  INSERT INTO segment_rtree(id, min_lat, max_lat, min_lng, max_lng)
  SELECT NEW.id, NEW.start_lat, NEW.start_lat, NEW.start_lng, NEW.start_lng
  WHERE NEW.start_lat IS NOT NULL AND NEW.start_lng IS NOT NULL;
END;

CREATE TRIGGER segments_rtree_ad AFTER DELETE ON segments
BEGIN
  DELETE FROM segment_rtree WHERE id = OLD.id;
END;

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
