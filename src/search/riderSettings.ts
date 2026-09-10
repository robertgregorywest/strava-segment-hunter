import type { RiderParams } from '../wind/projection.js';

/** Holds the rider parameters currently in effect, editable at runtime without restarting the process. */
export class RiderSettingsStore {
  private current: RiderParams;

  constructor(initial: RiderParams) {
    this.current = { ...initial };
  }

  get(): RiderParams {
    return this.current;
  }

  set(params: RiderParams): void {
    this.current = { ...params };
  }
}
