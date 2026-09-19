import Database from 'better-sqlite3';
import type { SqlBackend, SqlRunResult, SqlValue } from '../src/db/backend.ts';
import { D1HttpBackend } from '../src/db/d1HttpBackend.ts';
import { migrate } from '../src/db/migrate.ts';
import { Repository } from '../src/db/repository.ts';
import { SqliteBackend } from '../src/db/sqliteBackend.ts';
import { SyncState } from '../src/db/syncState.ts';
import { analyzeSegmentGeometry } from '../src/geometry/analysis.ts';
import { RiderSettingsStore } from '../src/search/riderSettings.ts';
import { SegmentDetailService } from '../src/search/segmentDetailService.ts';
import { OpenMeteoClient } from '../src/wind/openMeteoClient.ts';

/**
 * Checks the change's live-data verification tasks against production D1:
 *
 *   npm run verify:prod
 *
 * - 5.7: the backfill covers the known 3,872-ride corpus, every activity processed
 * - 7.7: segment 1470768's geometry is ~319.3°, ~0.968 directionality, 3538 m ±1%
 * - 9.9: a week of forecast gives a spread comparable to the spike's 290–353 s
 *
 * Read-only: D1 is wrapped so any write throws, and Open-Meteo's cache goes to
 * an in-memory SQLite database instead of production's cache tables.
 */

const KNOWN_CORPUS_RIDES = 3872;
const SEGMENT_ID = 1470768;
const EXPECTED = { bearingDeg: 319.3, directionality: 0.968, pathLengthM: 3538 };
const SPIKE = { fastestS: 290, slowestS: 353 };

class ReadOnlyBackend implements SqlBackend {
  constructor(private readonly inner: SqlBackend) {}

  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]> {
    return this.inner.all<T>(sql, params);
  }

  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined> {
    return this.inner.get<T>(sql, params);
  }

  run(sql: string): Promise<SqlRunResult> {
    throw new Error(`Refusing to write to production D1: ${sql}`);
  }

  batch(): Promise<void> {
    throw new Error('Refusing to write to production D1 (batch).');
  }
}

let failures = 0;

function check(label: string, pass: boolean, detail: string): void {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}: ${detail}`);
}

function angularDifference(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function envFloat(name: string, fallback: number): number {
  const n = Number.parseFloat(process.env[name] ?? '');
  return Number.isNaN(n) ? fallback : n;
}

const d1 = new ReadOnlyBackend(D1HttpBackend.fromEnvironment());
const repo = new Repository(d1);

const cacheDb = new Database(':memory:');
migrate(cacheDb);
const weather = new OpenMeteoClient(new SqliteBackend(cacheDb), 60);

console.log('5.7  Backfill against the known corpus');
const { total, processed } = await repo.activityCount();
check('activities listed', total >= KNOWN_CORPUS_RIDES, `${total} in D1 (known corpus ${KNOWN_CORPUS_RIDES})`);
check('activities processed', processed === total, `${processed} of ${total} processed`);

console.log(`\n7.7  Geometry of segment ${SEGMENT_ID}`);
const segment = await repo.getSegment(SEGMENT_ID);
if (!segment) {
  check('segment present', false, 'not in D1');
} else {
  const start = segment.start_lat !== null && segment.start_lng !== null ? ([segment.start_lat, segment.start_lng] as [number, number]) : null;
  const end = segment.end_lat !== null && segment.end_lng !== null ? ([segment.end_lat, segment.end_lng] as [number, number]) : null;
  const geometry = analyzeSegmentGeometry(segment.polyline, start, end);
  console.log(`  ${segment.name ?? '(unnamed)'}`);

  if (!geometry) {
    check('geometry', false, 'no polyline and no start/end points');
  } else {
    check('from full polyline', !geometry.approximate, geometry.approximate ? 'start/end fallback only' : 'yes');
    check(
      'bearing',
      angularDifference(geometry.bearingDeg, EXPECTED.bearingDeg) <= 1,
      `${geometry.bearingDeg.toFixed(1)}° (expected ~${EXPECTED.bearingDeg}°; stored ${segment.bearing_deg?.toFixed(1) ?? 'null'}°)`,
    );
    check(
      'directionality',
      Math.abs(geometry.directionality - EXPECTED.directionality) <= 0.01,
      `${geometry.directionality.toFixed(3)} (expected ~${EXPECTED.directionality}; stored ${segment.directionality?.toFixed(3) ?? 'null'})`,
    );
    check(
      'path length',
      Math.abs(geometry.pathLengthM - EXPECTED.pathLengthM) / EXPECTED.pathLengthM <= 0.01,
      `${geometry.pathLengthM.toFixed(0)} m (expected ${EXPECTED.pathLengthM} m ±1%)`,
    );
  }

  console.log(`\n9.9  One week of forecast for segment ${SEGMENT_ID}`);
  const defaults = {
    massKg: envFloat('RIDER_MASS_KG', 78),
    cdA: envFloat('RIDER_CDA', 0.32),
    crr: envFloat('RIDER_CRR', 0.005),
    roughnessFactor: envFloat('WIND_ROUGHNESS_FACTOR', 0.55),
  };
  const rider = await new RiderSettingsStore(new SyncState(d1), defaults).get();
  const detailService = new SegmentDetailService(repo, weather, {
    home: { lat: 0, lng: 0 },
    rider,
    segment: { komFreshnessDays: 14 },
  });
  const detail = await detailService.getDetail(SEGMENT_ID, rider, 7);

  if (!detail || detail.hourly.length === 0) {
    check('projection', false, detail?.message ?? (detail?.weatherUnavailable ? 'weather unavailable' : 'no projection'));
  } else {
    const sorted = [...detail.hourly].sort((a, b) => a.predictedTimeS - b.predictedTimeS);
    const fastest = sorted[0]!;
    const slowest = sorted[sorted.length - 1]!;
    const describe = (h: typeof fastest): string =>
      `${h.predictedTimeS.toFixed(0)} s at ${h.time} (wind ${h.windSpeedMs.toFixed(1)} m/s from ${h.windDirectionDeg.toFixed(0)}°)`;

    console.log(`  rider: ${JSON.stringify(rider)}; confidence: ${detail.confidence}; PR ${segment.pr_seconds ?? '?'} s; KOM ${segment.kom_seconds ?? '?'} s`);
    console.log(`  fastest: ${describe(fastest)}`);
    console.log(`  slowest: ${describe(slowest)}`);
    const spread = slowest.predictedTimeS - fastest.predictedTimeS;
    // The spike's exact numbers came from a different week's forecast, so this
    // week can only be judged for the same order of magnitude, not reproduced.
    check(
      'spread',
      spread >= 20,
      `${spread.toFixed(0)} s over ${detail.hourly.length} hours (spike: ${SPIKE.fastestS}–${SPIKE.slowestS} s, ${SPIKE.slowestS - SPIKE.fastestS} s spread, on a different week)`,
    );
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
