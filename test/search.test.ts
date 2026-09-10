import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config/index.js';
import { openDatabase, type DB } from '../src/db/index.js';
import { Repository, type SegmentDetail } from '../src/db/repository.js';
import { ForecastHorizonExceededError, OpenMeteoClient } from '../src/wind/openMeteoClient.js';
import { SearchService } from '../src/search/searchService.js';

const HOME = { lat: 51.5, lng: -0.1 };

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    strava: { clientId: 'x', clientSecret: 'x', redirectUri: 'http://localhost', tokenPath: 'x' },
    home: HOME,
    rider: { massKg: 78, cdA: 0.32, crr: 0.005, roughnessFactor: 0.55 },
    db: { path: 'x' },
    api: { port: 3000 },
    sync: { shortWindowPauseFraction: 0.9, requestTimeoutMs: 30_000, maxNetworkRetries: 5 },
    segment: { komFreshnessDays: 14, windNeutralThreshold: 0.5 },
    weather: { forecastCacheMinutes: 60 },
    ...overrides,
  };
}

interface SegmentFixture {
  id: number;
  name: string;
  startLat: number;
  startLng: number;
  distanceM: number;
  averageGrade: number;
  bearingDeg: number;
  directionality: number;
  windNeutral: boolean;
  komSeconds: number | null;
  prSeconds: number | null;
  prStartDate: string | null;
  bestKomRank: number | null;
  hasBaseline: boolean;
}

function seedSegment(repo: Repository, f: SegmentFixture): void {
  repo.upsertSegmentStub({
    id: f.id,
    name: f.name,
    distanceM: null,
    averageGrade: null,
    startLat: f.startLat,
    startLng: f.startLng,
    endLat: null,
    endLng: null,
  });
  const detail: SegmentDetail = {
    id: f.id,
    polyline: null,
    distanceM: f.distanceM,
    averageGrade: f.averageGrade,
    elevationHigh: null,
    elevationLow: null,
    startLat: f.startLat,
    startLng: f.startLng,
    endLat: null,
    endLng: null,
    komSeconds: f.komSeconds,
    prSeconds: f.prSeconds,
    prActivityId: f.prSeconds !== null ? 999 : null,
    prStartDate: f.prStartDate,
    effortCount: f.hasBaseline ? 1 : null,
  };
  repo.applyEnrichment(detail, new Date().toISOString());
  repo.applyGeometry(f.id, f.bearingDeg, f.directionality, false, f.windNeutral);
  if (f.hasBaseline) repo.markSegmentHasBaseline(f.id);
  if (f.bestKomRank !== null) {
    repo.upsertActivityStub(f.id * 100, `Activity for ${f.name}`, f.prStartDate ?? new Date().toISOString());
    repo.insertEffort({
      id: f.id * 100,
      segmentId: f.id,
      activityId: f.id * 100,
      elapsedTimeS: f.prSeconds ?? 400,
      startDate: f.prStartDate ?? new Date().toISOString(),
      prRank: 1,
      komRank: f.bestKomRank,
    });
    repo.refreshBestKomRank(f.id);
  }
}

function windFetchMock(windSpeedMs: number, windDirectionDeg: number) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        hourly: {
          time: ['2026-01-05T00:00', '2026-01-05T12:00'],
          wind_speed_10m: [windSpeedMs, windSpeedMs],
          wind_direction_10m: [windDirectionDeg, windDirectionDeg],
          wind_gusts_10m: [windSpeedMs, windSpeedMs],
        },
      }),
      { status: 200 },
    ),
  );
}

describe('SearchService', () => {
  let dir: string;
  let db: DB;
  let repo: Repository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'segment-hunter-search-'));
    db = openDatabase(join(dir, 'test.db'));
    repo = new Repository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns nearby segments with distance from the search location, defaulting to home', async () => {
    seedSegment(repo, {
      id: 1,
      name: 'Near',
      startLat: 51.501,
      startLng: -0.101,
      distanceM: 3538,
      averageGrade: 0.9,
      bearingDeg: 319.3,
      directionality: 0.97,
      windNeutral: false,
      komSeconds: 306,
      prSeconds: 320,
      prStartDate: '2024-06-01T08:00:00Z',
      bestKomRank: 5,
      hasBaseline: true,
    });

    const weather = new OpenMeteoClient(db, 60, windFetchMock(3, 139.3) as unknown as typeof fetch);
    const service = new SearchService(repo, weather, testConfig());

    const result = await service.search({ radiusM: 2000, targetDate: '2026-01-05' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.segmentId).toBe(1);
    expect(result.items[0]?.distanceFromSearchM).toBeGreaterThan(0);
    expect(result.items[0]?.wind).toBeDefined();
    expect(result.items[0]?.gapToKomS).toBeDefined();
  });

  it('combines filters for length, gradient and kom rank', async () => {
    seedSegment(repo, {
      id: 1,
      name: 'Short flat',
      startLat: 51.501,
      startLng: -0.101,
      distanceM: 500,
      averageGrade: 0.2,
      bearingDeg: 90,
      directionality: 0.9,
      windNeutral: false,
      komSeconds: 60,
      prSeconds: 65,
      prStartDate: null,
      bestKomRank: 20,
      hasBaseline: true,
    });
    seedSegment(repo, {
      id: 2,
      name: 'Long steep',
      startLat: 51.502,
      startLng: -0.102,
      distanceM: 5000,
      averageGrade: 5,
      bearingDeg: 90,
      directionality: 0.9,
      windNeutral: false,
      komSeconds: 900,
      prSeconds: 950,
      prStartDate: null,
      bestKomRank: 3,
      hasBaseline: true,
    });

    const weather = new OpenMeteoClient(db, 60, windFetchMock(3, 270) as unknown as typeof fetch);
    const service = new SearchService(repo, weather, testConfig());

    const result = await service.search({
      radiusM: 5000,
      targetDate: '2026-01-05',
      maxLengthM: 1000,
      minGradePercent: 0,
      maxKomRank: 50,
    });

    expect(result.items.map((i) => i.segmentId)).toEqual([1]);
  });

  it('suppresses projected benefit for wind-neutral segments', async () => {
    seedSegment(repo, {
      id: 1,
      name: 'Loop',
      startLat: 51.501,
      startLng: -0.101,
      distanceM: 1000,
      averageGrade: 1,
      bearingDeg: 90,
      directionality: 0.1,
      windNeutral: true,
      komSeconds: 200,
      prSeconds: 210,
      prStartDate: null,
      bestKomRank: 2,
      hasBaseline: true,
    });

    const weather = new OpenMeteoClient(db, 60, windFetchMock(5, 90) as unknown as typeof fetch);
    const service = new SearchService(repo, weather, testConfig());

    const result = await service.search({ radiusM: 2000, targetDate: '2026-01-05' });

    expect(result.items[0]?.windNeutral).toBe(true);
    expect(result.items[0]?.wind).toBeUndefined();
    expect(result.items[0]?.gapToKomS).toBeUndefined();
  });

  it('suppresses gap-to-KOM when the athlete has no baseline effort', async () => {
    seedSegment(repo, {
      id: 1,
      name: 'Never ridden',
      startLat: 51.501,
      startLng: -0.101,
      distanceM: 1000,
      averageGrade: 1,
      bearingDeg: 90,
      directionality: 0.9,
      windNeutral: false,
      komSeconds: 200,
      prSeconds: null,
      prStartDate: null,
      bestKomRank: null,
      hasBaseline: false,
    });

    const weather = new OpenMeteoClient(db, 60, windFetchMock(5, 270) as unknown as typeof fetch);
    const service = new SearchService(repo, weather, testConfig());

    const result = await service.search({ radiusM: 2000, targetDate: '2026-01-05' });

    expect(result.items[0]?.hasBaseline).toBe(false);
    expect(result.items[0]?.wind).toBeUndefined();
    expect(result.items[0]?.gapToKomS).toBeUndefined();
  });

  it('ranks by projected margin by default, and supports alternative orderings', async () => {
    seedSegment(repo, {
      id: 1,
      name: 'Comfortable margin',
      startLat: 51.501,
      startLng: -0.101,
      distanceM: 2000,
      averageGrade: 1,
      bearingDeg: 90,
      directionality: 0.9,
      windNeutral: false,
      komSeconds: 400,
      prSeconds: 405,
      prStartDate: null,
      bestKomRank: 2,
      hasBaseline: true,
    });
    seedSegment(repo, {
      id: 2,
      name: 'Far off KOM',
      startLat: 51.502,
      startLng: -0.102,
      distanceM: 3000,
      averageGrade: 1,
      bearingDeg: 90,
      directionality: 0.9,
      windNeutral: false,
      komSeconds: 300,
      prSeconds: 600,
      prStartDate: null,
      bestKomRank: 50,
      hasBaseline: true,
    });

    const weather = new OpenMeteoClient(db, 60, windFetchMock(3, 270) as unknown as typeof fetch);
    const service = new SearchService(repo, weather, testConfig());

    const byMargin = await service.search({ radiusM: 5000, targetDate: '2026-01-05' });
    expect(byMargin.items[0]?.segmentId).toBe(1);

    const byLength = await service.search({ radiusM: 5000, targetDate: '2026-01-05', orderBy: 'length' });
    expect(byLength.items.map((i) => i.segmentId)).toEqual([1, 2]);
  });

  it('returns an explanatory empty result when nothing is in range', async () => {
    const weather = new OpenMeteoClient(db, 60);
    const service = new SearchService(repo, weather, testConfig());

    const result = await service.search({ radiusM: 500 });

    expect(result.items).toHaveLength(0);
    expect(result.message).toMatch(/no corpus segments/i);
  });

  it('rejects a target date beyond the forecast horizon', async () => {
    const weather = new OpenMeteoClient(db, 60);
    const service = new SearchService(repo, weather, testConfig());

    await expect(service.search({ radiusM: 2000, targetDate: '2099-01-01' })).rejects.toBeInstanceOf(
      ForecastHorizonExceededError,
    );
  });
});
