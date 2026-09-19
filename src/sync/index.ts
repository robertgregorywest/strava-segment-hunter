import type { SqlBackend } from '../db/backend.js';
import { D1HttpBackend } from '../db/d1HttpBackend.js';
import { openLocalBackend } from '../db/index.js';
import { Repository } from '../db/repository.js';
import { SyncState } from '../db/syncState.js';
import { loadConfig } from '../config/index.js';
import { log, logError } from '../log.js';
import { AuthManager, NotAuthorizedError, ReauthorizationRequiredError, describeCapabilityLoss, missingScopes } from '../strava/auth.js';
import { StravaClient } from '../strava/client.js';
import { DailyQuotaExhaustedError, RateLimitBudgeter } from '../strava/rateLimiter.js';
import { D1TokenStore, FileTokenStore, type TokenStore } from '../strava/tokenStore.js';
import { enrichSegments } from './enrichment.js';
import { listActivities, processUnprocessedActivities } from './backfill.js';
import { incrementalSync } from './incremental.js';
import { OpenMeteoClient } from '../wind/openMeteoClient.js';
import { annotatePrWind } from './prWind.js';
import { ingestStarredSegments } from './starred.js';

/**
 * `--store d1` targets production over D1's HTTP API (used by the GitHub
 * Actions sync workflow); the default targets the local SQLite file (used by
 * `npm run sync` / `npm run sync:backfill` during dev). Both run identical
 * SQL — see `db/repository.ts`.
 */
function openBackend(config: ReturnType<typeof loadConfig>): { backend: SqlBackend; tokenStore: TokenStore; close: () => void } {
  const storeFlagIndex = process.argv.indexOf('--store');
  const useD1 = storeFlagIndex !== -1 && process.argv[storeFlagIndex + 1] === 'd1';

  if (useD1) {
    const backend = D1HttpBackend.fromEnvironment();
    return { backend, tokenStore: new D1TokenStore(backend), close: () => {} };
  }

  const { db, backend } = openLocalBackend(config.db.path);
  return { backend, tokenStore: new FileTokenStore(config.strava.tokenPath), close: () => db.close() };
}

async function main(): Promise<void> {
  const backfillMode = process.argv.includes('--backfill');
  const startedAt = Date.now();

  const config = loadConfig();
  const { backend, tokenStore, close } = openBackend(config);
  const repo = new Repository(backend);
  const state = new SyncState(backend);

  try {
    const auth = new AuthManager({ clientId: config.strava.clientId, clientSecret: config.strava.clientSecret }, tokenStore);
    const tokens = await auth.currentTokens();
    if (!tokens) {
      logError(new NotAuthorizedError().message);
      process.exitCode = 1;
      return;
    }

    const missing = missingScopes(tokens.scope);
    for (const scope of missing) {
      log(`Missing Strava scope "${scope}": ${describeCapabilityLoss(scope)} will be unavailable.`);
    }

    const budgeter = new RateLimitBudgeter(backend, config.sync.shortWindowPauseFraction);
    const client = new StravaClient(auth, budgeter, {
      requestTimeoutMs: config.sync.requestTimeoutMs,
      maxNetworkRetries: config.sync.maxNetworkRetries,
    });

    try {
      log(backfillMode ? 'Starting full backfill…' : 'Starting incremental sync…');

      if (backfillMode) {
        const listed = await listActivities(client, repo, state);
        log(`Listed ${listed} new activities.`);
        const processed = await processUnprocessedActivities(client, repo);
        log(`Processed segment efforts for ${processed} activities.`);
      } else {
        const { listed, processed } = await incrementalSync(client, repo, state);
        log(`Listed ${listed} new activities, processed ${processed}.`);
      }

      const starred = await ingestStarredSegments(client, repo);
      log(`Ingested ${starred} starred segments.`);

      const enriched = await enrichSegments(
        client,
        repo,
        config.home,
        config.segment.komFreshnessDays,
        config.segment.windNeutralThreshold,
      );
      log(`Enriched ${enriched} segments.`);
    } catch (err) {
      // PR wind lookups below need no Strava calls, so a spent quota doesn't stop them.
      if (!(err instanceof DailyQuotaExhaustedError)) throw err;
      log(err.message);
    }

    const weather = new OpenMeteoClient(backend, config.weather.forecastCacheMinutes);
    const prWinds = await annotatePrWind(weather, repo, config.home);
    log(`Stored PR wind for ${prWinds} segments.`);

    const counts = await repo.activityCount();
    const elapsedS = (Date.now() - startedAt) / 1000;
    log(`Corpus: ${counts.processed}/${counts.total} activities processed. Run took ${elapsedS.toFixed(0)}s.`);
  } finally {
    close();
  }
}

main().catch((err: unknown) => {
  if (err instanceof DailyQuotaExhaustedError) {
    log(err.message);
    return;
  }
  if (err instanceof ReauthorizationRequiredError) {
    logError(err.message);
    process.exitCode = 1;
    return;
  }
  logError(err instanceof Error ? `${err.stack ?? err.message}` : String(err));
  process.exitCode = 1;
});
