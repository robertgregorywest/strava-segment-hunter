import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalBackend, type DB } from '../src/db/index.js';
import { Repository } from '../src/db/repository.js';
import { annotatePrWind } from '../src/sync/prWind.js';
import { OpenMeteoClient } from '../src/wind/openMeteoClient.js';

const HOME = { lat: 51.5, lng: -0.1 };

function archiveResponse(windSpeedMs: number) {
  return new Response(
    JSON.stringify({
      hourly: { time: ['2024-06-01T08:00'], wind_speed_10m: [windSpeedMs], wind_direction_10m: [200] },
    }),
    { status: 200 },
  );
}

async function seedProjectable(repo: Repository, id: number, startLat: number, prStartDate: string): Promise<void> {
  await repo.upsertSegmentStub({
    id,
    name: `Segment ${id}`,
    distanceM: 1000,
    averageGrade: 1,
    startLat,
    startLng: -0.1,
    endLat: null,
    endLng: null,
  });
  await repo.applyEnrichment(
    {
      id,
      polyline: null,
      distanceM: null,
      averageGrade: null,
      elevationHigh: null,
      elevationLow: null,
      startLat: null,
      startLng: null,
      endLat: null,
      endLng: null,
      komSeconds: 300,
      prSeconds: 320,
      prActivityId: 1,
      prStartDate,
      effortCount: 1,
    },
    new Date().toISOString(),
  );
  await repo.markSegmentHasBaseline(id);
}

describe('annotatePrWind', () => {
  let dir: string;
  let db: DB;
  let repo: Repository;
  let backend: ReturnType<typeof openLocalBackend>['backend'];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'segment-hunter-prwind-'));
    const opened = openLocalBackend(join(dir, 'test.db'));
    db = opened.db;
    backend = opened.backend;
    repo = new Repository(opened.backend);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores the PR wind on the segment and skips it once current', async () => {
    await seedProjectable(repo, 1, 51.501, '2024-06-01T08:05:00Z');
    const fetchMock = vi.fn(async () => archiveResponse(5));
    const weather = new OpenMeteoClient(backend, 60, fetchMock as unknown as typeof fetch);

    expect(await annotatePrWind(weather, repo, HOME)).toBe(1);
    expect(await repo.getSegment(1)).toMatchObject({
      pr_wind_speed_ms: 5,
      pr_wind_direction_deg: 200,
      pr_wind_start_date: '2024-06-01T08:05:00Z',
    });

    expect(await annotatePrWind(weather, repo, HOME)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('looks the wind up again once a new PR moves pr_start_date on', async () => {
    await seedProjectable(repo, 1, 51.501, '2024-06-01T08:05:00Z');
    const weather = new OpenMeteoClient(backend, 60, vi.fn(async () => archiveResponse(5)) as unknown as typeof fetch);
    await annotatePrWind(weather, repo, HOME);

    await repo.applyEnrichment(
      {
        id: 1,
        polyline: null,
        distanceM: null,
        averageGrade: null,
        elevationHigh: null,
        elevationLow: null,
        startLat: null,
        startLng: null,
        endLat: null,
        endLng: null,
        komSeconds: 300,
        prSeconds: 310,
        prActivityId: 2,
        prStartDate: '2025-03-01T08:00:00Z',
        effortCount: 2,
      },
      new Date().toISOString(),
    );

    expect(await repo.segmentsNeedingPrWind()).toHaveLength(1);
  });

  it('works nearest-to-home first within the per-run limit', async () => {
    await seedProjectable(repo, 1, 51.6, '2024-06-01T08:05:00Z');
    await seedProjectable(repo, 2, 51.501, '2024-06-01T08:05:00Z');
    const weather = new OpenMeteoClient(backend, 60, vi.fn(async () => archiveResponse(5)) as unknown as typeof fetch);

    expect(await annotatePrWind(weather, repo, HOME, 1)).toBe(1);
    expect((await repo.getSegment(2))?.pr_wind_start_date).not.toBeNull();
    expect((await repo.getSegment(1))?.pr_wind_start_date).toBeNull();
  });

  it('stops the run when Open-Meteo is unavailable rather than failing every lookup', async () => {
    await seedProjectable(repo, 1, 51.501, '2024-06-01T08:05:00Z');
    await seedProjectable(repo, 2, 51.502, '2024-06-01T08:05:00Z');
    const fetchMock = vi.fn(async () => new Response('slow down', { status: 429 }));
    const weather = new OpenMeteoClient(backend, 60, fetchMock as unknown as typeof fetch);

    expect(await annotatePrWind(weather, repo, HOME)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
