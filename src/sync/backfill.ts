import type { Repository, SegmentStub } from '../db/repository.js';
import type { SyncState } from '../db/syncState.js';
import type { StravaReadClient } from '../strava/client.js';
import type { StravaSummarySegment } from '../strava/types.js';

const PER_PAGE = 200;

function toSegmentStub(segment: StravaSummarySegment): SegmentStub {
  return {
    id: segment.id,
    name: segment.name,
    distanceM: segment.distance ?? null,
    averageGrade: segment.average_grade ?? null,
    startLat: segment.start_latlng?.[0] ?? null,
    startLng: segment.start_latlng?.[1] ?? null,
    endLat: segment.end_latlng?.[0] ?? null,
    endLng: segment.end_latlng?.[1] ?? null,
  };
}

/**
 * Phase 1a: enumerate activity ids and dates. Cheap (~1 call per 200
 * activities) and resumable via a page cursor in sync_state, independent
 * of per-activity effort processing below.
 */
export async function listActivities(
  client: StravaReadClient,
  repo: Repository,
  state: SyncState,
  options: { after?: number | undefined; cursorKey?: string | undefined } = {},
): Promise<number> {
  const cursorKey = options.cursorKey ?? 'activities_list_page';
  const completeKey = `${cursorKey}_complete`;

  if (state.getBoolean(completeKey)) return 0;

  let page = Number.parseInt(state.get(cursorKey) ?? '1', 10);
  let total = 0;

  for (;;) {
    const activities = await client.listActivities(page, PER_PAGE, options.after);
    if (activities.length === 0) {
      state.setBoolean(completeKey, true);
      break;
    }

    for (const activity of activities) {
      repo.upsertActivityStub(activity.id, activity.name, activity.start_date);
      total += 1;
    }

    state.set(cursorKey, String(page + 1));
    page += 1;
  }

  return total;
}

/**
 * Phase 1b: fetch each listed activity's segment efforts. Resumable — an
 * activity is only marked processed once its efforts are persisted, so an
 * interrupted run picks up exactly where it left off.
 */
export async function processUnprocessedActivities(
  client: StravaReadClient,
  repo: Repository,
): Promise<number> {
  const pending = repo.unprocessedActivities();
  let processed = 0;

  for (const activity of pending) {
    const detail = await client.getActivity(activity.id);
    const touchedSegments = new Set<number>();

    for (const effort of detail.segment_efforts ?? []) {
      repo.upsertSegmentStub(toSegmentStub(effort.segment));
      repo.insertEffort({
        id: effort.id,
        segmentId: effort.segment.id,
        activityId: activity.id,
        elapsedTimeS: effort.elapsed_time,
        startDate: effort.start_date,
        prRank: effort.pr_rank,
        komRank: effort.kom_rank,
      });
      repo.markSegmentHasBaseline(effort.segment.id);
      touchedSegments.add(effort.segment.id);
    }

    for (const segmentId of touchedSegments) {
      repo.refreshBestKomRank(segmentId);
    }

    repo.markActivityProcessed(activity.id);
    processed += 1;
  }

  return processed;
}
