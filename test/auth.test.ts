import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthManager, NotAuthorizedError, ReauthorizationRequiredError, missingScopes, type StravaCredentials } from '../src/strava/auth.js';
import { FileTokenStore } from '../src/strava/tokenStore.js';

const CREDENTIALS: StravaCredentials = { clientId: 'client-id', clientSecret: 'client-secret' };

describe('missingScopes', () => {
  it('reports scopes absent from the granted list', () => {
    expect(missingScopes(['read', 'read_all'])).toEqual(['activity:read_all']);
    expect(missingScopes(['read', 'read_all', 'activity:read_all'])).toEqual([]);
  });
});

describe('AuthManager', () => {
  let dir: string;
  let tokenPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'segment-hunter-auth-'));
    tokenPath = join(dir, 'tokens.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('throws NotAuthorizedError when no tokens are stored', async () => {
    const manager = new AuthManager(CREDENTIALS, new FileTokenStore(tokenPath));
    await expect(manager.getValidAccessToken()).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('returns the cached token when far from expiry', async () => {
    const store = new FileTokenStore(tokenPath);
    await store.write({
      accessToken: 'valid-token',
      refreshToken: 'refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      scope: ['read', 'read_all', 'activity:read_all'],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const manager = new AuthManager(CREDENTIALS, store);
    const token = await manager.getValidAccessToken();

    expect(token).toBe('valid-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes and persists a rotated refresh token when near expiry', async () => {
    const store = new FileTokenStore(tokenPath);
    await store.write({
      accessToken: 'stale-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 10,
      scope: ['read', 'read_all', 'activity:read_all'],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: 'fresh-token',
            refresh_token: 'new-refresh-token',
            expires_at: Math.floor(Date.now() / 1000) + 21600,
          }),
          { status: 200 },
        ),
      ),
    );

    const manager = new AuthManager(CREDENTIALS, store);
    const token = await manager.getValidAccessToken();

    expect(token).toBe('fresh-token');
    expect((await store.read())?.refreshToken).toBe('new-refresh-token');
  });

  it('raises ReauthorizationRequiredError when Strava rejects the refresh token', async () => {
    const store = new FileTokenStore(tokenPath);
    await store.write({
      accessToken: 'stale-token',
      refreshToken: 'bad-refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) - 10,
      scope: ['read', 'read_all', 'activity:read_all'],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid_grant', { status: 400 })));

    const manager = new AuthManager(CREDENTIALS, store);
    await expect(manager.getValidAccessToken()).rejects.toBeInstanceOf(ReauthorizationRequiredError);
  });
});
