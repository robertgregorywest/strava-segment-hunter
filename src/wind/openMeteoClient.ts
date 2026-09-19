import type { SqlBackend, SqlStatement } from '../db/backend.js';
import type { ForecastCacheRow, HistoricalWindCacheRow } from '../db/types.js';
import type { HourlyWind } from './types.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

/** Open-Meteo's free-tier hourly forecast horizon, conservatively. */
export const FORECAST_HORIZON_DAYS = 14;

export class WeatherUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Open-Meteo could not be reached; wind conditions are unavailable.');
    this.name = 'WeatherUnavailableError';
    this.cause = cause;
  }
}

export class ForecastHorizonExceededError extends Error {
  constructor(public readonly latestSelectableDate: string) {
    super(`Target date is beyond the forecast horizon. Latest selectable date: ${latestSelectableDate}.`);
    this.name = 'ForecastHorizonExceededError';
  }
}

interface OpenMeteoHourlyResponse {
  hourly?: {
    time: string[];
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
    wind_gusts_10m?: number[];
  };
}

function parseHourly(body: OpenMeteoHourlyResponse): HourlyWind[] {
  const hourly = body.hourly;
  if (!hourly) return [];
  return hourly.time.map((time, i) => ({
    time: time.endsWith('Z') ? time : `${time}Z`,
    windSpeedMs: hourly.wind_speed_10m?.[i] ?? 0,
    windDirectionDeg: hourly.wind_direction_10m?.[i] ?? 0,
    windGustsMs: hourly.wind_gusts_10m?.[i] ?? null,
  }));
}

function cacheKey(lat: number, lng: number, date: string): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}|${date}`;
}

/** Wraps Open-Meteo's forecast and archive APIs with caching and horizon/unreachability handling. */
export class OpenMeteoClient {
  constructor(
    private readonly db: SqlBackend,
    private readonly forecastCacheMinutes: number,
    // Not just `= fetch`: the Workers runtime's global fetch is a WebIDL
    // method that requires its original `this` (globalThis) — storing the
    // bare reference and calling it as `this.fetchImpl(...)` throws
    // "Illegal invocation" there, even though it's silently fine under
    // Node/vitest's fetch. Only surfaces in a real `wrangler dev`/deployed
    // Worker, never in tests, which inject their own mock anyway.
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** The latest date the forecast API can project for. */
  latestForecastDate(now = new Date()): string {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + FORECAST_HORIZON_DAYS);
    return isoDate(d);
  }

  /** Hourly wind for a single calendar date (UTC) at a location. */
  async getForecast(lat: number, lng: number, dateISO: string, now = new Date()): Promise<HourlyWind[]> {
    const latest = this.latestForecastDate(now);
    if (dateISO > latest) {
      throw new ForecastHorizonExceededError(latest);
    }

    const key = cacheKey(lat, lng, dateISO);
    const cached = await this.readForecastCache(key);
    if (cached) return cached;

    const url = new URL(FORECAST_URL);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('start_date', dateISO);
    url.searchParams.set('end_date', dateISO);
    url.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m,wind_gusts_10m');
    url.searchParams.set('wind_speed_unit', 'ms');
    url.searchParams.set('timezone', 'UTC');

    const hours = parseHourly(await this.fetchJson(url));
    return this.cachePayload(key, lat, lng, dateISO, hours);
  }

  /** Wind at the closest available hour to a past timestamp, or undefined if the archive can't be reached. */
  async getHistoricalWindAt(
    lat: number,
    lng: number,
    isoTimestamp: string,
  ): Promise<{ windSpeedMs: number; windDirectionDeg: number } | undefined> {
    const date = isoTimestamp.slice(0, 10);
    let hours = await this.readHistoricalCache(lat, lng, date);

    if (hours.length === 0) {
      try {
        const url = new URL(ARCHIVE_URL);
        url.searchParams.set('latitude', String(lat));
        url.searchParams.set('longitude', String(lng));
        url.searchParams.set('start_date', date);
        url.searchParams.set('end_date', date);
        url.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m');
        url.searchParams.set('wind_speed_unit', 'ms');
        url.searchParams.set('timezone', 'UTC');
        hours = parseHourly(await this.fetchJson(url));
        await this.writeHistoricalCache(lat, lng, hours);
      } catch {
        return undefined;
      }
    }

    return nearestHour(hours, isoTimestamp);
  }

  private async fetchJson(url: URL): Promise<OpenMeteoHourlyResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (err) {
      throw new WeatherUnavailableError(err);
    }
    if (!response.ok) {
      throw new WeatherUnavailableError(new Error(`HTTP ${response.status}`));
    }
    return (await response.json()) as OpenMeteoHourlyResponse;
  }

  private async readForecastCache(key: string): Promise<HourlyWind[] | undefined> {
    const row = await this.db.get<ForecastCacheRow>('SELECT * FROM forecast_cache WHERE cache_key = ?', [key]);
    if (!row) return undefined;

    const ageMs = Date.now() - parseSqliteTimestamp(row.fetched_at).getTime();
    if (ageMs > this.forecastCacheMinutes * 60_000) return undefined;

    return JSON.parse(row.payload) as HourlyWind[];
  }

  private async cachePayload(key: string, lat: number, lng: number, date: string, hours: HourlyWind[]): Promise<HourlyWind[]> {
    await this.db.run(
      `INSERT INTO forecast_cache (cache_key, lat, lng, period_start, period_end, payload, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      [key, lat, lng, date, date, JSON.stringify(hours)],
    );
    return hours;
  }

  private async readHistoricalCache(lat: number, lng: number, date: string): Promise<HourlyWind[]> {
    const prefix = `${lat.toFixed(3)},${lng.toFixed(3)}|${date}`;
    const rows = await this.db.all<HistoricalWindCacheRow>(
      `SELECT * FROM historical_wind_cache WHERE cache_key LIKE ? ORDER BY timestamp ASC`,
      [`${prefix}%`],
    );

    return rows
      .filter((r) => r.wind_speed_ms !== null && r.wind_direction_deg !== null)
      .map((r) => ({
        time: r.timestamp,
        windSpeedMs: r.wind_speed_ms as number,
        windDirectionDeg: r.wind_direction_deg as number,
        windGustsMs: null,
      }));
  }

  private async writeHistoricalCache(lat: number, lng: number, hours: HourlyWind[]): Promise<void> {
    const statements: SqlStatement[] = hours.map((hour) => {
      const date = hour.time.slice(0, 10);
      const key = `${lat.toFixed(3)},${lng.toFixed(3)}|${date}|${hour.time}`;
      return {
        sql: `INSERT INTO historical_wind_cache (cache_key, lat, lng, timestamp, wind_speed_ms, wind_direction_deg, fetched_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(cache_key) DO NOTHING`,
        params: [key, lat, lng, hour.time, hour.windSpeedMs, hour.windDirectionDeg],
      };
    });
    await this.db.batch(statements);
  }
}

function nearestHour(hours: HourlyWind[], isoTimestamp: string): HourlyWind | undefined {
  if (hours.length === 0) return undefined;
  const target = new Date(isoTimestamp).getTime();
  return hours.reduce((closest, candidate) => {
    const closestDiff = Math.abs(new Date(closest.time).getTime() - target);
    const candidateDiff = Math.abs(new Date(candidate.time).getTime() - target);
    return candidateDiff < closestDiff ? candidate : closest;
  });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** SQLite's datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC but with no timezone marker. */
function parseSqliteTimestamp(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}
