import type { SqlBackend, SqlRunResult, SqlStatement, SqlValue } from '../db/backend.js';

/**
 * Production backend inside the Worker: D1's native binding (`env.DB`).
 * No HTTP round trip — the binding talks to D1 directly from the runtime.
 */
export class D1WorkerBackend implements SqlBackend {
  constructor(private readonly db: D1Database) {}

  async run(sql: string, params: readonly SqlValue[] = []): Promise<SqlRunResult> {
    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .run();
    return { changes: result.meta?.changes ?? 0 };
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return result.results ?? [];
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    const row = await this.db
      .prepare(sql)
      .bind(...params)
      .first<T>();
    return row ?? undefined;
  }

  async batch(statements: readonly SqlStatement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.db.batch(statements.map(({ sql, params }) => this.db.prepare(sql).bind(...params)));
  }
}
