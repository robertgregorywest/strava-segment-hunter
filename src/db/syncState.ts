import type { SqlBackend } from './backend.js';

/** Thin key/value accessor over sync_state, used for backfill cursors and sync bookkeeping. */
export class SyncState {
  constructor(private readonly db: SqlBackend) {}

  async get(key: string): Promise<string | undefined> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key]);
    return row?.value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value],
    );
  }

  async getBoolean(key: string): Promise<boolean> {
    return (await this.get(key)) === 'true';
  }

  async setBoolean(key: string, value: boolean): Promise<void> {
    await this.set(key, value ? 'true' : 'false');
  }
}
