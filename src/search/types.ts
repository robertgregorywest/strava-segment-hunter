import type { RiderParams } from '../wind/projection.js';

/**
 * The slice of app config (`src/config/index.ts`) that
 * `SearchService`/`SegmentDetailService` need. Structural, so tests can pass
 * just this slice rather than a full `Config`.
 */
export interface SearchConfig {
  home: { lat: number; lng: number };
  rider: RiderParams;
  segment: { komFreshnessDays: number };
}
