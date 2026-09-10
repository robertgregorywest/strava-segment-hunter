import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DB } from '../src/db/index.js';
import {
  ForecastHorizonExceededError,
  OpenMeteoClient,
  WeatherUnavailableError,
} from '../src/wind/openMeteoClient.js';

function forecastResponse(date: string) {
  return new Response(
    JSON.stringify({
      hourly: {
        time: [`${date}T00:00`, `${date}T01:00`],
        wind_speed_10m: [3, 4],
        wind_direction_10m: [180, 190],
        wind_gusts_10m: [5, 6],
      },
    }),
    { status: 200 },
  );
}

describe('OpenMeteoClient', () => {
  let dir: string;
  let db: DB;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'segment-hunter-wind-'));
    db = openDatabase(join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('fetches and returns hourly forecast data', async () => {
    const fetchMock = vi.fn(async () => forecastResponse('2026-01-05'));
    const client = new OpenMeteoClient(db, 60, fetchMock as unknown as typeof fetch);

    const hours = await client.getForecast(51.5, -0.1, '2026-01-05');
    expect(hours).toHaveLength(2);
    expect(hours[0]).toMatchObject({ windSpeedMs: 3, windDirectionDeg: 180 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves cached forecast data within the cache window without a further request', async () => {
    const fetchMock = vi.fn(async () => forecastResponse('2026-01-05'));
    const client = new OpenMeteoClient(db, 60, fetchMock as unknown as typeof fetch);

    await client.getForecast(51.5, -0.1, '2026-01-05');
    await client.getForecast(51.5, -0.1, '2026-01-05');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache window has elapsed', async () => {
    const fetchMock = vi.fn(async () => forecastResponse('2026-01-05'));
    const client = new OpenMeteoClient(db, 0, fetchMock as unknown as typeof fetch); // 0-minute window

    await client.getForecast(51.5, -0.1, '2026-01-05');
    await client.getForecast(51.5, -0.1, '2026-01-05');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a target date beyond the forecast horizon and reports the latest selectable date', async () => {
    const client = new OpenMeteoClient(db, 60);
    const now = new Date('2026-01-01T00:00:00Z');

    await expect(client.getForecast(51.5, -0.1, '2026-06-01', now)).rejects.toThrow(
      ForecastHorizonExceededError,
    );
  });

  it('signals unavailability rather than a network error leaking through', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = new OpenMeteoClient(db, 60, fetchMock as unknown as typeof fetch);

    await expect(client.getForecast(51.5, -0.1, '2026-01-05')).rejects.toBeInstanceOf(WeatherUnavailableError);
  });

  it('fetches historical wind and picks the hour nearest a given timestamp', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hourly: {
              time: ['2024-06-01T07:00', '2024-06-01T08:00', '2024-06-01T09:00'],
              wind_speed_10m: [2, 5, 3],
              wind_direction_10m: [100, 200, 300],
            },
          }),
          { status: 200 },
        ),
    );
    const client = new OpenMeteoClient(db, 60, fetchMock as unknown as typeof fetch);

    const wind = await client.getHistoricalWindAt(51.5, -0.1, '2024-06-01T08:05:00Z');
    expect(wind).toMatchObject({ windSpeedMs: 5, windDirectionDeg: 200 });
  });

  it('returns undefined for historical wind when the archive is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('down');
    });
    const client = new OpenMeteoClient(db, 60, fetchMock as unknown as typeof fetch);

    const wind = await client.getHistoricalWindAt(51.5, -0.1, '2024-06-01T08:05:00Z');
    expect(wind).toBeUndefined();
  });
});
