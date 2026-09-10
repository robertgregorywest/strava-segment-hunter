# Strava Segment Hunter

A personal tool for hunting attainable Strava KOMs, ranked by wind impact.

On a flat, fast segment, wind can swing your elapsed time more than fitness, tyres or
position. Strava gives you the KOM time and segment geometry but nothing about
conditions. This tool joins your own ridden history against [Open-Meteo](https://open-meteo.com/)
wind forecasts to answer: *of the segments near me, which ones am I closest to
the KOM on, and what's the best hour to go for it?*

It works by backfilling your Strava activity history into a local SQLite database,
enriching each ridden segment with geometry (bearing, directionality) and KOM/PR
data, then running a physical power model — calibrated against your own PR — to
project how wind on a chosen date would change your time on each segment.

This is a single-athlete tool: it authenticates as you and only ever stores your
own data.

## Requirements

- Node.js 20+
- A [Strava API application](https://www.strava.com/settings/api) (client ID and secret)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill it in:

   ```bash
   cp .env.example .env
   ```

   | Variable | Description |
   | --- | --- |
   | `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | From your Strava API application settings |
   | `STRAVA_REDIRECT_URI` | Must match the "Authorization Callback Domain" on your Strava app (default `http://localhost:8721/callback`) |
   | `STRAVA_TOKEN_PATH` | Where OAuth tokens are persisted (default `data/strava-tokens.json`) |
   | `HOME_LAT` / `HOME_LNG` | Default search origin, and priority order for segment enrichment |
   | `RIDER_MASS_KG`, `RIDER_CDA`, `RIDER_CRR` | Rider + bike mass, aerodynamic drag area, rolling resistance — feed the power model |
   | `WIND_ROUGHNESS_FACTOR` | Terrain roughness exponent used to correct 10 m forecast wind to rider height |
   | `DB_PATH` | SQLite database location (default `data/segment-hunter.db`) |
   | `API_PORT` | Port for the local web server (default `3000`) |
   | `KOM_FRESHNESS_DAYS` | How long a stored KOM time is trusted before being re-fetched |
   | `WIND_NEUTRAL_THRESHOLD` | Directionality below which a segment is treated as wind-neutral |
   | `FORECAST_CACHE_MINUTES` | How long Open-Meteo forecast responses are cached |

3. Authenticate with Strava (opens a browser flow, saves tokens to `STRAVA_TOKEN_PATH`):

   ```bash
   npm run auth
   ```

4. Run the initial backfill. This pages through your full activity history and can
   take multiple runs across separate days if it hits Strava's daily read quota —
   it's safe to interrupt and simply re-run; progress is persisted and never repeated:

   ```bash
   npm run sync:backfill
   ```

   For subsequent runs, use the incremental sync instead, which only fetches
   activities since the last known one:

   ```bash
   npm run sync
   ```

5. Start the web UI:

   ```bash
   npm run api
   ```

   Then open `http://localhost:3000` (or your configured `API_PORT`).

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
```

## How it works

- **Sync** (`src/sync`, `src/strava`) — OAuth against the Strava v3 API, a
  rate-limit budgeter that stays inside Strava's 200/15-min and 2,000/day read
  limits, and a resumable two-phase backfill (list activities, then fetch detail).
- **Geometry** (`src/geometry`) — decodes each segment's polyline and computes a
  length-weighted circular mean bearing plus a *directionality* metric (1.0 =
  dead straight, 0 = out-and-back), which determines whether wind meaningfully
  affects a segment at all.
- **Wind model** (`src/wind`) — corrects forecast wind from 10 m to rider height,
  resolves it into an along-segment component, and inverts your PR into a
  still-air power baseline so that predicted aerodynamic benefit scales
  correctly with speed and gradient rather than as a flat time bonus.
- **Search** (`src/search`) — queries the local corpus by radius, gap-to-KOM,
  `kom_rank`, distance, gradient and directionality, annotating every result
  with the projected wind impact for a chosen target date.
- **Web UI** (`web/`) — a dependency-light, build-step-free frontend (Leaflet +
  vanilla JS) served by the Express API in `src/api`.

## Known limitation

`GET /segments/explore` returns HTTP 401 for standard Strava API applications
even with `read_all` granted, so it can't be used for discovery. Segment
identification comes from your ridden history and `/segments/starred` instead —
segments you've never ridden or starred won't appear.

## Project status

Built from an [OpenSpec](openspec/) change (`segment-hunt-with-wind`); see
`openspec/changes/segment-hunt-with-wind/tasks.md` for the full task list and
what remains — a handful of tasks require verification against a live,
completed backfill and are noted there.
