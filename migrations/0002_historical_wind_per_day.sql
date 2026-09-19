-- Historical wind: one cache row per location-day, and the PR's wind stored
-- on the segment itself.
--
-- The old cache held one row per hour, keyed `lat,lng|date|hour`, and was
-- read with `cache_key LIKE 'lat,lng|date%'`. SQLite's LIKE is
-- case-insensitive by default, so it can't use the primary key index: every
-- lookup scanned the whole table, once per projectable segment per search.
-- That scan was ~95% of D1's rows read and blew through the free tier's
-- daily limit. Keyed per location-day, a lookup is a single primary-key hit.

CREATE TABLE historical_wind_cache_new (
  cache_key TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  date TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- Carry the existing hourly rows over, so their location-days aren't
-- re-fetched from Open-Meteo. The new key is the old one minus its
-- trailing `|<hour timestamp>`.
INSERT INTO historical_wind_cache_new (cache_key, lat, lng, date, payload, fetched_at)
SELECT
  day_key,
  MIN(lat),
  MIN(lng),
  substr(MIN(timestamp), 1, 10),
  json_group_array(json_object(
    'time', timestamp,
    'windSpeedMs', wind_speed_ms,
    'windDirectionDeg', wind_direction_deg,
    'windGustsMs', NULL
  )),
  MAX(fetched_at)
FROM (
  SELECT
    substr(cache_key, 1, length(cache_key) - length(timestamp) - 1) AS day_key,
    lat, lng, timestamp, wind_speed_ms, wind_direction_deg, fetched_at
  FROM historical_wind_cache
  WHERE wind_speed_ms IS NOT NULL AND wind_direction_deg IS NOT NULL
  ORDER BY timestamp
)
GROUP BY day_key;

DROP TABLE historical_wind_cache;
ALTER TABLE historical_wind_cache_new RENAME TO historical_wind_cache;

-- The wind that prevailed when the athlete set their PR, filled in by sync
-- (src/sync/prWind.ts) so a search calibrates power without touching the
-- wind cache at all. `pr_wind_start_date` is the pr_start_date this wind was
-- looked up for: when a new PR moves pr_start_date on, the two no longer
-- match, and both sync and search treat the stored wind as absent.
ALTER TABLE segments ADD COLUMN pr_wind_speed_ms REAL;
ALTER TABLE segments ADD COLUMN pr_wind_direction_deg REAL;
ALTER TABLE segments ADD COLUMN pr_wind_start_date TEXT;
