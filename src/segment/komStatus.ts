export type KomStatus = 'fresh' | 'stale' | 'absent';

export interface KomFields {
  kom_seconds: number | null;
  kom_fetched_at: string | null;
}

/**
 * Distinguishes an absent KOM (never fetched, or the segment carries none)
 * from a stale one (known but past its freshness window) from a fresh one —
 * so a gap-to-KOM is never presented as fact when it isn't current.
 */
export function komStatus(segment: KomFields, freshnessDays: number, now = new Date()): KomStatus {
  if (segment.kom_seconds === null || segment.kom_fetched_at === null) return 'absent';

  const fetchedAt = new Date(segment.kom_fetched_at);
  const ageDays = (now.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > freshnessDays ? 'stale' : 'fresh';
}

/** Parses a Strava-style "M:SS" or "H:MM:SS" duration string into seconds. */
export function parseKomDuration(text: string | undefined): number | null {
  if (!text) return null;
  const parts = text.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return null;

  if (parts.length === 2) {
    const [minutes, seconds] = parts as [number, number];
    return minutes * 60 + seconds;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts as [number, number, number];
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}
