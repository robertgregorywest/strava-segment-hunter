import type { SqlBackend, SqlRunResult, SqlStatement, SqlValue } from './backend.js';

/**
 * D1 over its HTTP API — the backend the sync script (a plain Node process,
 * run locally or from GitHub Actions) uses to reach production, since it has
 * no Worker binding. Ported from cycling-reader's `ingest/store/d1.ts`.
 */
export class D1HttpBackend implements SqlBackend {
  constructor(
    private readonly credentials: D1HttpCredentials,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): D1HttpBackend {
    return new D1HttpBackend({
      accountId: required(environment, 'CLOUDFLARE_ACCOUNT_ID'),
      databaseId: required(environment, 'D1_DATABASE_ID'),
      apiToken: required(environment, 'CLOUDFLARE_API_TOKEN'),
    });
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<SqlRunResult> {
    const [result] = await this.query([{ sql, params }]);
    return { changes: result?.changes ?? 0 };
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    const [result] = await this.query<T>([{ sql, params }]);
    return (result?.rows ?? []) as T[];
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    const [result] = await this.query<T>([{ sql, params }]);
    return result?.rows[0];
  }

  async batch(statements: readonly SqlStatement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.query(statements);
  }

  private async query<T>(statements: readonly SqlStatement[]): Promise<readonly D1HttpResult<T>[]> {
    const { accountId, databaseId, apiToken } = this.credentials;
    const response = await this.fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          batch: statements.map((s) => ({ sql: s.sql, params: s.params })),
        }),
      },
    );

    const body = (await response.json().catch(() => null)) as D1HttpResponseBody<T> | null;

    if (!response.ok || body === null || body.success !== true) {
      throw new Error(`D1 refused the request: ${describeFailure(response.status, body)}`);
    }

    return body.result.map((result) => ({
      rows: result.results ?? [],
      changes: result.meta?.changes ?? 0,
    }));
  }
}

export interface D1HttpCredentials {
  readonly accountId: string;
  readonly databaseId: string;
  readonly apiToken: string;
}

interface D1HttpResult<T> {
  readonly rows: readonly T[];
  readonly changes: number;
}

interface D1HttpResponseBody<T> {
  readonly success: boolean;
  readonly errors?: readonly { readonly code?: number; readonly message?: string }[];
  readonly result: readonly {
    readonly results?: readonly T[];
    readonly meta?: { readonly changes?: number };
  }[];
}

function describeFailure(status: number, body: D1HttpResponseBody<unknown> | null): string {
  const errors = body?.errors ?? [];
  if (errors.length === 0) return `HTTP ${status}`;
  return errors.map((e) => `${e.message ?? 'unknown'} (${e.code ?? status})`).join('; ');
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
