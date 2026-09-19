import type { Repository } from '../db/repository.js';
import type { SegmentRow } from '../db/types.js';
import type { OpenMeteoClient } from '../wind/openMeteoClient.js';

export interface ResolvedPrEffort {
  elapsedS: number;
  startDate: string | undefined;
}

/** Prefers the segment's recorded PR; falls back to the fastest logged effort if the PR fields are unset. */
export async function resolvePrEffort(repo: Repository, segment: SegmentRow): Promise<ResolvedPrEffort | undefined> {
  if (segment.pr_seconds !== null) {
    return { elapsedS: segment.pr_seconds, startDate: segment.pr_start_date ?? undefined };
  }
  const best = await repo.bestEffortForSegment(segment.id);
  if (!best) return undefined;
  return { elapsedS: best.elapsed_time_s, startDate: best.start_date };
}

/**
 * The wind that prevailed during the PR effort. Sync stores it on the segment
 * (src/sync/prWind.ts), so this normally costs no query; it falls back to the
 * wind cache/archive when sync hasn't reached this segment yet, or the stored
 * wind belongs to an earlier PR.
 */
export async function resolvePrWind(
  weather: OpenMeteoClient,
  segment: SegmentRow,
  pr: ResolvedPrEffort,
): Promise<{ windSpeedMs: number; windDirectionDeg: number } | undefined> {
  if (!pr.startDate || segment.start_lat === null || segment.start_lng === null) return undefined;

  if (
    segment.pr_wind_start_date === pr.startDate &&
    segment.pr_wind_speed_ms !== null &&
    segment.pr_wind_direction_deg !== null
  ) {
    return { windSpeedMs: segment.pr_wind_speed_ms, windDirectionDeg: segment.pr_wind_direction_deg };
  }

  return weather.getHistoricalWindAt(segment.start_lat, segment.start_lng, pr.startDate);
}
