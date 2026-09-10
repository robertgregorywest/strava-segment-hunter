import type { DB } from '../db/index.js';
import type { RateLimitStateRow } from '../db/types.js';
import { log } from '../log.js';

export class DailyQuotaExhaustedError extends Error {
  constructor() {
    super('Strava daily read quota exhausted; suspending until it rolls over at midnight UTC.');
    this.name = 'DailyQuotaExhaustedError';
  }
}

interface Deps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: Deps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * Keeps every Strava read call inside the advertised 15-minute and daily
 * limits, using the limits Strava itself reports on each response rather
 * than a hard-coded default. All Strava HTTP calls must go through
 * `run()` — see StravaClient, which is the only caller.
 */
export class RateLimitBudgeter {
  private readonly deps: Deps;

  constructor(
    private readonly db: DB,
    private readonly pauseFraction: number,
    deps?: Partial<Deps>,
  ) {
    this.deps = { ...defaultDeps, ...deps };
  }

  /** Runs one Strava request, pausing/retrying as the budget requires. */
  async run(fetchOnce: () => Promise<Response>): Promise<Response> {
    await this.waitForBudget();

    let backoffMs = 1000;
    const maxBackoffMs = 5 * 60_000;

    for (;;) {
      const response = await fetchOnce();
      this.recordHeaders(response.headers);

      if (response.status !== 429) {
        return response;
      }

      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterMs = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) * 1000 : NaN;
      const waitMs = Number.isFinite(retryAfterMs) ? retryAfterMs : backoffMs;

      log(`Received 429 from Strava; pausing ${Math.round(waitMs / 1000)}s before retrying.`);
      await this.deps.sleep(waitMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }

  private recordHeaders(headers: Headers): void {
    const limitHeader = headers.get('X-ReadRateLimit-Limit');
    const usageHeader = headers.get('X-ReadRateLimit-Usage');
    if (!limitHeader || !usageHeader) return;

    const [shortLimit, dailyLimit] = limitHeader.split(',').map((v) => Number.parseInt(v.trim(), 10));
    const [shortUsage, dailyUsage] = usageHeader.split(',').map((v) => Number.parseInt(v.trim(), 10));
    const observedAt = new Date(this.deps.now()).toISOString();

    if (shortLimit !== undefined && shortUsage !== undefined) {
      this.upsert('short', shortLimit, shortUsage, observedAt);
    }
    if (dailyLimit !== undefined && dailyUsage !== undefined) {
      this.upsert('daily', dailyLimit, dailyUsage, observedAt);
    }
  }

  private upsert(window: 'short' | 'daily', limit: number, usage: number, observedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO rate_limit_state (window, limit_value, usage_value, observed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(window) DO UPDATE SET
           limit_value = excluded.limit_value,
           usage_value = excluded.usage_value,
           observed_at = excluded.observed_at`,
      )
      .run(window, limit, usage, observedAt);
  }

  private getState(window: 'short' | 'daily'): RateLimitStateRow | undefined {
    return this.db.prepare('SELECT * FROM rate_limit_state WHERE window = ?').get(window) as
      | RateLimitStateRow
      | undefined;
  }

  /** Pauses (or throws, for the daily window) if the last-observed usage is within budget limits. */
  private async waitForBudget(): Promise<void> {
    const daily = this.getState('daily');
    if (daily && daily.usage_value >= daily.limit_value) {
      throw new DailyQuotaExhaustedError();
    }

    const short = this.getState('short');
    if (short && short.usage_value >= short.limit_value * this.pauseFraction) {
      const waitMs = this.msUntilNextShortWindow();
      log(
        `Short-window read budget at ${short.usage_value}/${short.limit_value}; pausing ${Math.round(waitMs / 1000)}s until the next 15-minute window.`,
      );
      await this.deps.sleep(waitMs);
    }
  }

  private msUntilNextShortWindow(): number {
    const now = new Date(this.deps.now());
    const minutes = now.getUTCMinutes();
    const nextQuarter = Math.ceil((minutes + 1) / 15) * 15;
    const target = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0),
    );
    target.setUTCMinutes(nextQuarter);
    return Math.max(0, target.getTime() - now.getTime());
  }
}
