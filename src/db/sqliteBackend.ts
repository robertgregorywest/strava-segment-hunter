import type Database from 'better-sqlite3';
import type { SqlBackend, SqlRunResult, SqlStatement, SqlValue } from './backend.js';

/**
 * better-sqlite3, which is synchronous under the hood — wrapped in async
 * methods to satisfy the `SqlBackend` interface.
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
