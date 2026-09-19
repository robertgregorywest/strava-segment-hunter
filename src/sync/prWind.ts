import type { PrWindCandidate, Repository } from '../db/repository.js';
import { distanceMeters } from '../geometry/haversine.js';
import { describeError, log, logError } from '../log.js';
import { WeatherUnavailableError, type OpenMeteoClient } from '../wind/openMeteoClient.js';

/**
 * Open-Meteo's free tier allows 10,000 calls a day and 5,000 an hour. A
 * first run faces thousands of segments, so it works through them over
 * several days' syncs, nearest-to-home first; searches fall back to looking
 * the wind up themselves until then (see search/calibration.ts).
 */
export const DEFAULT_PR_WIND_LIMIT = 1000;

function distanceFromHome(segment: PrWindCandidate, home: { lat: number; lng: number }): number {
  return distanceMeters(home.lat, home.lng, segment.start_lat, segment.start_lng);
}

/**
 * Stores the wind that prevailed during each segment's PR on the segment
 * row, so a search calibrates power without a wind cache lookup per segment.
 * Needs no Strava calls, so it runs even once Strava's daily quota is spent.
 */
export async function annotatePrWind(
  weather: OpenMeteoClient,
  repo: Repository,
  home: { lat: number; lng: number },
  limit = DEFAULT_PR_WIND_LIMIT,
): Promise<number> {
  const candidates = await repo.segmentsNeedingPrWind();
  const ordered = candidates
    .sort((a, b) => distanceFromHome(a, home) - distanceFromHome(b, home))
    .slice(0, limit);

  if (ordered.length > 0) log(`Looking up PR wind for ${ordered.length} of ${candidates.length} segments.`);

  let annotated = 0;
  for (const segment of ordered) {
    try {
      const wind = await weather.historicalWindAt(segment.start_lat, segment.start_lng, segment.pr_start_date);
      // No archive data for that day yet — left for a later run.
      if (!wind) continue;
      await repo.applyPrWind(segment.id, segment.pr_start_date, wind.windSpeedMs, wind.windDirectionDeg);
      annotated += 1;
    } catch (err) {
      // Down or throttling us: every remaining lookup would fail the same way.
      if (err instanceof WeatherUnavailableError) {
        logError(`Open-Meteo unavailable, stopping PR wind lookups for this run — ${describeError(err)}`);
        break;
      }
      logError(`Segment ${segment.id}: failed to look up PR wind, will retry on next run — ${describeError(err)}`);
    }
  }

  return annotated;
}
