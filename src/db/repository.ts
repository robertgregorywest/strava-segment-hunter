import type { DB } from './index.js';
import { distanceMeters } from '../geometry/haversine.js';
import type { ActivityRow, SegmentEffortRow, SegmentRow } from './types.js';

export interface NearbySegment extends SegmentRow {
  distanceFromSearchM: number;
}

export interface SegmentStub {
  id: number;
  name: string;
  distanceM: number | null;
  averageGrade: number | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
}

export interface EffortRecord {
  id: number;
  segmentId: number;
  activityId: number;
  elapsedTimeS: number;
  startDate: string;
  prRank: number | null;
  komRank: number | null;
}

export interface SegmentDetail {
  id: number;
  polyline: string | null;
  distanceM: number | null;
  averageGrade: number | null;
  elevationHigh: number | null;
  elevationLow: number | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  komSeconds: number | null;
  prSeconds: number | null;
  prActivityId: number | null;
  prStartDate: string | null;
  effortCount: number | null;
}

/** All corpus reads/writes go through this class — no raw SQL elsewhere. */
export class Repository {
  constructor(private readonly db: DB) {}

  // ---- Activities ----------------------------------------------------

  upsertActivityStub(id: number, name: string, startDate: string): void {
    this.db
      .prepare(
        `INSERT INTO activities (id, name, start_date) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, start_date = excluded.start_date`,
      )
      .run(id, name, startDate);
  }

  markActivityProcessed(id: number): void {
    this.db.prepare(`UPDATE activities SET processed_at = datetime('now') WHERE id = ?`).run(id);
  }

  unprocessedActivities(): ActivityRow[] {
    return this.db
      .prepare('SELECT * FROM activities WHERE processed_at IS NULL ORDER BY start_date ASC')
      .all() as ActivityRow[];
  }

  activityCount(): { total: number; processed: number } {
    const row = this.db
      .prepare('SELECT COUNT(*) as total, COUNT(processed_at) as processed FROM activities')
      .get() as { total: number; processed: number };
    return row;
  }

  latestActivityStartDate(): string | undefined {
    const row = this.db.prepare('SELECT MAX(start_date) as latest FROM activities').get() as {
      latest: string | null;
    };
    return row.latest ?? undefined;
  }

  // ---- Segments --------------------------------------------------------

  /** Creates a segment row from effort/starred data if absent; never overwrites fields already known. */
  upsertSegmentStub(stub: SegmentStub): void {
    this.db
      .prepare(
        `INSERT INTO segments (id, name, distance_m, average_grade, start_lat, start_lng, end_lat, end_lng, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           distance_m = COALESCE(segments.distance_m, excluded.distance_m),
           average_grade = COALESCE(segments.average_grade, excluded.average_grade),
           start_lat = COALESCE(segments.start_lat, excluded.start_lat),
           start_lng = COALESCE(segments.start_lng, excluded.start_lng),
           end_lat = COALESCE(segments.end_lat, excluded.end_lat),
           end_lng = COALESCE(segments.end_lng, excluded.end_lng),
           updated_at = datetime('now')`,
      )
      .run(stub.id, stub.name, stub.distanceM, stub.averageGrade, stub.startLat, stub.startLng, stub.endLat, stub.endLng);
  }

  markSegmentStarred(id: number): void {
    this.db.prepare(`UPDATE segments SET starred = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  }

  markSegmentHasBaseline(id: number): void {
    this.db
      .prepare(`UPDATE segments SET has_baseline = 1, updated_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  refreshBestKomRank(segmentId: number): void {
    this.db
      .prepare(
        `UPDATE segments SET best_kom_rank = (
           SELECT MIN(kom_rank) FROM segment_efforts WHERE segment_id = ? AND kom_rank IS NOT NULL
         ), effort_count = (
           SELECT COUNT(*) FROM segment_efforts WHERE segment_id = ?
         ), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(segmentId, segmentId, segmentId);
  }

  applyEnrichment(detail: SegmentDetail, komFetchedAt: string): void {
    this.db
      .prepare(
        `UPDATE segments SET
           polyline = COALESCE(polyline, ?),
           distance_m = COALESCE(distance_m, ?),
           average_grade = COALESCE(average_grade, ?),
           elevation_high = COALESCE(elevation_high, ?),
           elevation_low = COALESCE(elevation_low, ?),
           start_lat = COALESCE(start_lat, ?),
           start_lng = COALESCE(start_lng, ?),
           end_lat = COALESCE(end_lat, ?),
           end_lng = COALESCE(end_lng, ?),
           kom_seconds = ?,
           kom_fetched_at = ?,
           pr_seconds = COALESCE(?, pr_seconds),
           pr_activity_id = COALESCE(?, pr_activity_id),
           pr_start_date = COALESCE(?, pr_start_date),
           effort_count = COALESCE(?, effort_count),
           detail_fetched_at = datetime('now'),
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        detail.polyline,
        detail.distanceM,
        detail.averageGrade,
        detail.elevationHigh,
        detail.elevationLow,
        detail.startLat,
        detail.startLng,
        detail.endLat,
        detail.endLng,
        detail.komSeconds,
        komFetchedAt,
        detail.prSeconds,
        detail.prActivityId,
        detail.prStartDate,
        detail.effortCount,
        detail.id,
      );
  }

  applyGeometry(
    id: number,
    bearingDeg: number,
    directionality: number,
    approximate: boolean,
    windNeutral: boolean,
  ): void {
    this.db
      .prepare(
        `UPDATE segments SET bearing_deg = ?, directionality = ?, geometry_approximate = ?, wind_neutral = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(bearingDeg, directionality, approximate ? 1 : 0, windNeutral ? 1 : 0, id);
  }

  segmentsLackingDetail(): SegmentRow[] {
    return this.db.prepare('SELECT * FROM segments WHERE detail_fetched_at IS NULL').all() as SegmentRow[];
  }

  segmentsWithStaleKom(freshnessDays: number): SegmentRow[] {
    return this.db
      .prepare(
        `SELECT * FROM segments
         WHERE detail_fetched_at IS NOT NULL
           AND kom_seconds IS NOT NULL
           AND kom_fetched_at IS NOT NULL
           AND julianday('now') - julianday(kom_fetched_at) > ?`,
      )
      .all(freshnessDays) as SegmentRow[];
  }

  getSegment(id: number): SegmentRow | undefined {
    return this.db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as SegmentRow | undefined;
  }

  /** R*Tree bounding-box prefilter, then an exact great-circle distance filter/sort. */
  segmentsWithinRadius(lat: number, lng: number, radiusM: number): NearbySegment[] {
    const metresPerDegreeLat = 111_320;
    const latDelta = radiusM / metresPerDegreeLat;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const lngDelta = radiusM / (metresPerDegreeLat * (Math.abs(cosLat) > 1e-9 ? cosLat : 1e-9));

    const candidates = this.db
      .prepare(
        `SELECT s.* FROM segment_rtree r JOIN segments s ON s.id = r.id
         WHERE r.min_lat >= ? AND r.max_lat <= ? AND r.min_lng >= ? AND r.max_lng <= ?`,
      )
      .all(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta) as SegmentRow[];

    const withDistance: NearbySegment[] = candidates
      .filter((s) => s.start_lat !== null && s.start_lng !== null)
      .map((s) => ({
        ...s,
        distanceFromSearchM: distanceMeters(lat, lng, s.start_lat as number, s.start_lng as number),
      }));

    return withDistance.filter((s) => s.distanceFromSearchM <= radiusM);
  }

  // ---- Efforts -----------------------------------------------------------

  insertEffort(effort: EffortRecord): void {
    this.db
      .prepare(
        `INSERT INTO segment_efforts (id, segment_id, activity_id, elapsed_time_s, start_date, pr_rank, kom_rank)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           elapsed_time_s = excluded.elapsed_time_s,
           pr_rank = excluded.pr_rank,
           kom_rank = excluded.kom_rank`,
      )
      .run(
        effort.id,
        effort.segmentId,
        effort.activityId,
        effort.elapsedTimeS,
        effort.startDate,
        effort.prRank,
        effort.komRank,
      );
  }

  effortsForSegment(segmentId: number): SegmentEffortRow[] {
    return this.db
      .prepare('SELECT * FROM segment_efforts WHERE segment_id = ? ORDER BY start_date ASC')
      .all(segmentId) as SegmentEffortRow[];
  }

  bestEffortForSegment(segmentId: number): SegmentEffortRow | undefined {
    return this.db
      .prepare('SELECT * FROM segment_efforts WHERE segment_id = ? ORDER BY elapsed_time_s ASC LIMIT 1')
      .get(segmentId) as SegmentEffortRow | undefined;
  }
}
