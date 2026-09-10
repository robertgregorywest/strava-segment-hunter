import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { loadConfig } from '../config/index.js';
import { openDatabase } from '../db/index.js';
import { Repository } from '../db/repository.js';
import { RiderSettingsStore } from '../search/riderSettings.js';
import { SearchService, type SearchFilters, type SearchOrderBy } from '../search/searchService.js';
import { SegmentDetailService } from '../search/segmentDetailService.js';
import { ForecastHorizonExceededError, OpenMeteoClient } from '../wind/openMeteoClient.js';
import type { RiderParams } from '../wind/projection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '../../web');

const config = loadConfig();
const db = openDatabase(config.db.path);
const repo = new Repository(db);
const weather = new OpenMeteoClient(db, config.weather.forecastCacheMinutes);
const riderSettings = new RiderSettingsStore(config.rider);
const searchService = new SearchService(repo, weather, config);
const detailService = new SegmentDetailService(repo, weather, config);

const app = express();
app.use(express.json());
app.use(express.static(WEB_ROOT));

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const ORDER_BY_VALUES: SearchOrderBy[] = ['projectedMargin', 'distance', 'length', 'gradient'];

function parseOrderBy(value: unknown): SearchOrderBy | undefined {
  return typeof value === 'string' && (ORDER_BY_VALUES as string[]).includes(value)
    ? (value as SearchOrderBy)
    : undefined;
}

app.get('/api/meta', (_req: Request, res: Response) => {
  res.json({
    home: config.home,
    latestForecastDate: weather.latestForecastDate(),
    rider: riderSettings.get(),
    komFreshnessDays: config.segment.komFreshnessDays,
  });
});

app.get('/api/settings', (_req: Request, res: Response) => {
  res.json({ rider: riderSettings.get() });
});

app.put('/api/settings', (req: Request, res: Response) => {
  const body = req.body as Partial<RiderParams>;
  const { massKg, cdA, crr, roughnessFactor } = body;
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
    res.status(400).json({ error: 'massKg, cdA, crr and roughnessFactor must all be numbers.' });
    return;
  }
  riderSettings.set({ massKg, cdA, crr, roughnessFactor });
  res.json({ rider: riderSettings.get() });
});

app.get('/api/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const radiusM = optionalNumber(req.query['radiusM']);
    if (radiusM === undefined || radiusM <= 0) {
      res.status(400).json({ error: 'radiusM is required and must be a positive number.' });
      return;
    }

    const filters: SearchFilters = {
      radiusM,
      riderParams: riderSettings.get(),
    };
    const lat = optionalNumber(req.query['lat']);
    const lng = optionalNumber(req.query['lng']);
    if (lat !== undefined) filters.lat = lat;
    if (lng !== undefined) filters.lng = lng;
    if (typeof req.query['targetDate'] === 'string') filters.targetDate = req.query['targetDate'];
    const maxGapToKomS = optionalNumber(req.query['maxGapToKomS']);
    if (maxGapToKomS !== undefined) filters.maxGapToKomS = maxGapToKomS;
    const maxKomRank = optionalNumber(req.query['maxKomRank']);
    if (maxKomRank !== undefined) filters.maxKomRank = maxKomRank;
    const minLengthM = optionalNumber(req.query['minLengthM']);
    if (minLengthM !== undefined) filters.minLengthM = minLengthM;
    const maxLengthM = optionalNumber(req.query['maxLengthM']);
    if (maxLengthM !== undefined) filters.maxLengthM = maxLengthM;
    const minGradePercent = optionalNumber(req.query['minGradePercent']);
    if (minGradePercent !== undefined) filters.minGradePercent = minGradePercent;
    const maxGradePercent = optionalNumber(req.query['maxGradePercent']);
    if (maxGradePercent !== undefined) filters.maxGradePercent = maxGradePercent;
    const minDirectionality = optionalNumber(req.query['minDirectionality']);
    if (minDirectionality !== undefined) filters.minDirectionality = minDirectionality;
    const orderBy = parseOrderBy(req.query['orderBy']);
    if (orderBy !== undefined) filters.orderBy = orderBy;

    const result = await searchService.search(filters);
    res.json(result);
  } catch (err) {
    if (err instanceof ForecastHorizonExceededError) {
      res.status(400).json({ error: err.message, latestSelectableDate: err.latestSelectableDate });
      return;
    }
    next(err);
  }
});

app.get('/api/segments/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params['id']);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Segment id must be a number.' });
      return;
    }
    const detail = await detailService.getDetail(id, riderSettings.get());
    if (!detail) {
      res.status(404).json({ error: `No segment ${id} in the corpus.` });
      return;
    }
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error.' });
});

app.listen(config.api.port, () => {
  console.log(`segment-hunter API listening on http://localhost:${config.api.port}`);
});
