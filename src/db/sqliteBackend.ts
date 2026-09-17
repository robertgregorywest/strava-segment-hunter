import type Database from 'better-sqlite3';
import type { SqlBackend, SqlRunResult, SqlStatement, SqlValue } from './backend.js';

/**
 * Local dev/test backend: better-sqlite3, which is synchronous under the
 * hood — wrapped in `Promise.resolve()` so callers are backend-agnostic and
 * exercise the exact code path production (D1) runs.
 */
export class SqliteBackend implements SqlBackend {
  constructor(private readonly db: Database.Database) {}

  async run(sql: string, params: readonly SqlValue[] = []): Promise<SqlRunResult> {
    const result = this.db.prepare(sql).run(...params);
    return { changes: result.changes };
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async batch(statements: readonly SqlStatement[]): Promise<void> {
    const runAll = this.db.transaction((stmts: readonly SqlStatement[]) => {
      for (const { sql, params } of stmts) {
        this.db.prepare(sql).run(...params);
      }
    });
    runAll(statements);
  }
}
