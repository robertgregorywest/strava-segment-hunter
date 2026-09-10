/** Minimal shapes for the Strava v3 API fields this project actually reads. */

export interface StravaActivitySummary {
  id: number;
  name: string;
  start_date: string;
}

export interface StravaSegmentEffort {
  id: number;
  segment: StravaSummarySegment;
  elapsed_time: number;
  start_date: string;
  pr_rank: number | null;
  kom_rank: number | null;
}

export interface StravaDetailedActivity {
  id: number;
  name: string;
  start_date: string;
  segment_efforts?: StravaSegmentEffort[];
}

export interface StravaSummarySegment {
  id: number;
  name: string;
  distance: number;
  average_grade: number;
  start_latlng: [number, number] | null;
  end_latlng: [number, number] | null;
}

export interface StravaDetailedSegment extends StravaSummarySegment {
  elevation_high: number;
  elevation_low: number;
  map?: { polyline?: string };
  xoms?: { kom?: string };
  athlete_segment_stats?: {
    pr_elapsed_time?: number;
    pr_activity_id?: number;
    pr_date?: string;
    effort_count?: number;
  };
}
