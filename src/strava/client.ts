import type { AuthManager } from './auth.js';
import type { RateLimitBudgeter } from './rateLimiter.js';
import type {
  StravaActivitySummary,
  StravaDetailedActivity,
  StravaDetailedSegment,
  StravaSummarySegment,
} from './types.js';

const API_BASE = 'https://www.strava.com/api/v3';

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
  constructor(
    private readonly auth: AuthManager,
    private readonly budgeter: RateLimitBudgeter,
  ) {}

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
    const response = await this.budgeter.run(async () => {
      const accessToken = await this.auth.getValidAccessToken();
      return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    });

    if (!response.ok) {
      throw new StravaApiError(response.status, await response.text().catch(() => ''));
    }

    return (await response.json()) as T;
  }
}
