import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/index.js';
import { openLocalBackend } from '../db/index.js';
import { Repository } from '../db/repository.js';
import { SyncState } from '../db/syncState.js';
import { RiderSettingsStore } from '../search/riderSettings.js';
import { SearchService, type SearchFilters, type SearchOrderBy } from '../search/searchService.js';
import { SegmentDetailService } from '../search/segmentDetailService.js';
import { ForecastHorizonExceededError, OpenMeteoClient } from '../wind/openMeteoClient.js';
import type { RiderParams } from '../wind/projection.js';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../web');

// Bound to loopback only: everything this serves is a single rider's ridden
// segments, KOM standing and home location, and there is no auth in front of it.
const HOST = '127.0.0.1';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const config = loadConfig();
const { backend } = openLocalBackend(config.db.path);
const repo = new Repository(backend);
const weather = new OpenMeteoClient(backend, config.weather.forecastCacheMinutes);
const riderSettings = new RiderSettingsStore(new SyncState(backend), config.rider);
const searchService = new SearchService(repo, weather, config);
const detailService = new SegmentDetailService(repo, weather, config);

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

async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);

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
      return json(await searchService.search(filters));
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
    const detail = await detailService.getDetail(id, await riderSettings.get());
    if (!detail) {
      return json({ error: `No segment ${id} in the corpus.` }, { status: 404 });
    }
    return json(detail);
  }

  return json({ error: 'Not found.' }, { status: 404 });
}

async function serveStatic(pathname: string): Promise<Response> {
  const relative = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const path = join(WEB_ROOT, relative);
  if (!path.startsWith(WEB_ROOT + sep)) return new Response('Not found.', { status: 404 });
  try {
    const body = await readFile(path);
    return new Response(body, {
      headers: { 'Content-Type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream' },
    });
  } catch {
    return new Response('Not found.', { status: 404 });
  }
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
  return new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`), {
    method: req.method ?? 'GET',
    headers,
    ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
  });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer((req, res) => {
  void (async () => {
    let response: Response;
    try {
      const request = await toRequest(req);
      const { pathname } = new URL(request.url);
      response = pathname.startsWith('/api/') ? await handleApi(request) : await serveStatic(pathname);
    } catch (err) {
      console.error(err);
      response = json({ error: 'Internal error.' }, { status: 500 });
    }
    await send(res, response);
  })();
});

server.listen(config.api.port, HOST, () => {
  console.log(`segment-hunter listening on http://localhost:${config.api.port}`);
});
