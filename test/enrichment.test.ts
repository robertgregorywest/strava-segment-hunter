import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLocalBackend, type DB } from '../src/db/index.js';
import { Repository } from '../src/db/repository.js';
import { enrichSegments } from '../src/sync/enrichment.js';
import { komStatus, parseKomDuration } from '../src/segment/komStatus.js';
import type { StravaReadClient } from '../src/strava/client.js';
import type { StravaDetailedSegment } from '../src/strava/types.js';

describe('parseKomDuration', () => {
  it('parses M:SS', () => expect(parseKomDuration('5:06')).toBe(306));
  it('parses H:MM:SS', () => expect(parseKomDuration('1:02:03')).toBe(3723));
  it('returns null for undefined or garbage', () => {
    expect(parseKomDuration(undefined)).toBeNull();
    expect(parseKomDuration('not-a-time')).toBeNull();
  });
});

describe('komStatus', () => {
  it('is absent when never fetched', () => {
    expect(komStatus({ kom_seconds: null, kom_fetched_at: null }, 14)).toBe('absent');
  });
  it('is fresh within the window', () => {
    expect(komStatus({ kom_seconds: 306, kom_fetched_at: new Date().toISOString() }, 14)).toBe('fresh');
  });
  it('is stale past the window', () => {
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    expect(komStatus({ kom_seconds: 306, kom_fetched_at: old }, 14)).toBe('stale');
  });
});

function detailFixture(overrides: Partial<StravaDetailedSegment> = {}): StravaDetailedSegment {
  return {
    id: 1,
    name: 'Test',
    distance: 3538,
    average_grade: 0.9,
    start_latlng: [51.5, -0.1],
    end_latlng: [51.51, -0.11],
    elevation_high: 50,
    elevation_low: 20,
    map: { polyline: 'abc' },
    xoms: { kom: '5:06' },
    athlete_segment_stats: { pr_elapsed_time: 310, pr_activity_id: 999, pr_date: '2024-06-01T08:00:00Z', effort_count: 5 },
    ...overrides,
  };
}

class FakeStravaClient implements Partial<StravaReadClient> {
  calls: number[] = [];
  constructor(private readonly bySegmentId: Map<number, StravaDetailedSegment>) {}

  async getSegment(id: number): Promise<StravaDetailedSegment> {
    this.calls.push(id);
    const detail = this.bySegmentId.get(id);
    if (!detail) throw new Error(`no fixture for segment ${id}`);
    return detail;
  }
}

describe('enrichSegments', () => {
  let dir: string;
  let db: DB;
  let repo: Repository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'segment-hunter-enrich-'));
    const opened = openLocalBackend(join(dir, 'test.db'));
    db = opened.db;
    repo = new Repository(opened.backend);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('enriches nearest-to-home segments first and persists all detail fields', async () => {
    await repo.upsertSegmentStub({ id: 1, name: 'Far', distanceM: null, averageGrade: null, startLat: 51.9, startLng: -0.5, endLat: null, endLng: null });
    await repo.upsertSegmentStub({ id: 2, name: 'Near', distanceM: null, averageGrade: null, startLat: 51.501, startLng: -0.101, endLat: null, endLng: null });

    const client = new FakeStravaClient(
      new Map([
        [1, detailFixture({ id: 1 })],
        [2, detailFixture({ id: 2 })],
      ]),
    ) as unknown as StravaReadClient;

    const count = await enrichSegments(client, repo, { lat: 51.5, lng: -0.1 }, 14, 0.5);
    expect(count).toBe(2);
    expect((client as unknown as FakeStravaClient).calls).toEqual([2, 1]);

    const enriched = await repo.getSegment(2);
    expect(enriched?.polyline).toBe('abc');
    expect(enriched?.kom_seconds).toBe(306);
    expect(enriched?.pr_seconds).toBe(310);
    expect(enriched?.pr_activity_id).toBe(999);
    expect(enriched?.detail_fetched_at).not.toBeNull();
  });

  it('re-queues segments whose KOM has gone stale, without re-enriching fresh geometry', async () => {
    await repo.upsertSegmentStub({ id: 1, name: 'S', distanceM: null, averageGrade: null, startLat: 51.5, startLng: -0.1, endLat: null, endLng: null });
    const client = new FakeStravaClient(new Map([[1, detailFixture({ id: 1 })]])) as unknown as StravaReadClient;
    await enrichSegments(client, repo, { lat: 51.5, lng: -0.1 }, 14, 0.5);

    // Force the stored KOM to look stale.
    db.prepare(`UPDATE segments SET kom_fetched_at = datetime('now', '-30 days') WHERE id = 1`).run();

    const updatedClient = new FakeStravaClient(
      new Map([[1, detailFixture({ id: 1, xoms: { kom: '5:00' } })]]),
    ) as unknown as StravaReadClient;
    const count = await enrichSegments(updatedClient, repo, { lat: 51.5, lng: -0.1 }, 14, 0.5);

    expect(count).toBe(1);
    expect((await repo.getSegment(1))?.kom_seconds).toBe(300);
  });
});
