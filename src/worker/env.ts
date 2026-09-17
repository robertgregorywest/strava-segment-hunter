import type { RiderParams } from '../wind/projection.js';

/** Bindings and vars declared in `wrangler.jsonc`. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** PBKDF2-hashed passphrase (see src/worker/passphrase.ts) gating every request. */
  PASSPHRASE_HASH: string;
  HOME_LAT?: string;
  HOME_LNG?: string;
  RIDER_MASS_KG?: string;
  RIDER_CDA?: string;
  RIDER_CRR?: string;
  WIND_ROUGHNESS_FACTOR?: string;
  KOM_FRESHNESS_DAYS?: string;
  WIND_NEUTRAL_THRESHOLD?: string;
  FORECAST_CACHE_MINUTES?: string;
}

export interface WorkerConfig {
  home: { lat: number; lng: number };
  rider: RiderParams;
  segment: { komFreshnessDays: number; windNeutralThreshold: number };
  weather: { forecastCacheMinutes: number };
}

function float(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * The Worker's equivalent of `src/config/index.ts` — Workers have no
 * `process.env`, so these come from `wrangler.jsonc`'s `vars` (non-secret
 * defaults, same values as the CLI's `.env` defaults) instead.
 */
export function loadWorkerConfig(env: Env): WorkerConfig {
  return {
    home: { lat: float(env.HOME_LAT, 0), lng: float(env.HOME_LNG, 0) },
    rider: {
      massKg: float(env.RIDER_MASS_KG, 78),
      cdA: float(env.RIDER_CDA, 0.32),
      crr: float(env.RIDER_CRR, 0.005),
      roughnessFactor: float(env.WIND_ROUGHNESS_FACTOR, 0.55),
    },
    segment: {
      komFreshnessDays: int(env.KOM_FRESHNESS_DAYS, 14),
      windNeutralThreshold: float(env.WIND_NEUTRAL_THRESHOLD, 0.5),
    },
    weather: { forecastCacheMinutes: int(env.FORECAST_CACHE_MINUTES, 60) },
  };
}
