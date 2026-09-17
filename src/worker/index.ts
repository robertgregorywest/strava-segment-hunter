import { D1WorkerBackend } from './d1Backend.js';
import { Repository } from '../db/repository.js';
import { SyncState } from '../db/syncState.js';
import { RiderSettingsStore } from '../search/riderSettings.js';
import { SearchService, type SearchFilters, type SearchOrderBy } from '../search/searchService.js';
import { SegmentDetailService } from '../search/segmentDetailService.js';
import { ForecastHorizonExceededError, OpenMeteoClient } from '../wind/openMeteoClient.js';
import type { RiderParams } from '../wind/projection.js';
import { loadWorkerConfig, type Env } from './env.js';
import { verifyPassphrase } from './passphrase.js';

const REALM = 'strava-segment-hunter';

function unauthorized(): Response {
  return new Response('Authorization required.', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
  });
}

/**
 * Everything below this is a single rider's ridden segments, KOM standing
 * and effective home location — a workers.dev URL is public DNS, so a
 * request must present the passphrase (any username, Basic Auth's password
 * field checked against PASSPHRASE_HASH) before it reaches anything else,
 * API or static asset alike.
 */
async function authorized(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get('Authorization');
  if (header === null || !header.startsWith('Basic ')) return false;

  let password: string;
  try {
    const decoded = atob(header.slice('Basic '.length));
    password = decoded.slice(decoded.indexOf(':') + 1);
  } catch {
    return false;
  }

  return verifyPassphrase(password, env.PASSPHRASE_HASH);
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function optionalNumber(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const ORDER_BY_VALUES: SearchOrderBy[] = ['projectedMargin', 'distance', 'length', 'gradient'];

function parseOrderBy(value: string | null): SearchOrderBy | undefined {
  return value !== null && (ORDER_BY_VALUES as string[]).includes(value) ? (value as SearchOrderBy) : undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!(await authorized(request, env))) return unauthorized();

    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const backend = new D1WorkerBackend(env.DB);
    const repo = new Repository(backend);
    const state = new SyncState(backend);
    const config = loadWorkerConfig(env);
    const weather = new OpenMeteoClient(backend, config.weather.forecastCacheMinutes);
    const riderSettings = new RiderSettingsStore(state, config.rider);
    const searchService = new SearchService(repo, weather, config);

    try {
      if (url.pathname === '/api/meta' && request.method === 'GET') {
        return json({
          home: config.home,
          latestForecastDate: weather.latestForecastDate(),
          rider: await riderSettings.get(),
          komFreshnessDays: config.segment.komFreshnessDays,
        });
      }

      if (url.pathname === '/api/settings' && request.method === 'GET') {
        return json({ rider: await riderSettings.get() });
      }

      if (url.pathname === '/api/settings' && request.method === 'PUT') {
        const body = (await request.json().catch(() => null)) as Partial<RiderParams> | null;
        const { massKg, cdA, crr, roughnessFactor } = body ?? {};
        if (
          typeof massKg !== 'number' ||
          typeof cdA !== 'number' ||
          typeof crr !== 'number' ||
          typeof roughnessFactor !== 'number' ||
          !Number.isFinite(massKg) ||
          !Number.isFinite(cdA) ||
          !Number.isFinite(crr) ||
          !Number.isFinite(roughnessFactor)
        ) {
          return json({ error: 'massKg, cdA, crr and roughnessFactor must all be numbers.' }, { status: 400 });
        }
        await riderSettings.set({ massKg, cdA, crr, roughnessFactor });
        return json({ rider: await riderSettings.get() });
      }

      if (url.pathname === '/api/search' && request.method === 'GET') {
        const radiusM = optionalNumber(url.searchParams.get('radiusM'));
        if (radiusM === undefined || radiusM <= 0) {
          return json({ error: 'radiusM is required and must be a positive number.' }, { status: 400 });
        }

        const filters: SearchFilters = { radiusM, riderParams: await riderSettings.get() };
        const lat = optionalNumber(url.searchParams.get('lat'));
        const lng = optionalNumber(url.searchParams.get('lng'));
        if (lat !== undefined) filters.lat = lat;
        if (lng !== undefined) filters.lng = lng;
        const targetDate = url.searchParams.get('targetDate');
        if (targetDate !== null) filters.targetDate = targetDate;
        const maxGapToKomS = optionalNumber(url.searchParams.get('maxGapToKomS'));
        if (maxGapToKomS !== undefined) filters.maxGapToKomS = maxGapToKomS;
        const maxKomRank = optionalNumber(url.searchParams.get('maxKomRank'));
        if (maxKomRank !== undefined) filters.maxKomRank = maxKomRank;
        const minLengthM = optionalNumber(url.searchParams.get('minLengthM'));
        if (minLengthM !== undefined) filters.minLengthM = minLengthM;
        const maxLengthM = optionalNumber(url.searchParams.get('maxLengthM'));
        if (maxLengthM !== undefined) filters.maxLengthM = maxLengthM;
        const minGradePercent = optionalNumber(url.searchParams.get('minGradePercent'));
        if (minGradePercent !== undefined) filters.minGradePercent = minGradePercent;
        const maxGradePercent = optionalNumber(url.searchParams.get('maxGradePercent'));
        if (maxGradePercent !== undefined) filters.maxGradePercent = maxGradePercent;
        const minDirectionality = optionalNumber(url.searchParams.get('minDirectionality'));
        if (minDirectionality !== undefined) filters.minDirectionality = minDirectionality;
        const orderBy = parseOrderBy(url.searchParams.get('orderBy'));
        if (orderBy !== undefined) filters.orderBy = orderBy;

        try {
          const result = await searchService.search(filters);
          return json(result);
        } catch (err) {
          if (err instanceof ForecastHorizonExceededError) {
            return json({ error: err.message, latestSelectableDate: err.latestSelectableDate }, { status: 400 });
          }
          throw err;
        }
      }

      const segmentMatch = /^\/api\/segments\/(\d+)$/.exec(url.pathname);
      if (segmentMatch && request.method === 'GET') {
        const id = Number(segmentMatch[1]);
        const detailService = new SegmentDetailService(repo, weather, config);
        const detail = await detailService.getDetail(id, await riderSettings.get());
        if (!detail) {
          return json({ error: `No segment ${id} in the corpus.` }, { status: 404 });
        }
        return json(detail);
      }

      return json({ error: 'Not found.' }, { status: 404 });
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error.' }, { status: 500 });
    }
  },
};
