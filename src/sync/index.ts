import { loadConfig } from '../config/index.js';
import { openDatabase } from '../db/index.js';
import { Repository } from '../db/repository.js';
import { SyncState } from '../db/syncState.js';
import { log, logError } from '../log.js';
import { AuthManager, NotAuthorizedError, ReauthorizationRequiredError, describeCapabilityLoss, missingScopes } from '../strava/auth.js';
import { StravaClient } from '../strava/client.js';
import { DailyQuotaExhaustedError, RateLimitBudgeter } from '../strava/rateLimiter.js';
import { enrichSegments } from './enrichment.js';
import { listActivities, processUnprocessedActivities } from './backfill.js';
import { incrementalSync } from './incremental.js';
import { ingestStarredSegments } from './starred.js';

async function main(): Promise<void> {
  const backfillMode = process.argv.includes('--backfill');
  const startedAt = Date.now();

  const config = loadConfig();
  const db = openDatabase(config.db.path);
  const repo = new Repository(db);
  const state = new SyncState(db);

  const auth = new AuthManager(config);
  const tokens = auth.currentTokens();
  if (!tokens) {
    logError(new NotAuthorizedError().message);
    process.exitCode = 1;
    return;
  }

  const missing = missingScopes(tokens.scope);
  for (const scope of missing) {
    log(`Missing Strava scope "${scope}": ${describeCapabilityLoss(scope)} will be unavailable.`);
  }

  const budgeter = new RateLimitBudgeter(db, config.sync.shortWindowPauseFraction);
  const client = new StravaClient(auth, budgeter, {
    requestTimeoutMs: config.sync.requestTimeoutMs,
    maxNetworkRetries: config.sync.maxNetworkRetries,
  });

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

  const counts = repo.activityCount();
  const elapsedS = (Date.now() - startedAt) / 1000;
  log(`Corpus: ${counts.processed}/${counts.total} activities processed. Run took ${elapsedS.toFixed(0)}s.`);
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
