/** A value bindable into a `?` placeholder — SQLite's parameter type. */
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
 * `openMeteoClient.ts`'s caches, `rateLimiter.ts`'s rate_limit_state) and the
 * SQLite database it runs against.
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
