import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
  /** Scopes granted at the most recent authorization. */
  scope: string[];
}

/** Persists OAuth tokens to a JSON file outside version control (see .gitignore's `*token*`). */
export class TokenStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  read(): StoredTokens | undefined {
    if (!existsSync(this.path)) return undefined;
    const raw = readFileSync(this.path, 'utf8');
    return JSON.parse(raw) as StoredTokens;
  }

  write(tokens: StoredTokens): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }
}
