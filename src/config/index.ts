import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return value;
}

export interface RiderParams {
  /** Rider + bike mass in kg. */
  massKg: number;
  /** Drag area (Cd * A) in m^2. */
  cdA: number;
  /** Coefficient of rolling resistance. */
  crr: number;
  /** Multiplier applied to 10m wind speed to approximate wind at rider height. */
  roughnessFactor: number;
}

export interface Config {
  strava: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    tokenPath: string;
  };
  home: {
    lat: number;
    lng: number;
  };
  rider: RiderParams;
  db: {
    path: string;
  };
  api: {
    port: number;
  };
  sync: {
    /** Fraction of the 15-minute quota window at which the budgeter pauses. */
    shortWindowPauseFraction: number;
    /** Per-request timeout before a Strava call is aborted and retried. */
    requestTimeoutMs: number;
    /** How many times a network-level failure (not a 429) is retried before giving up on that call. */
    maxNetworkRetries: number;
  };
  segment: {
    /** Days a stored KOM time is trusted before re-enrichment is queued. */
    komFreshnessDays: number;
    /** Directionality below this value is treated as wind-neutral. */
    windNeutralThreshold: number;
  };
  weather: {
    /** Minutes a cached forecast response is served before refetching. */
    forecastCacheMinutes: number;
  };
}

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;

  cached = {
    strava: {
      clientId: requireEnv('STRAVA_CLIENT_ID'),
      clientSecret: requireEnv('STRAVA_CLIENT_SECRET'),
      redirectUri: process.env['STRAVA_REDIRECT_URI'] ?? 'http://localhost:8721/callback',
      tokenPath: process.env['STRAVA_TOKEN_PATH'] ?? 'data/strava-tokens.json',
    },
    home: {
      lat: optionalFloat('HOME_LAT', 0),
      lng: optionalFloat('HOME_LNG', 0),
    },
    rider: {
      massKg: optionalFloat('RIDER_MASS_KG', 78),
      cdA: optionalFloat('RIDER_CDA', 0.32),
      crr: optionalFloat('RIDER_CRR', 0.005),
      roughnessFactor: optionalFloat('WIND_ROUGHNESS_FACTOR', 0.55),
    },
    db: {
      path: process.env['DB_PATH'] ?? 'data/segment-hunter.db',
    },
    api: {
      port: optionalInt('API_PORT', 3000),
    },
    sync: {
      shortWindowPauseFraction: optionalFloat('SYNC_SHORT_WINDOW_PAUSE_FRACTION', 0.9),
      requestTimeoutMs: optionalInt('SYNC_REQUEST_TIMEOUT_MS', 30_000),
      maxNetworkRetries: optionalInt('SYNC_MAX_NETWORK_RETRIES', 5),
    },
    segment: {
      komFreshnessDays: optionalInt('KOM_FRESHNESS_DAYS', 14),
      windNeutralThreshold: optionalFloat('WIND_NEUTRAL_THRESHOLD', 0.5),
    },
    weather: {
      forecastCacheMinutes: optionalInt('FORECAST_CACHE_MINUTES', 60),
    },
  };

  return cached;
}

/** For tests: clear the cached config so the next loadConfig() re-reads process.env. */
export function resetConfigCache(): void {
  cached = undefined;
}
