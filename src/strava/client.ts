import { describeError, log, logError } from '../log.js';
import type { AuthManager } from './auth.js';
import type { RateLimitBudgeter } from './rateLimiter.js';
import type {
  StravaActivitySummary,
  StravaDetailedActivity,
  StravaDetailedSegment,
  StravaSummarySegment,
} from './types.js';

const API_BASE = 'https://www.strava.com/api/v3';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_NETWORK_RETRIES = 5;
const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The subset of StravaClient that sync code depends on — narrows what test doubles need to implement. */
export interface StravaReadClient {
  listActivities(page: number, perPage?: number, after?: number): Promise<StravaActivitySummary[]>;
  getActivity(id: number): Promise<StravaDetailedActivity>;
  getSegment(id: number): Promise<StravaDetailedSegment>;
  listStarredSegments(page: number, perPage?: number): Promise<StravaSummarySegment[]>;
}

export class StravaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Strava API error: HTTP ${status} ${body}`);
    this.name = 'StravaApiError';
  }
}

/**
 * The only place raw Strava HTTP calls are made. Every method routes
 * through the RateLimitBudgeter, so no code path can bypass quota control.
 */
export class StravaClient implements StravaReadClient {
  private readonly requestTimeoutMs: number;
  private readonly maxNetworkRetries: number;

  constructor(
    private readonly auth: AuthManager,
    private readonly budgeter: RateLimitBudgeter,
    options: { requestTimeoutMs?: number; maxNetworkRetries?: number } = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxNetworkRetries = options.maxNetworkRetries ?? DEFAULT_MAX_NETWORK_RETRIES;
  }

  async listActivities(page: number, perPage = 200, after?: number): Promise<StravaActivitySummary[]> {
    const url = new URL(`${API_BASE}/athlete/activities`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    if (after !== undefined) url.searchParams.set('after', String(after));
    return this.getJson<StravaActivitySummary[]>(url);
  }

  async getActivity(id: number): Promise<StravaDetailedActivity> {
    const url = new URL(`${API_BASE}/activities/${id}`);
    url.searchParams.set('include_all_efforts', 'true');
    return this.getJson<StravaDetailedActivity>(url);
  }

  async getSegment(id: number): Promise<StravaDetailedSegment> {
    return this.getJson<StravaDetailedSegment>(new URL(`${API_BASE}/segments/${id}`));
  }

  async listStarredSegments(page: number, perPage = 200): Promise<StravaSummarySegment[]> {
    const url = new URL(`${API_BASE}/segments/starred`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    return this.getJson<StravaSummarySegment[]>(url);
  }

  private async getJson<T>(url: URL): Promise<T> {
    const response = await this.budgeter.run(() => this.fetchWithRetry(url));

    if (!response.ok) {
      throw new StravaApiError(response.status, await response.text().catch(() => ''));
    }

    return (await response.json()) as T;
  }

  /**
   * Retries transient network failures (stalled connections, DNS blips,
   * TLS resets) with backoff. Each attempt is bounded by requestTimeoutMs so
   * a stalled request fails fast instead of hanging on undici's own
   * multi-minute default — the original motivation being a HeadersTimeoutError
   * after 300s that otherwise crashed the whole backfill.
   */
  private async fetchWithRetry(url: URL): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      const startedAt = Date.now();
      try {
        const accessToken = await this.auth.getValidAccessToken();
        return await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
      } catch (err) {
        const elapsedMs = Date.now() - startedAt;
        if (attempt >= this.maxNetworkRetries) {
          logError(
            `${url.pathname}: giving up after ${attempt} attempts (last try ${elapsedMs}ms) — ${describeError(err)}`,
          );
          throw err;
        }
        const backoffMs = Math.min(INITIAL_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
        log(
          `${url.pathname}: attempt ${attempt}/${this.maxNetworkRetries} failed after ${elapsedMs}ms (${describeError(err)}); retrying in ${Math.round(backoffMs / 1000)}s`,
        );
        await sleep(backoffMs);
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
