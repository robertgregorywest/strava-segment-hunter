import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config/index.js';
import { openDatabase, type DB } from '../src/db/index.js';
import { Repository, type SegmentDetail } from '../src/db/repository.js';
import { OpenMeteoClient } from '../src/wind/openMeteoClient.js';
import { SegmentDetailService } from '../src/search/segmentDetailService.js';

function testConfig(): Config {
  return {
    strava: { clientId: 'x', clientSecret: 'x', redirectUri: 'http://localhost', tokenPath: 'x' },
    home: { lat: 51.5, lng: -0.1 },
    rider: { massKg: 78, cdA: 0.32, crr: 0.005, roughnessFactor: 0.55 },
    db: { path: 'x' },
    api: { port: 3000 },
    sync: { shortWindowPauseFraction: 0.9, requestTimeoutMs: 30_000, maxNetworkRetries: 5 },
    segment: { komFreshnessDays: 14, windNeutralThreshold: 0.5 },
    weather: { forecastCacheMinutes: 60 },
  };
}

function windFetchMock(windSpeedMs: number, windDirectionDeg: number) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        hourly: {
          time: ['00:00', '12:00'].map((t) => `${new Date().toISOString().slice(0, 10)}T${t}`),
          wind_speed_10m: [windSpeedMs, windSpeedMs],
          wind_direction_10m: [windDirectionDeg, windDirectionDeg],
          wind_gusts_10m: [windSpeedMs, windSpeedMs],
        },
      }),
      { status: 200 },
    ),
  );
}

describe('SegmentDetailService', () => {
  let dir: string;
  let db: DB;
  let repo: Repository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'segment-hunter-detail-'));
    db = openDatabase(join(dir, 'test.db'));
    repo = new Repository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(overrides: Partial<SegmentDetail> = {}) {
    repo.upsertSegmentStub({
      id: 1,
      name: 'Test',
      distanceM: null,
      averageGrade: null,
      startLat: 51.5,
      startLng: -0.1,
      endLat: null,
      endLng: null,
    });
    const detail: SegmentDetail = {
      id: 1,
      polyline: null,
      distanceM: 3538,
      averageGrade: 0.9,
      elevationHigh: null,
      elevationLow: null,
      startLat: 51.5,
      startLng: -0.1,
      endLat: null,
      endLng: null,
      komSeconds: 306,
      prSeconds: 320,
      prActivityId: 999,
      prStartDate: '2024-06-01T08:00:00Z',
      effortCount: 3,
      ...overrides,
    };
    repo.applyEnrichment(detail, new Date().toISOString());
    repo.applyGeometry(1, 319.3, 0.97, false, false);
    repo.markSegmentHasBaseline(1);
  }

  it('returns undefined for an unknown segment', async () => {
    const weather = new OpenMeteoClient(db, 60);
    const service = new SegmentDetailService(repo, weather, testConfig());
    expect(await service.getDetail(999)).toBeUndefined();
  });

  it('computes the ideal wind-from direction as the reciprocal of bearing', async () => {
    seed();
    const weather = new OpenMeteoClient(db, 60, windFetchMock(3, 139.3) as unknown as typeof fetch);
    const service = new SegmentDetailService(repo, weather, testConfig());

    const detail = await service.getDetail(1, undefined, 1);
    expect(detail?.idealWindFromDeg).toBeCloseTo(139.3, 5);
  });

  it('produces hourly projections and highlights the fastest hours', async () => {
    seed();
    const weather = new OpenMeteoClient(db, 60, windFetchMock(4, 139.3) as unknown as typeof fetch);
    const service = new SegmentDetailService(repo, weather, testConfig());

    const detail = await service.getDetail(1, undefined, 1);
    expect(detail?.hourly.length).toBeGreaterThan(0);
    expect(detail?.fastestHours.length).toBeGreaterThan(0);
    expect(detail?.fastestHours[0]?.predictedTimeS).toBeLessThanOrEqual(detail?.hourly[0]?.predictedTimeS ?? Infinity);
    expect(detail?.confidence).toBe('calibrated');
  });

  it('reports a message instead of projections when there is no baseline effort', async () => {
    seed({ prSeconds: null, prActivityId: null, prStartDate: null, effortCount: null });
    const weather = new OpenMeteoClient(db, 60);
    const service = new SegmentDetailService(repo, weather, testConfig());

    const detail = await service.getDetail(1, undefined, 1);
    expect(detail?.hourly).toEqual([]);
    expect(detail?.message).toMatch(/no personal baseline/i);
  });
});
