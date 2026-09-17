import type { Repository } from '../db/repository.js';
import { log } from '../log.js';
import type { StravaReadClient } from '../strava/client.js';

const PER_PAGE = 200;

/**
 * Ingests starred segments as an additional corpus source — the only way a
 * never-ridden segment can enter the corpus, since /segments/explore is
 * unavailable (see design.md).
 */
export async function ingestStarredSegments(client: StravaReadClient, repo: Repository): Promise<number> {
  let page = 1;
  let total = 0;

  for (;;) {
    const segments = await client.listStarredSegments(page, PER_PAGE);
    if (segments.length === 0) break;

    for (const segment of segments) {
      await repo.upsertSegmentStub({
        id: segment.id,
        name: segment.name,
        distanceM: segment.distance ?? null,
        averageGrade: segment.average_grade ?? null,
        startLat: segment.start_latlng?.[0] ?? null,
        startLng: segment.start_latlng?.[1] ?? null,
        endLat: segment.end_latlng?.[0] ?? null,
        endLng: segment.end_latlng?.[1] ?? null,
      });
      await repo.markSegmentStarred(segment.id);
      total += 1;
    }

    log(`Starred segments: page ${page} — ${segments.length} segments (${total} total so far).`);
    page += 1;
  }

  return total;
}
