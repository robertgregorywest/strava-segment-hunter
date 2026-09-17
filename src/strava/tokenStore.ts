import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SqlBackend } from '../db/backend.js';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
  /** Scopes granted at the most recent authorization. */
  scope: string[];
}

export interface TokenStore {
  read(): Promise<StoredTokens | undefined>;
  write(tokens: StoredTokens): Promise<void>;
}

/** Persists OAuth tokens to a JSON file outside version control (see .gitignore's `*token*`). Local dev only. */
export class FileTokenStore implements TokenStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  async read(): Promise<StoredTokens | undefined> {
    if (!existsSync(this.path)) return undefined;
    const raw = readFileSync(this.path, 'utf8');
    return JSON.parse(raw) as StoredTokens;
  }

  async write(tokens: StoredTokens): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }
}

interface OAuthTokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

/**
 * Persists OAuth tokens to the `oauth_tokens` table (single row, id=1).
 * Used wherever there's no local filesystem to trust across runs: the
 * GitHub Actions sync workflow, and the Worker if it ever needs a token.
 */
export class D1TokenStore implements TokenStore {
  constructor(private readonly db: SqlBackend) {}

  async read(): Promise<StoredTokens | undefined> {
    const row = await this.db.get<OAuthTokenRow>('SELECT * FROM oauth_tokens WHERE id = 1');
    if (!row) return undefined;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
      scope: row.scope.split(',').filter(Boolean),
    };
  }

  async write(tokens: StoredTokens): Promise<void> {
    await this.db.run(
      `INSERT INTO oauth_tokens (id, access_token, refresh_token, expires_at, scope, updated_at)
       VALUES (1, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = excluded.updated_at`,
      [tokens.accessToken, tokens.refreshToken, tokens.expiresAt, tokens.scope.join(',')],
    );
  }
}
