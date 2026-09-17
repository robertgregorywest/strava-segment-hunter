import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalBackend, type DB } from '../src/db/index.js';
import type { SqlBackend } from '../src/db/backend.js';
import { DailyQuotaExhaustedError, RateLimitBudgeter } from '../src/strava/rateLimiter.js';

function headersResponse(status: number, shortUsage: number, shortLimit: number, dailyUsage: number, dailyLimit: number, extra?: HeadersInit) {
  return new Response('{}', {
    status,
    headers: {
      'X-ReadRateLimit-Limit': `${shortLimit},${dailyLimit}`,
      'X-ReadRateLimit-Usage': `${shortUsage},${dailyUsage}`,
      ...extra,
    },
  });
}

describe('RateLimitBudgeter', () => {
  let dir: string;
  let db: DB;
  let backend: SqlBackend;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'segment-hunter-rl-'));
    const opened = openLocalBackend(join(dir, 'test.db'));
    db = opened.db;
    backend = opened.backend;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('records limit/usage from response headers as authoritative', async () => {
    const budgeter = new RateLimitBudgeter(backend, 0.9);
    await budgeter.run(async () => headersResponse(200, 10, 200, 100, 2000));

    const short = db.prepare("SELECT * FROM rate_limit_state WHERE window = 'short'").get() as
      | { limit_value: number; usage_value: number }
      | undefined;
    expect(short).toEqual(expect.objectContaining({ limit_value: 200, usage_value: 10 }));
  });

  it('pauses until window rollover when short-window usage reaches the pause fraction', async () => {
    // Seed state at 90% of the short window, observed just after a quarter-hour boundary.
    db.prepare(
      `INSERT INTO rate_limit_state (window, limit_value, usage_value, observed_at) VALUES ('short', 200, 180, datetime('now'))`,
    ).run();

    const fixedNow = Date.UTC(2026, 0, 1, 10, 5, 0); // 10:05:00 UTC -> next boundary 10:15:00
    const sleep = vi.fn(async () => {});
    const budgeter = new RateLimitBudgeter(backend, 0.9, { sleep, now: () => fixedNow });

    await budgeter.run(async () => headersResponse(200, 181, 200, 100, 2000));

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10 * 60_000); // 10 minutes to 10:15
  });

  it('throws DailyQuotaExhaustedError without making a request when the daily limit is already reached', async () => {
    db.prepare(
      `INSERT INTO rate_limit_state (window, limit_value, usage_value, observed_at) VALUES ('daily', 2000, 2000, datetime('now'))`,
    ).run();

    const fetchOnce = vi.fn();
    const budgeter = new RateLimitBudgeter(backend, 0.9);

    await expect(budgeter.run(fetchOnce)).rejects.toBeInstanceOf(DailyQuotaExhaustedError);
    expect(fetchOnce).not.toHaveBeenCalled();
  });

  it('does not throw when the exhausted daily reading is from a prior UTC day', async () => {
    db.prepare(
      `INSERT INTO rate_limit_state (window, limit_value, usage_value, observed_at) VALUES ('daily', 2000, 2000, '2026-09-11T06:53:23.505Z')`,
    ).run();

    const fixedNow = Date.UTC(2026, 8, 12, 7, 31, 0); // 2026-09-12, a day after the reading above
    const fetchOnce = vi.fn(async () => headersResponse(200, 1, 200, 1, 2000));
    const budgeter = new RateLimitBudgeter(backend, 0.9, { now: () => fixedNow });

    await expect(budgeter.run(fetchOnce)).resolves.toBeInstanceOf(Response);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff on 429 and does not give up', async () => {
    const sleep = vi.fn(async () => {});
    const budgeter = new RateLimitBudgeter(backend, 0.9, { sleep });

    let calls = 0;
    const response = await budgeter.run(async () => {
      calls += 1;
      if (calls < 3) return headersResponse(429, 5, 200, 5, 2000);
      return headersResponse(200, 6, 200, 6, 2000);
    });

    expect(response.status).toBe(200);
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After on 429 when present', async () => {
    const sleep = vi.fn(async () => {});
    const budgeter = new RateLimitBudgeter(backend, 0.9, { sleep });

    let calls = 0;
    await budgeter.run(async () => {
      calls += 1;
      if (calls === 1) return headersResponse(429, 5, 200, 5, 2000, { 'Retry-After': '7' });
      return headersResponse(200, 6, 200, 6, 2000);
    });

    expect(sleep).toHaveBeenCalledWith(7000);
  });
});
