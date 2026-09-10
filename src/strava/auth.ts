import type { Config } from '../config/index.js';
import { TokenStore, type StoredTokens } from './tokenStore.js';

export const REQUIRED_SCOPES = ['read', 'read_all', 'activity:read_all'] as const;

const TOKEN_URL = 'https://www.strava.com/oauth/token';
/** Refresh proactively once the access token is within this many seconds of expiry. */
const EXPIRY_MARGIN_SECONDS = 300;

export class ReauthorizationRequiredError extends Error {
  constructor(cause?: unknown) {
    super(
      'Strava rejected the refresh token — re-authorization is required. Run `npm run auth` again.',
    );
    this.name = 'ReauthorizationRequiredError';
    this.cause = cause;
  }
}

export class NotAuthorizedError extends Error {
  constructor() {
    super('No Strava tokens found. Run `npm run auth` to authorize this app first.');
    this.name = 'NotAuthorizedError';
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/** Which scopes from REQUIRED_SCOPES are missing from a granted scope list. */
export function missingScopes(granted: readonly string[]): string[] {
  return REQUIRED_SCOPES.filter((s) => !granted.includes(s));
}

/** Human-readable description of what a missing scope disables, for startup reporting. */
export function describeCapabilityLoss(scope: string): string {
  switch (scope) {
    case 'activity:read_all':
      return 'full activity history backfill (private activities will be invisible)';
    case 'read_all':
      return 'private segment and profile detail';
    case 'read':
      return 'basic athlete and segment access';
    default:
      return scope;
  }
}

export class AuthManager {
  private readonly store: TokenStore;

  constructor(private readonly config: Config) {
    this.store = new TokenStore(config.strava.tokenPath);
  }

  currentTokens(): StoredTokens | undefined {
    return this.store.read();
  }

  saveTokens(tokens: StoredTokens): void {
    this.store.write(tokens);
  }

  /** Returns a valid access token, refreshing it first if it's near expiry. */
  async getValidAccessToken(): Promise<string> {
    const tokens = this.store.read();
    if (!tokens) throw new NotAuthorizedError();

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (tokens.expiresAt - nowSeconds > EXPIRY_MARGIN_SECONDS) {
      return tokens.accessToken;
    }

    return this.refresh(tokens);
  }

  private async refresh(tokens: StoredTokens): Promise<string> {
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.config.strava.clientId,
          client_secret: this.config.strava.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        }),
      });
    } catch (err) {
      throw new ReauthorizationRequiredError(err);
    }

    if (response.status === 400 || response.status === 401) {
      throw new ReauthorizationRequiredError(await response.text().catch(() => undefined));
    }
    if (!response.ok) {
      throw new Error(`Strava token refresh failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as TokenResponse;
    const updated: StoredTokens = {
      accessToken: body.access_token,
      // Strava may or may not rotate the refresh token; keep the new one if given.
      refreshToken: body.refresh_token ?? tokens.refreshToken,
      expiresAt: body.expires_at,
      scope: tokens.scope,
    };
    this.store.write(updated);
    return updated.accessToken;
  }
}
