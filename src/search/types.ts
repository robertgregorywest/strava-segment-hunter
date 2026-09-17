import type { RiderParams } from '../wind/projection.js';

/**
 * The slice of app config `SearchService`/`SegmentDetailService` need.
 * Structural, not `Config` itself, so both the CLI's `Config`
 * (`src/config/index.ts`) and the Worker's `WorkerConfig`
 * (`src/worker/env.ts`) satisfy it without either importing the other.
 */
export interface SearchConfig {
  home: { lat: number; lng: number };
  rider: RiderParams;
  segment: { komFreshnessDays: number };
}
