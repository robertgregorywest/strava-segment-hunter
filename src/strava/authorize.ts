import { createServer } from 'node:http';
import { loadConfig } from '../config/index.js';
import { describeCapabilityLoss, missingScopes } from './auth.js';
import { TokenStore } from './tokenStore.js';

const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const redirect = new URL(config.strava.redirectUri);
  const port = Number.parseInt(redirect.port || '80', 10);

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', config.strava.clientId);
  authorizeUrl.searchParams.set('redirect_uri', config.strava.redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('approval_prompt', 'auto');
  authorizeUrl.searchParams.set('scope', 'read,read_all,activity:read_all');

  console.log('Open this URL to authorize Strava access:\n');
  console.log(`  ${authorizeUrl.toString()}\n`);
  console.log(`Waiting for the callback on ${config.strava.redirectUri} ...`);

  const { code, scope } = await waitForCallback(port, redirect.pathname);

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.strava.clientId,
      client_secret: config.strava.clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: HTTP ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as TokenResponse;
  const grantedScopes = scope.split(',').map((s) => s.trim()).filter(Boolean);

  const store = new TokenStore(config.strava.tokenPath);
  store.write({
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at,
    scope: grantedScopes,
  });

  console.log(`\nTokens saved to ${config.strava.tokenPath}`);

  const missing = missingScopes(grantedScopes);
  if (missing.length > 0) {
    console.warn('\nAuthorization succeeded, but the following scopes were NOT granted:');
    for (const scopeName of missing) {
      console.warn(`  - ${scopeName}: disables ${describeCapabilityLoss(scopeName)}`);
    }
    console.warn('\nA backfill will not start until all required scopes are granted.');
    process.exitCode = 1;
  } else {
    console.log('All required scopes granted.');
  }
}

function waitForCallback(port: number, path: string): Promise<{ code: string; scope: string }> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname !== path) {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Authorization denied. You can close this tab.');
        server.close();
        reject(new Error(`Strava authorization was denied: ${error}`));
        return;
      }

      const code = url.searchParams.get('code');
      const scope = url.searchParams.get('scope') ?? '';
      if (!code) {
        res.writeHead(400).end('Missing code');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Authorized. You can close this tab.');
      server.close();
      resolvePromise({ code, scope });
    });

    server.listen(port);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
