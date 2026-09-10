import type { DB } from './index.js';

/** Thin key/value accessor over sync_state, used for backfill cursors and sync bookkeeping. */
export class SyncState {
  constructor(private readonly db: DB) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value);
  }

  getBoolean(key: string): boolean {
    return this.get(key) === 'true';
  }

  setBoolean(key: string, value: boolean): void {
    this.set(key, value ? 'true' : 'false');
  }
}
