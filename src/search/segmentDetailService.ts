import type { Repository } from '../db/repository.js';
import type { SegmentRow } from '../db/types.js';
import { decodePolyline, type LatLng } from '../geometry/polyline.js';
import { komStatus, type KomStatus } from '../segment/komStatus.js';
import { WeatherUnavailableError, type OpenMeteoClient } from '../wind/openMeteoClient.js';
import { calibratePower, gapToKomSeconds, projectTime, type ProjectionConfidence, type RiderParams } from '../wind/projection.js';
import { resolvePrEffort, resolvePrWind } from './calibration.js';
import type { SearchConfig } from './types.js';

export interface SegmentSummary {
  id: number;
  name: string | null;
  distanceM: number | null;
  averageGrade: number | null;
  bearingDeg: number | null;
  directionality: number | null;
  geometryApproximate: boolean;
  windNeutral: boolean;
  startLat: number | null;
  startLng: number | null;
  route: SegmentRoute;
}

/** A segment's path for drawing, start to finish. Approximate when only start/end points are known. */
export interface SegmentRoute {
  points: LatLng[];
  approximate: boolean;
}

export interface PersonalHistory {
  prSeconds: number | null;
  prStartDate: string | null;
  effortCount: number | null;
  bestKomRank: number | null;
  komSeconds: number | null;
  komStatus: KomStatus;
  komFetchedAt: string | null;
}

export interface HourlyProjection {
  time: string;
  windSpeedMs: number;
  windDirectionDeg: number;
  predictedTimeS: number;
  gapToKomS: number | undefined;
}

export interface SegmentDetailResult {
  segment: SegmentSummary;
  personalHistory: PersonalHistory;
  /** The wind-FROM direction that gives this segment's bearing the strongest tailwind. */
  idealWindFromDeg: number | undefined;
  riderParamsUsed: RiderParams;
  confidence: ProjectionConfidence | undefined;
  hourly: HourlyProjection[];
  fastestHours: HourlyProjection[];
  weatherUnavailable?: boolean;
  message?: string;
}

function segmentRoute(segment: SegmentRow): SegmentRoute {
  if (segment.polyline) return { points: decodePolyline(segment.polyline), approximate: false };
  if (
    segment.start_lat !== null &&
    segment.start_lng !== null &&
    segment.end_lat !== null &&
    segment.end_lng !== null
  ) {
    return {
      points: [
        [segment.start_lat, segment.start_lng],
        [segment.end_lat, segment.end_lng],
      ],
      approximate: true,
    };
  }
  return { points: [], approximate: true };
}

function isoDatePlusDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Builds a segment's detail view: personal history plus hourly wind-projected times across the forecast horizon. */
export class SegmentDetailService {
  constructor(
    private readonly repo: Repository,
    private readonly weather: OpenMeteoClient,
    private readonly config: SearchConfig,
  ) {}

  async getDetail(
    segmentId: number,
    riderParams?: RiderParams,
    horizonDays = 14,
  ): Promise<SegmentDetailResult | undefined> {
    const segment = await this.repo.getSegment(segmentId);
    if (!segment) return undefined;

    const rider = riderParams ?? this.config.rider;
    const status = komStatus(segment, this.config.segment.komFreshnessDays);
    const idealWindFromDeg = segment.bearing_deg !== null ? (segment.bearing_deg + 180) % 360 : undefined;

    const summary: SegmentSummary = {
      id: segment.id,
      name: segment.name,
      distanceM: segment.distance_m,
      averageGrade: segment.average_grade,
      bearingDeg: segment.bearing_deg,
      directionality: segment.directionality,
      geometryApproximate: segment.geometry_approximate === 1,
      windNeutral: segment.wind_neutral === 1,
      startLat: segment.start_lat,
      startLng: segment.start_lng,
      route: segmentRoute(segment),
    };

    const personalHistory: PersonalHistory = {
      prSeconds: segment.pr_seconds,
      prStartDate: segment.pr_start_date,
      effortCount: segment.effort_count,
      bestKomRank: segment.best_kom_rank,
      komSeconds: segment.kom_seconds,
      komStatus: status,
      komFetchedAt: segment.kom_fetched_at,
    };

    const canProject =
      segment.has_baseline === 1 &&
      segment.wind_neutral !== 1 &&
      segment.start_lat !== null &&
      segment.start_lng !== null &&
      segment.bearing_deg !== null &&
      segment.distance_m !== null &&
      segment.average_grade !== null;

    if (!canProject) {
      return {
        segment: summary,
        personalHistory,
        idealWindFromDeg,
        riderParamsUsed: rider,
        confidence: undefined,
        hourly: [],
        fastestHours: [],
        message:
          segment.wind_neutral === 1
            ? 'This segment is wind-neutral; wind projections are not meaningful here.'
            : 'No personal baseline effort exists for this segment yet, so no projection can be calibrated.',
      };
    }

    const pr = await resolvePrEffort(this.repo, segment);
    if (!pr) {
      return {
        segment: summary,
        personalHistory,
        idealWindFromDeg,
        riderParamsUsed: rider,
        confidence: undefined,
        hourly: [],
        fastestHours: [],
        message: 'No personal baseline effort exists for this segment yet, so no projection can be calibrated.',
      };
    }

    const historicalWind = await resolvePrWind(this.weather, segment, pr);

    const power = calibratePower(
      pr.elapsedS,
      segment.distance_m as number,
      segment.average_grade as number,
      segment.bearing_deg as number,
      rider,
      historicalWind,
    );

    const today = new Date();
    const latest = this.weather.latestForecastDate(today);
    const hourly: HourlyProjection[] = [];
    let weatherUnavailable = false;

    for (let i = 0; i < horizonDays; i++) {
      const date = isoDatePlusDays(today, i);
      if (date > latest) break;

      try {
        const hours = await this.weather.getForecast(segment.start_lat as number, segment.start_lng as number, date, today);
        for (const hour of hours) {
          const projection = projectTime(
            power,
            hour,
            segment.distance_m as number,
            segment.average_grade as number,
            segment.bearing_deg as number,
            rider,
          );
          hourly.push({
            time: hour.time,
            windSpeedMs: hour.windSpeedMs,
            windDirectionDeg: hour.windDirectionDeg,
            predictedTimeS: projection.predictedTimeS,
            gapToKomS: segment.kom_seconds !== null ? gapToKomSeconds(projection.predictedTimeS, segment.kom_seconds) : undefined,
          });
        }
      } catch (err) {
        if (err instanceof WeatherUnavailableError) {
          weatherUnavailable = true;
          break;
        }
        throw err;
      }
    }

    const fastestHours = [...hourly].sort((a, b) => a.predictedTimeS - b.predictedTimeS).slice(0, 5);

    const result: SegmentDetailResult = {
      segment: summary,
      personalHistory,
      idealWindFromDeg,
      riderParamsUsed: rider,
      confidence: power.confidence,
      hourly,
      fastestHours,
    };
    if (weatherUnavailable) result.weatherUnavailable = true;
    return result;
  }
}
