# Strava Segment Hunter

A personal tool for hunting attainable Strava KOMs, ranked by wind impact.

On a flat, fast segment, wind can swing your elapsed time more than fitness, tyres or
position. Strava gives you the KOM time and segment geometry but nothing about
conditions. This tool joins your own ridden history against [Open-Meteo](https://open-meteo.com/)
wind forecasts to answer: *of the segments near me, which ones am I closest to
the KOM on, and what's the best hour to go for it?*

It works by backfilling your Strava activity history into a database, enriching
each ridden segment with geometry (bearing, directionality) and KOM/PR data, then
running a physical power model — calibrated against your own PR — to project how
wind on a chosen date would change your time on each segment.

This is a single-athlete tool: it authenticates as you and only ever stores your
own data.

## Architecture

- **Sync** runs on a schedule in GitHub Actions (`.github/workflows/sync.yml`,
  daily at 00:05 UTC, shortly after Strava's daily read quota rolls over) and
  writes into [Cloudflare D1](https://developers.cloudflare.com/d1/) over its
  HTTP API.
- **Search/API/UI** run in a [Cloudflare Worker](https://developers.cloudflare.com/workers/)
  (`src/worker`), reading the same D1 database and serving the static frontend
  (`web/`) alongside it.
- Locally, the same code runs against a local SQLite file instead — see
  "Local development" below. Both backends implement the same `SqlBackend`
  interface (`src/db/backend.ts`) over the same SQL, so dev/test never drifts
  from what production runs.
- The Worker sits at a public `workers.dev` URL with no other access control
  in front of it, so every request (API and static assets alike) is gated by
  a shared passphrase over HTTP Basic Auth (`src/worker/passphrase.ts`) — see
  "Deploying" below.

## Requirements

- Node.js 20+
- A [Strava API application](https://www.strava.com/settings/api) (client ID and secret)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier) and the
  [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) CLI (installed via `npx`, no separate install needed)

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
   | `DB_PATH` | Local SQLite database location, used for local dev/test only (default `data/segment-hunter.db`) |
   | `API_PORT` | Port for the local web server (default `3000`) |
   | `KOM_FRESHNESS_DAYS` | How long a stored KOM time is trusted before being re-fetched |
   | `WIND_NEUTRAL_THRESHOLD` | Directionality below which a segment is treated as wind-neutral |
   | `FORECAST_CACHE_MINUTES` | How long Open-Meteo forecast responses are cached |
   | `SYNC_REQUEST_TIMEOUT_MS` | Per-request timeout before a Strava call is aborted and retried (default `30000`) |
   | `SYNC_MAX_NETWORK_RETRIES` | Retries for a network-level failure (not a 429) before giving up on that call (default `5`) |

   Running sync against production D1 (`--store d1`, see below) additionally needs
   `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` and `CLOUDFLARE_API_TOKEN` — put these
   in `.dev.vars` (gitignored, read automatically by the `*:d1` scripts) rather than
   `.env`, matching Cloudflare's own convention.

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

   To run the backfill unattended (it can take a while across thousands of
   activities), use the backgrounded variant instead. It logs timestamped
   progress to `logs/`, and auto-restarts on a crash (e.g. a stalled network
   connection) since progress is committed per-activity/per-segment — a
   restart just resumes, it never repeats work:

   ```bash
   npm run sync:backfill:bg
   tail -f logs/backfill-*.log      # watch progress
   kill $(cat logs/backfill.pid)    # stop it
   ```

   Each Strava request is retried with backoff on transient network failures
   and bounded by a per-request timeout (`SYNC_REQUEST_TIMEOUT_MS`, default
   30s) so a stalled connection fails fast instead of hanging for minutes;
   tune it and `SYNC_MAX_NETWORK_RETRIES` (default 5) via `.env` if needed.

## Local development

Backfill/sync locally against the local SQLite file exactly as before
(`npm run sync:backfill`, `npm run sync`, etc. — these default to the local
store; add `:d1` to any of them, e.g. `npm run sync:d1`, to target production
D1 instead, using the `.dev.vars` credentials above).

Run the Worker (API + UI) locally, against a local D1 replica that never
touches production:

```bash
npx wrangler d1 migrations apply strava-segment-hunter --local   # once, or after a schema change
npm run dev                                                      # wrangler dev
```

Then open `http://localhost:8787` — Basic Auth will prompt; any username, and
whatever passphrase you set with `npm run passphrase` (see "Deploying") for
`.dev.vars`'s `PASSPHRASE_HASH` if you want the local server gated too, or
leave it unset locally for convenience (production always requires it).

```bash
npm run typecheck   # tsc --noEmit (both the Node and Worker tsconfigs)
npm run lint        # eslint
npm test            # vitest
```

## Deploying

One-time setup:

1. `npx wrangler login`, then `npx wrangler d1 create strava-segment-hunter`
   and put the resulting `database_id` in `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply strava-segment-hunter --remote`.
3. Set a passphrase (never typed anywhere Claude or shell history can see it):

   ```bash
   npx tsx scripts/passphrase.ts | npx wrangler secret put PASSPHRASE_HASH
   npx wrangler secret put HOME_LAT     # your home latitude — kept out of the
   npx wrangler secret put HOME_LNG     # committed wrangler.jsonc since this repo is public
   ```
4. In the GitHub repo's settings, add secrets `STRAVA_CLIENT_ID`,
   `STRAVA_CLIENT_SECRET`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`,
   `CLOUDFLARE_API_TOKEN` (a token scoped to D1:Edit + Workers Scripts:Edit),
   and variables `HOME_LAT`, `HOME_LNG`.
5. `npx wrangler deploy`, or push to `main` — `.github/workflows/deploy.yml`
   does this on every push after typecheck + tests pass.

`.github/workflows/sync.yml` runs the backfill/incremental sync daily and
commits a heartbeat file so GitHub doesn't auto-disable the schedule after 60
days of otherwise-quiet repository activity.

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
  vanilla JS) served as static assets alongside the Worker's API routes
  (`src/worker`).

## Known limitations

D1's free tier caps writes at 100,000 rows/day. Day-to-day incremental sync is
nowhere near that, but the one-time migration of the full corpus (~190,000
`segment_efforts` rows alone) blew through it in a single run — a future full
re-backfill would need to be spread across more than one day, or run against a
Workers Paid plan.

`GET /segments/explore` returns HTTP 401 for standard Strava API applications
even with `read_all` granted, so it can't be used for discovery. Segment
identification comes from your ridden history and `/segments/starred` instead —
segments you've never ridden or starred won't appear.

## Project status

Built from an [OpenSpec](openspec/) change (`segment-hunt-with-wind`); see
`openspec/changes/segment-hunt-with-wind/tasks.md` for the full task list and
what remains — a handful of tasks require verification against a live,
completed backfill and are noted there.
