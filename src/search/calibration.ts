import type { Repository } from '../db/repository.js';
import type { SegmentRow } from '../db/types.js';

export interface ResolvedPrEffort {
  elapsedS: number;
  startDate: string | undefined;
}

/** Prefers the segment's recorded PR; falls back to the fastest logged effort if the PR fields are unset. */
export async function resolvePrEffort(repo: Repository, segment: SegmentRow): Promise<ResolvedPrEffort | undefined> {
  if (segment.pr_seconds !== null) {
    return { elapsedS: segment.pr_seconds, startDate: segment.pr_start_date ?? undefined };
  }
  const best = await repo.bestEffortForSegment(segment.id);
  if (!best) return undefined;
  return { elapsedS: best.elapsed_time_s, startDate: best.start_date };
}
