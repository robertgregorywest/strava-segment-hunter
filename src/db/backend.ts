/** A value bindable into a `?` placeholder — SQLite/D1's shared parameter type. */
export type SqlValue = string | number | null;

export interface SqlRunResult {
  /** Rows inserted/updated/deleted. */
  changes: number;
}

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

/**
 * The one seam between all corpus SQL (`src/db/repository.ts`, `syncState.ts`,
 * `openMeteoClient.ts`'s caches, `rateLimiter.ts`'s rate_limit_state) and
 * wherever the database actually lives — a local SQLite file, D1's native
 * Worker binding, or D1's HTTP API from a plain Node process. Every backend
 * implements this same shape so the SQL above it never branches on which one
 * it's talking to.
 */
export interface SqlBackend {
  /** INSERT/UPDATE/DELETE. */
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
  /** SELECT, all matching rows. */
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** SELECT, first matching row (or undefined). */
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  /**
   * Several statements as one transaction. Used where a partial write would
   * leave the corpus inconsistent (e.g. an effort plus the segment stub it
   * references).
   */
  batch(statements: readonly SqlStatement[]): Promise<void>;
}
