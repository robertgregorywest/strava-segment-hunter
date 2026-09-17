import type { NearbySegment, Repository } from '../db/repository.js';
import type { SegmentRow } from '../db/types.js';
import { komStatus, type KomStatus } from '../segment/komStatus.js';
import { ForecastHorizonExceededError, WeatherUnavailableError, type OpenMeteoClient } from '../wind/openMeteoClient.js';
import { calibratePower, gapToKomSeconds, projectTime, type ProjectionConfidence, type RiderParams } from '../wind/projection.js';
import type { HourlyWind } from '../wind/types.js';
import { resolvePrEffort } from './calibration.js';
import type { SearchConfig } from './types.js';

export type SearchOrderBy = 'projectedMargin' | 'distance' | 'length' | 'gradient';

export interface SearchFilters {
  lat?: number;
  lng?: number;
  radiusM: number;
  /** YYYY-MM-DD, UTC. Defaults to today. */
  targetDate?: string;
  maxGapToKomS?: number;
  maxKomRank?: number;
  minLengthM?: number;
  maxLengthM?: number;
  minGradePercent?: number;
  maxGradePercent?: number;
  minDirectionality?: number;
  orderBy?: SearchOrderBy;
  /** Overrides the configured default rider parameters for this search's projections. */
  riderParams?: RiderParams;
}

export interface SearchWindAnnotation {
  hour: string;
  windSpeedMs: number;
  windDirectionDeg: number;
  predictedTimeS: number;
  confidence: ProjectionConfidence;
}

export interface SearchResultItem {
  segmentId: number;
  name: string | null;
  distanceFromSearchM: number;
  startLat: number | null;
  startLng: number | null;
  lengthM: number | null;
  averageGrade: number | null;
  bearingDeg: number | null;
  directionality: number | null;
  windNeutral: boolean;
  geometryApproximate: boolean;
  komStatus: KomStatus;
  komSeconds: number | null;
  bestKomRank: number | null;
  hasBaseline: boolean;
  wind: SearchWindAnnotation | undefined;
  gapToKomS: number | undefined;
}

export interface SearchResult {
  items: SearchResultItem[];
  message?: string;
  weatherUnavailable?: boolean;
}

function isoDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function passesShapeFilters(segment: NearbySegment, filters: SearchFilters): boolean {
  if (filters.minLengthM !== undefined && (segment.distance_m === null || segment.distance_m < filters.minLengthM)) return false;
  if (filters.maxLengthM !== undefined && (segment.distance_m === null || segment.distance_m > filters.maxLengthM)) return false;
  if (
    filters.minGradePercent !== undefined &&
    (segment.average_grade === null || segment.average_grade < filters.minGradePercent)
  ) {
    return false;
  }
  if (
    filters.maxGradePercent !== undefined &&
    (segment.average_grade === null || segment.average_grade > filters.maxGradePercent)
  ) {
    return false;
  }
  if (
    filters.minDirectionality !== undefined &&
    (segment.directionality === null || segment.directionality < filters.minDirectionality)
  ) {
    return false;
  }
  return true;
}

function sortResults(items: SearchResultItem[], orderBy: SearchOrderBy): void {
  switch (orderBy) {
    case 'distance':
      items.sort((a, b) => a.distanceFromSearchM - b.distanceFromSearchM);
      return;
    case 'length':
      items.sort((a, b) => (a.lengthM ?? Number.POSITIVE_INFINITY) - (b.lengthM ?? Number.POSITIVE_INFINITY));
      return;
    case 'gradient':
      items.sort((a, b) => (a.averageGrade ?? Number.POSITIVE_INFINITY) - (b.averageGrade ?? Number.POSITIVE_INFINITY));
      return;
    case 'projectedMargin':
    default:
      items.sort((a, b) => (a.gapToKomS ?? Number.POSITIVE_INFINITY) - (b.gapToKomS ?? Number.POSITIVE_INFINITY));
  }
}

/** Searches the corpus by proximity and segment criteria, ranked by attainability of the KOM on a target date. */
export class SearchService {
  constructor(
    private readonly repo: Repository,
    private readonly weather: OpenMeteoClient,
    private readonly config: SearchConfig,
  ) {}

  async search(filters: SearchFilters): Promise<SearchResult> {
    const lat = filters.lat ?? this.config.home.lat;
    const lng = filters.lng ?? this.config.home.lng;
    const targetDate = filters.targetDate ?? isoDateToday();
    const rider: RiderParams = filters.riderParams ?? this.config.rider;

    const latestSelectable = this.weather.latestForecastDate();
    if (targetDate > latestSelectable) {
      throw new ForecastHorizonExceededError(latestSelectable);
    }

    const nearby = await this.repo.segmentsWithinRadius(lat, lng, filters.radiusM);
    if (nearby.length === 0) {
      return {
        items: [],
        message: `No corpus segments found within ${filters.radiusM}m of the search location.`,
      };
    }

    let weatherUnavailable = false;
    const items: SearchResultItem[] = [];

    for (const segment of nearby) {
      if (!passesShapeFilters(segment, filters)) continue;
      if (
        filters.maxKomRank !== undefined &&
        (segment.best_kom_rank === null || segment.best_kom_rank > filters.maxKomRank)
      ) {
        continue;
      }

      const status = komStatus(segment, this.config.segment.komFreshnessDays);
      const windNeutralFlag = segment.wind_neutral === 1;

      let wind: SearchWindAnnotation | undefined;
      let gapToKomS: number | undefined;

      const canProject =
        segment.has_baseline === 1 &&
        !windNeutralFlag &&
        segment.start_lat !== null &&
        segment.start_lng !== null &&
        segment.bearing_deg !== null &&
        segment.distance_m !== null &&
        segment.average_grade !== null;

      if (canProject && !weatherUnavailable) {
        try {
          const hourly = await this.weather.getForecast(segment.start_lat as number, segment.start_lng as number, targetDate);
          wind = await this.bestHourProjection(segment, hourly, rider);
          if (wind && status !== 'absent' && segment.kom_seconds !== null) {
            gapToKomS = gapToKomSeconds(wind.predictedTimeS, segment.kom_seconds);
          }
        } catch (err) {
          if (err instanceof WeatherUnavailableError) {
            weatherUnavailable = true;
          } else {
            throw err;
          }
        }
      }

      if (filters.maxGapToKomS !== undefined && (gapToKomS === undefined || gapToKomS > filters.maxGapToKomS)) {
        continue;
      }

      items.push({
        segmentId: segment.id,
        name: segment.name,
        distanceFromSearchM: segment.distanceFromSearchM,
        startLat: segment.start_lat,
        startLng: segment.start_lng,
        lengthM: segment.distance_m,
        averageGrade: segment.average_grade,
        bearingDeg: segment.bearing_deg,
        directionality: segment.directionality,
        windNeutral: windNeutralFlag,
        geometryApproximate: segment.geometry_approximate === 1,
        komStatus: status,
        komSeconds: segment.kom_seconds,
        bestKomRank: segment.best_kom_rank,
        hasBaseline: segment.has_baseline === 1,
        wind,
        gapToKomS,
      });
    }

    sortResults(items, filters.orderBy ?? 'projectedMargin');

    const result: SearchResult = { items };
    if (weatherUnavailable) result.weatherUnavailable = true;
    return result;
  }

  private async bestHourProjection(
    segment: SegmentRow,
    hourly: HourlyWind[],
    rider: RiderParams,
  ): Promise<SearchWindAnnotation | undefined> {
    if (hourly.length === 0) return undefined;

    const pr = await resolvePrEffort(this.repo, segment);
    if (!pr) return undefined;

    let historicalWind: { windSpeedMs: number; windDirectionDeg: number } | undefined;
    if (pr.startDate) {
      historicalWind = await this.weather.getHistoricalWindAt(
        segment.start_lat as number,
        segment.start_lng as number,
        pr.startDate,
      );
    }

    const power = calibratePower(
      pr.elapsedS,
      segment.distance_m as number,
      segment.average_grade as number,
      segment.bearing_deg as number,
      rider,
      historicalWind,
    );

    let best: { hour: HourlyWind; predictedTimeS: number } | undefined;
    for (const hour of hourly) {
      const projection = projectTime(power, hour, segment.distance_m as number, segment.average_grade as number, segment.bearing_deg as number, rider);
      if (!best || projection.predictedTimeS < best.predictedTimeS) {
        best = { hour, predictedTimeS: projection.predictedTimeS };
      }
    }
    if (!best) return undefined;

    return {
      hour: best.hour.time,
      windSpeedMs: best.hour.windSpeedMs,
      windDirectionDeg: best.hour.windDirectionDeg,
      predictedTimeS: best.predictedTimeS,
      confidence: power.confidence,
    };
  }
}
