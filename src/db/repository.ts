import type { SqlBackend } from './backend.js';
import { distanceMeters } from '../geometry/haversine.js';
import type { ActivityRow, SegmentEffortRow, SegmentRow } from './types.js';

export interface NearbySegment extends SegmentRow {
  distanceFromSearchM: number;
}

export interface PrWindCandidate {
  id: number;
  start_lat: number;
  start_lng: number;
  pr_start_date: string;
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

/**
 * All corpus reads/writes go through this class — no raw SQL elsewhere.
 * Backend-agnostic (see `backend.ts`): the same queries run against a local
 * SQLite file, D1's Worker binding, or D1's HTTP API.
 */
export class Repository {
  constructor(private readonly db: SqlBackend) {}

  // ---- Activities ----------------------------------------------------

  async upsertActivityStub(id: number, name: string, startDate: string): Promise<void> {
    await this.db.run(
      `INSERT INTO activities (id, name, start_date) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, start_date = excluded.start_date`,
      [id, name, startDate],
    );
  }

  async markActivityProcessed(id: number): Promise<void> {
    await this.db.run(`UPDATE activities SET processed_at = datetime('now') WHERE id = ?`, [id]);
  }

  async unprocessedActivities(): Promise<ActivityRow[]> {
    return this.db.all<ActivityRow>('SELECT * FROM activities WHERE processed_at IS NULL ORDER BY start_date ASC');
  }

  async activityCount(): Promise<{ total: number; processed: number }> {
    const row = await this.db.get<{ total: number; processed: number }>(
      'SELECT COUNT(*) as total, COUNT(processed_at) as processed FROM activities',
    );
    return row ?? { total: 0, processed: 0 };
  }

  async latestActivityStartDate(): Promise<string | undefined> {
    const row = await this.db.get<{ latest: string | null }>('SELECT MAX(start_date) as latest FROM activities');
    return row?.latest ?? undefined;
  }

  // ---- Segments --------------------------------------------------------

  /** Creates a segment row from effort/starred data if absent; never overwrites fields already known. */
  async upsertSegmentStub(stub: SegmentStub): Promise<void> {
    await this.db.run(
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
      [stub.id, stub.name, stub.distanceM, stub.averageGrade, stub.startLat, stub.startLng, stub.endLat, stub.endLng],
    );
  }

  async markSegmentStarred(id: number): Promise<void> {
    await this.db.run(`UPDATE segments SET starred = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
  }

  async markSegmentHasBaseline(id: number): Promise<void> {
    await this.db.run(`UPDATE segments SET has_baseline = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
  }

  async refreshBestKomRank(segmentId: number): Promise<void> {
    await this.db.run(
      `UPDATE segments SET best_kom_rank = (
         SELECT MIN(kom_rank) FROM segment_efforts WHERE segment_id = ? AND kom_rank IS NOT NULL
       ), effort_count = (
         SELECT COUNT(*) FROM segment_efforts WHERE segment_id = ?
       ), updated_at = datetime('now')
       WHERE id = ?`,
      [segmentId, segmentId, segmentId],
    );
  }

  async applyEnrichment(detail: SegmentDetail, komFetchedAt: string): Promise<void> {
    await this.db.run(
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
      [
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
      ],
    );
  }

  async applyGeometry(
    id: number,
    bearingDeg: number,
    directionality: number,
    approximate: boolean,
    windNeutral: boolean,
  ): Promise<void> {
    await this.db.run(
      `UPDATE segments SET bearing_deg = ?, directionality = ?, geometry_approximate = ?, wind_neutral = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [bearingDeg, directionality, approximate ? 1 : 0, windNeutral ? 1 : 0, id],
    );
  }

  async segmentsLackingDetail(): Promise<SegmentRow[]> {
    return this.db.all<SegmentRow>('SELECT * FROM segments WHERE detail_fetched_at IS NULL');
  }

  async segmentsWithStaleKom(freshnessDays: number): Promise<SegmentRow[]> {
    return this.db.all<SegmentRow>(
      `SELECT * FROM segments
       WHERE detail_fetched_at IS NOT NULL
         AND kom_seconds IS NOT NULL
         AND kom_fetched_at IS NOT NULL
         AND julianday('now') - julianday(kom_fetched_at) > ?`,
      [freshnessDays],
    );
  }

  /**
   * Projectable segments whose PR has no stored wind yet, or whose stored
   * wind was looked up for an earlier PR (see migrations/0002).
   */
  async segmentsNeedingPrWind(): Promise<PrWindCandidate[]> {
    return this.db.all<PrWindCandidate>(
      `SELECT id, start_lat, start_lng, pr_start_date FROM segments
       WHERE has_baseline = 1
         AND wind_neutral = 0
         AND start_lat IS NOT NULL
         AND start_lng IS NOT NULL
         AND pr_start_date IS NOT NULL
         AND pr_wind_start_date IS NOT pr_start_date`,
    );
  }

  async applyPrWind(id: number, prStartDate: string, windSpeedMs: number, windDirectionDeg: number): Promise<void> {
    await this.db.run(
      `UPDATE segments SET pr_wind_speed_ms = ?, pr_wind_direction_deg = ?, pr_wind_start_date = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [windSpeedMs, windDirectionDeg, prStartDate, id],
    );
  }

  async getSegment(id: number): Promise<SegmentRow | undefined> {
    return this.db.get<SegmentRow>('SELECT * FROM segments WHERE id = ?', [id]);
  }

  /**
   * Indexed bounding-box prefilter (`idx_segments_lat_lng`), then an exact
   * great-circle distance filter/sort in application code. Previously an
   * R*Tree virtual table did the prefilter, but D1 doesn't support SQLite's
   * rtree module — a plain range scan is just as fast at this corpus's size
   * (thousands, not millions, of segments), so both backends use it.
   */
  async segmentsWithinRadius(lat: number, lng: number, radiusM: number): Promise<NearbySegment[]> {
    const metresPerDegreeLat = 111_320;
    const latDelta = radiusM / metresPerDegreeLat;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const lngDelta = radiusM / (metresPerDegreeLat * (Math.abs(cosLat) > 1e-9 ? cosLat : 1e-9));

    const candidates = await this.db.all<SegmentRow>(
      `SELECT * FROM segments
       WHERE start_lat BETWEEN ? AND ? AND start_lng BETWEEN ? AND ?`,
      [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta],
    );

    const withDistance: NearbySegment[] = candidates
      .filter((s) => s.start_lat !== null && s.start_lng !== null)
      .map((s) => ({
        ...s,
        distanceFromSearchM: distanceMeters(lat, lng, s.start_lat as number, s.start_lng as number),
      }));

    return withDistance.filter((s) => s.distanceFromSearchM <= radiusM);
  }

  // ---- Efforts -----------------------------------------------------------

  async insertEffort(effort: EffortRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO segment_efforts (id, segment_id, activity_id, elapsed_time_s, start_date, pr_rank, kom_rank)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         elapsed_time_s = excluded.elapsed_time_s,
         pr_rank = excluded.pr_rank,
         kom_rank = excluded.kom_rank`,
      [effort.id, effort.segmentId, effort.activityId, effort.elapsedTimeS, effort.startDate, effort.prRank, effort.komRank],
    );
  }

  async effortsForSegment(segmentId: number): Promise<SegmentEffortRow[]> {
    return this.db.all<SegmentEffortRow>(
      'SELECT * FROM segment_efforts WHERE segment_id = ? ORDER BY start_date ASC',
      [segmentId],
    );
  }

  async bestEffortForSegment(segmentId: number): Promise<SegmentEffortRow | undefined> {
    return this.db.get<SegmentEffortRow>(
      'SELECT * FROM segment_efforts WHERE segment_id = ? ORDER BY elapsed_time_s ASC LIMIT 1',
      [segmentId],
    );
  }
}
