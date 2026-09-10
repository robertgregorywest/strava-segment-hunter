import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/db/index.js';
import { Repository } from '../src/db/repository.js';
import { SyncState } from '../src/db/syncState.js';
import { listActivities, processUnprocessedActivities } from '../src/sync/backfill.js';
import { incrementalSync } from '../src/sync/incremental.js';
import { ingestStarredSegments } from '../src/sync/starred.js';
import type { StravaReadClient } from '../src/strava/client.js';
import type {
  StravaActivitySummary,
  StravaDetailedActivity,
  StravaDetailedSegment,
  StravaSummarySegment,
} from '../src/strava/types.js';

function makeSegmentSummary(id: number, overrides: Partial<StravaSummarySegment> = {}): StravaSummarySegment {
  return {
    id,
    name: `Segment ${id}`,
    distance: 1000,
    average_grade: 1.0,
    start_latlng: [51.5, -0.1],
    end_latlng: [51.51, -0.09],
    ...overrides,
  };
}

class FakeStravaClient implements StravaReadClient {
  activitiesByPage = new Map<number, StravaActivitySummary[]>();
  activityDetail = new Map<number, StravaDetailedActivity>();
  starredPages = new Map<number, StravaSummarySegment[]>();
  activityCalls: number[] = [];

  async listActivities(page: number, _perPage?: number, _after?: number): Promise<StravaActivitySummary[]> {
    return this.activitiesByPage.get(page) ?? [];
  }

  async getActivity(id: number): Promise<StravaDetailedActivity> {
    this.activityCalls.push(id);
    const detail = this.activityDetail.get(id);
    if (!detail) throw new Error(`no fixture for activity ${id}`);
    return detail;
  }

  async getSegment(): Promise<StravaDetailedSegment> {
    throw new Error('not used in these tests');
  }

  async listStarredSegments(page: number): Promise<StravaSummarySegment[]> {
    return this.starredPages.get(page) ?? [];
  }
}

describe('sync', () => {
  let dir: string;
  let db: DB;
  let repo: Repository;
  let state: SyncState;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'segment-hunter-sync-'));
    db = openDatabase(join(dir, 'test.db'));
    repo = new Repository(db);
    state = new SyncState(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists activities across pages and is idempotent once complete', async () => {
    const client = new FakeStravaClient();
    client.activitiesByPage.set(1, [
      { id: 1, name: 'Ride 1', start_date: '2024-01-01T00:00:00Z' },
      { id: 2, name: 'Ride 2', start_date: '2024-01-02T00:00:00Z' },
    ]);
    client.activitiesByPage.set(2, []);

    const first = await listActivities(client, repo, state);
    expect(first).toBe(2);
    expect(repo.activityCount()).toEqual({ total: 2, processed: 0 });

    const second = await listActivities(client, repo, state);
    expect(second).toBe(0); // already marked complete, no further calls
  });

  it('processes each activity once, deduplicating segments and retaining every effort', async () => {
    const client = new FakeStravaClient();
    client.activitiesByPage.set(1, [
      { id: 1, name: 'Ride 1', start_date: '2024-01-01T00:00:00Z' },
      { id: 2, name: 'Ride 2', start_date: '2024-01-02T00:00:00Z' },
    ]);
    client.activitiesByPage.set(2, []);
    client.activityDetail.set(1, {
      id: 1,
      name: 'Ride 1',
      start_date: '2024-01-01T00:00:00Z',
      segment_efforts: [
        { id: 100, segment: makeSegmentSummary(9), elapsed_time: 300, start_date: '2024-01-01T08:00:00Z', pr_rank: 1, kom_rank: 3 },
      ],
    });
    client.activityDetail.set(2, {
      id: 2,
      name: 'Ride 2',
      start_date: '2024-01-02T00:00:00Z',
      segment_efforts: [
        { id: 101, segment: makeSegmentSummary(9), elapsed_time: 290, start_date: '2024-01-02T08:00:00Z', pr_rank: 1, kom_rank: 2 },
      ],
    });

    await listActivities(client, repo, state);
    const processed = await processUnprocessedActivities(client, repo);
    expect(processed).toBe(2);

    const segment = repo.getSegment(9);
    expect(segment?.has_baseline).toBe(1);
    expect(segment?.best_kom_rank).toBe(2);
    expect(segment?.effort_count).toBe(2);
    expect(repo.effortsForSegment(9)).toHaveLength(2);

    // Re-running processes nothing further — activities are marked processed.
    const secondRun = await processUnprocessedActivities(client, repo);
    expect(secondRun).toBe(0);
    expect(client.activityCalls).toEqual([1, 2]);
  });

  it('resumes an interrupted backfill without repeating processed activities', async () => {
    const client = new FakeStravaClient();
    client.activitiesByPage.set(1, [
      { id: 1, name: 'Ride 1', start_date: '2024-01-01T00:00:00Z' },
      { id: 2, name: 'Ride 2', start_date: '2024-01-02T00:00:00Z' },
    ]);
    client.activitiesByPage.set(2, []);
    client.activityDetail.set(1, { id: 1, name: 'Ride 1', start_date: '2024-01-01T00:00:00Z', segment_efforts: [] });
    client.activityDetail.set(2, { id: 2, name: 'Ride 2', start_date: '2024-01-02T00:00:00Z', segment_efforts: [] });

    await listActivities(client, repo, state);
    repo.markActivityProcessed(1); // simulate activity 1 completed before an interruption

    const resumed = await processUnprocessedActivities(client, repo);
    expect(resumed).toBe(1);
    expect(client.activityCalls).toEqual([2]);
  });

  it('flags a starred segment with no effort as having no baseline', async () => {
    const client = new FakeStravaClient();
    client.starredPages.set(1, [makeSegmentSummary(42)]);
    client.starredPages.set(2, []);

    await ingestStarredSegments(client, repo);

    const segment = repo.getSegment(42);
    expect(segment?.starred).toBe(1);
    expect(segment?.has_baseline).toBe(0);
  });

  it('incremental sync only fetches activities after the most recent known one', async () => {
    db.prepare(
      `INSERT INTO activities (id, name, start_date, processed_at) VALUES (1, 'old', '2024-01-01T00:00:00Z', datetime('now'))`,
    ).run();

    const client = new FakeStravaClient();
    client.activitiesByPage.set(1, [{ id: 2, name: 'New ride', start_date: '2024-02-01T00:00:00Z' }]);
    client.activitiesByPage.set(2, []);
    client.activityDetail.set(2, { id: 2, name: 'New ride', start_date: '2024-02-01T00:00:00Z', segment_efforts: [] });

    let capturedAfter: number | undefined;
    const originalListActivities = client.listActivities.bind(client);
    client.listActivities = async (page, perPage, after) => {
      capturedAfter = after;
      return originalListActivities(page, perPage, after);
    };

    const result = await incrementalSync(client, repo, state);
    expect(result.listed).toBe(1);
    expect(result.processed).toBe(1);
    expect(capturedAfter).toBe(Math.floor(new Date('2024-01-01T00:00:00Z').getTime() / 1000));
  });
});
