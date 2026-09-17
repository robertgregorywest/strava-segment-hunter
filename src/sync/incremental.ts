import type { Repository } from '../db/repository.js';
import type { SyncState } from '../db/syncState.js';
import type { StravaReadClient } from '../strava/client.js';
import { listActivities, processUnprocessedActivities } from './backfill.js';

const CURSOR_KEY = 'incremental_list_page';

/**
 * Brings the corpus up to date by listing only activities after the most
 * recently known one, then processing them the same way backfill does.
 */
export async function incrementalSync(
  client: StravaReadClient,
  repo: Repository,
  state: SyncState,
): Promise<{ listed: number; processed: number }> {
  const latest = await repo.latestActivityStartDate();
  const after = latest ? Math.floor(new Date(latest).getTime() / 1000) : undefined;

  // Each incremental run is its own bounded listing pass — reset the cursor
  // rather than reusing backfill's, so a completed prior run doesn't skip it.
  await state.set(CURSOR_KEY, '1');
  await state.setBoolean(`${CURSOR_KEY}_complete`, false);

  const listed = await listActivities(client, repo, state, { after, cursorKey: CURSOR_KEY });
  const processed = await processUnprocessedActivities(client, repo);

  return { listed, processed };
}
