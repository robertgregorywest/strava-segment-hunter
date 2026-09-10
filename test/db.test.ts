import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/db/index.js';
import { SyncState } from '../src/db/syncState.js';

describe('database', () => {
  let dir: string;
  let db: DB;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'segment-hunter-db-'));
    db = openDatabase(join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the expected tables via migration', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    for (const expected of ['activities', 'segments', 'segment_efforts', 'sync_state', 'rate_limit_state']) {
      expect(tables).toContain(expected);
    }
  });

  it('is idempotent across repeated opens', () => {
    db.close();
    // Re-opening the same file should not error or re-apply migrations.
    const reopened = openDatabase(join(dir, 'test.db'));
    const count = reopened.prepare('SELECT COUNT(*) as c FROM _migrations').get() as { c: number };
    expect(count.c).toBeGreaterThan(0);
    reopened.close();
  });

  it('keeps the segment_rtree index in sync via triggers', () => {
    db.prepare(
      `INSERT INTO segments (id, start_lat, start_lng) VALUES (1, 51.5, -0.1)`,
    ).run();

    const hit = db
      .prepare(
        `SELECT id FROM segment_rtree WHERE min_lat >= ? AND max_lat <= ? AND min_lng >= ? AND max_lng <= ?`,
      )
      .all(51.0, 52.0, -0.5, 0.5);
    expect(hit).toHaveLength(1);

    db.prepare('UPDATE segments SET start_lat = 60.0 WHERE id = 1').run();
    const missed = db
      .prepare(
        `SELECT id FROM segment_rtree WHERE min_lat >= ? AND max_lat <= ? AND min_lng >= ? AND max_lng <= ?`,
      )
      .all(51.0, 52.0, -0.5, 0.5);
    expect(missed).toHaveLength(0);

    db.prepare('DELETE FROM segments WHERE id = 1').run();
    const afterDelete = db.prepare('SELECT COUNT(*) as c FROM segment_rtree').get() as { c: number };
    expect(afterDelete.c).toBe(0);
  });

  it('stores and retrieves sync state', () => {
    const state = new SyncState(db);
    expect(state.get('missing')).toBeUndefined();
    state.set('cursor', '42');
    expect(state.get('cursor')).toBe('42');
    state.setBoolean('backfill_complete', true);
    expect(state.getBoolean('backfill_complete')).toBe(true);
  });
});
