import type { SyncState } from '../db/syncState.js';
import type { RiderParams } from '../wind/projection.js';

const STATE_KEY = 'rider_settings';

/**
 * Holds the rider parameters currently in effect, editable at runtime
 * without redeploying. Persisted to `sync_state` (rather than kept only in
 * memory) because a Worker isolate can be evicted at any time — an
 * in-memory-only store would silently reset a rider's tuned settings.
 */
export class RiderSettingsStore {
  constructor(
    private readonly state: SyncState,
    private readonly defaults: RiderParams,
  ) {}

  async get(): Promise<RiderParams> {
    const raw = await this.state.get(STATE_KEY);
    if (!raw) return this.defaults;
    try {
      return { ...this.defaults, ...(JSON.parse(raw) as Partial<RiderParams>) };
    } catch {
      return this.defaults;
    }
  }

  async set(params: RiderParams): Promise<void> {
    await this.state.set(STATE_KEY, JSON.stringify(params));
  }
}
