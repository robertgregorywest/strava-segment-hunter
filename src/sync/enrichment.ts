import type { Repository, SegmentDetail } from '../db/repository.js';
import type { SegmentRow } from '../db/types.js';
import { analyzeSegmentGeometry, isWindNeutral } from '../geometry/analysis.js';
import { distanceMeters } from '../geometry/haversine.js';
import { describeError, log, logError } from '../log.js';
import { parseKomDuration } from '../segment/komStatus.js';
import type { StravaReadClient } from '../strava/client.js';
import type { StravaDetailedSegment } from '../strava/types.js';

const PROGRESS_INTERVAL = 25;

function toSegmentDetail(id: number, detail: StravaDetailedSegment): SegmentDetail {
  return {
    id,
    polyline: detail.map?.polyline ?? null,
    distanceM: detail.distance ?? null,
    averageGrade: detail.average_grade ?? null,
    elevationHigh: detail.elevation_high ?? null,
    elevationLow: detail.elevation_low ?? null,
    startLat: detail.start_latlng?.[0] ?? null,
    startLng: detail.start_latlng?.[1] ?? null,
    endLat: detail.end_latlng?.[0] ?? null,
    endLng: detail.end_latlng?.[1] ?? null,
    komSeconds: parseKomDuration(detail.xoms?.kom),
    prSeconds: detail.athlete_segment_stats?.pr_elapsed_time ?? null,
    prActivityId: detail.athlete_segment_stats?.pr_activity_id ?? null,
    prStartDate: detail.athlete_segment_stats?.pr_date ?? null,
    effortCount: detail.athlete_segment_stats?.effort_count ?? null,
  };
}

function distanceFromHome(segment: SegmentRow, home: { lat: number; lng: number }): number {
  if (segment.start_lat === null || segment.start_lng === null) return Number.POSITIVE_INFINITY;
  return distanceMeters(home.lat, home.lng, segment.start_lat, segment.start_lng);
}

/**
 * Fetches segment detail (polyline, KOM, PR, distance/grade/elevation) for
 * segments that lack it, plus any whose KOM has passed its freshness
 * window, nearest-to-home first (see design.md's phase-2 rationale).
 */
export async function enrichSegments(
  client: StravaReadClient,
  repo: Repository,
  home: { lat: number; lng: number },
  komFreshnessDays: number,
  windNeutralThreshold: number,
): Promise<number> {
  const needsDetail = await repo.segmentsLackingDetail();
  const needsKomRefresh = await repo.segmentsWithStaleKom(komFreshnessDays);

  const queue = new Map<number, SegmentRow>();
  for (const segment of [...needsDetail, ...needsKomRefresh]) {
    queue.set(segment.id, segment);
  }

  const ordered = [...queue.values()].sort(
    (a, b) => distanceFromHome(a, home) - distanceFromHome(b, home),
  );

  const total = ordered.length;
  const startedAt = Date.now();
  let count = 0;
  let failed = 0;

  if (total > 0) log(`Enriching ${total} segments.`);

  for (const segment of ordered) {
    try {
      const detail = await client.getSegment(segment.id);
      const segmentDetail = toSegmentDetail(segment.id, detail);
      await repo.applyEnrichment(segmentDetail, new Date().toISOString());

      // Geometry is immutable once known — only compute it the first time.
      const alreadyHasGeometry = (await repo.getSegment(segment.id))?.bearing_deg !== null;
      if (!alreadyHasGeometry) {
        const geometry = analyzeSegmentGeometry(
          segmentDetail.polyline,
          segmentDetail.startLat !== null && segmentDetail.startLng !== null
            ? [segmentDetail.startLat, segmentDetail.startLng]
            : null,
          segmentDetail.endLat !== null && segmentDetail.endLng !== null
            ? [segmentDetail.endLat, segmentDetail.endLng]
            : null,
        );
        if (geometry) {
          await repo.applyGeometry(
            segment.id,
            geometry.bearingDeg,
            geometry.directionality,
            geometry.approximate,
            isWindNeutral(geometry.directionality, windNeutralThreshold),
          );
        }
      }

      count += 1;
    } catch (err) {
      // Left un-enriched — repo.segmentsLackingDetail()/segmentsWithStaleKom() will retry it on the next run.
      failed += 1;
      logError(`Segment ${segment.id}: failed to enrich, will retry on next run — ${describeError(err)}`);
    }

    const done = count + failed;
    if (done % PROGRESS_INTERVAL === 0 || done === total) {
      const elapsedS = (Date.now() - startedAt) / 1000;
      const rate = done / Math.max(elapsedS, 1);
      const etaS = rate > 0 ? (total - done) / rate : 0;
      log(
        `Progress: ${done}/${total} segments (${count} ok, ${failed} failed) — ${elapsedS.toFixed(0)}s elapsed, ~${etaS.toFixed(0)}s remaining.`,
      );
    }
  }

  return count;
}
