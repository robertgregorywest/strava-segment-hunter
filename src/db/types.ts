/** Row shapes match column names directly (snake_case) — no ORM mapping layer. */

export interface ActivityRow {
  id: number;
  name: string | null;
  start_date: string;
  processed_at: string | null;
  created_at: string;
}

export interface SegmentRow {
  id: number;
  name: string | null;
  distance_m: number | null;
  average_grade: number | null;
  elevation_high: number | null;
  elevation_low: number | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;

  polyline: string | null;
  bearing_deg: number | null;
  directionality: number | null;
  geometry_approximate: 0 | 1;
  wind_neutral: 0 | 1;

  kom_seconds: number | null;
  kom_fetched_at: string | null;

  pr_seconds: number | null;
  pr_activity_id: number | null;
  pr_start_date: string | null;
  effort_count: number | null;
  best_kom_rank: number | null;
  has_baseline: 0 | 1;

  starred: 0 | 1;
  detail_fetched_at: string | null;

  created_at: string;
  updated_at: string;
}

export interface SegmentEffortRow {
  id: number;
  segment_id: number;
  activity_id: number;
  elapsed_time_s: number;
  start_date: string;
  pr_rank: number | null;
  kom_rank: number | null;
  created_at: string;
}

export interface RateLimitStateRow {
  window: 'short' | 'daily';
  limit_value: number;
  usage_value: number;
  observed_at: string;
}

export interface ForecastCacheRow {
  cache_key: string;
  lat: number;
  lng: number;
  period_start: string;
  period_end: string;
  payload: string;
  fetched_at: string;
}

export interface HistoricalWindCacheRow {
  cache_key: string;
  lat: number;
  lng: number;
  timestamp: string;
  wind_speed_ms: number | null;
  wind_direction_deg: number | null;
  fetched_at: string;
}
