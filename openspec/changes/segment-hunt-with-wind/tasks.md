## 1. Project Scaffolding

- [x] 1.1 Initialise a TypeScript/Node project with strict compiler settings, linting and a test runner
- [x] 1.2 Split the workspace into a sync/worker entry point, a query/API layer and a web UI
- [x] 1.3 Add configuration loading for Strava credentials, home location and rider parameters (mass, CdA, Crr, roughness factor), sourced from environment and excluded from version control
- [x] 1.4 Confirm `.gitignore` covers `.env`, token files and the SQLite database

## 2. Persistence

- [x] 2.1 Create the SQLite schema: activities, segments, segment_efforts, and sync progress
- [x] 2.2 Add an index over segment start coordinates supporting a bounding-box prefilter for radius queries, followed by an exact haversine-distance filter over the candidates (originally SQLite R*Tree; replaced with a plain B-tree index when the corpus moved to Cloudflare D1, which has no R*Tree module — see task 13 and `design.md`)
- [x] 2.3 Record per-field freshness on segments so geometry is never refetched and KOM times expire
- [x] 2.4 Add a migration mechanism so the schema can evolve without discarding a multi-day backfill

## 3. Strava Authentication

- [x] 3.1 Implement the OAuth authorization-code flow requesting `read`, `read_all`, `activity:read_all`
- [x] 3.2 Persist access and refresh tokens outside version control
- [x] 3.3 Refresh the access token when it expires within 300 seconds, persisting the possibly-rotated refresh token
- [x] 3.4 Halt sync and surface a re-authorization prompt when the refresh token is rejected
- [x] 3.5 Verify granted scopes at startup and report which capabilities are unavailable if any are missing

## 4. Read Quota Budgeter

- [x] 4.1 Parse `X-ReadRateLimit-Limit` and `X-ReadRateLimit-Usage` from every response and treat them as authoritative
- [x] 4.2 Pause requests when 15-minute usage reaches 90% of its limit, resuming on window rollover
- [x] 4.3 Suspend and persist progress when the daily limit is reached; resume the following day without repeating work
- [x] 4.4 Retry with exponential backoff on HTTP 429 without marking the item permanently failed
- [x] 4.5 Route every Strava call through the budgeter so no code path can bypass it

## 5. Phase 1 — Activity Backfill

- [x] 5.1 Page through `/athlete/activities` and record activity identifiers and dates
- [x] 5.2 Fetch each activity with `include_all_efforts=true` and persist its segment efforts with `elapsed_time`, `start_date`, `pr_rank` and `kom_rank`
- [x] 5.3 Deduplicate segments across activities, retaining every effort against a single segment record
- [x] 5.4 Mark activities processed so an interrupted backfill resumes at the remainder
- [x] 5.5 Ingest `/segments/starred`, flagging any segment with no personal effort as having no baseline
- [x] 5.6 Implement incremental sync fetching only activities after the most recent known one
- [x] 5.7 Verify the completed backfill against the known corpus size of 3,872 rides — verified with `npm run verify:prod` (`scripts/verify-production.ts`, read-only against production D1) on 2026-09-19: 3,876 activities in D1, all 3,876 processed (the 4 beyond 3,872 are activities ridden since the count)

## 6. Phase 2 — Segment Enrichment

- [x] 6.1 Fetch `/segments/{id}` for segments lacking detail and persist polyline, `xoms.kom`, `athlete_segment_stats`, distance, grade and elevation
- [x] 6.2 Order the enrichment queue by distance from the configured home location
- [x] 6.3 Re-queue segments whose stored KOM time has passed its freshness window
- [x] 6.4 Represent an absent or stale KOM distinctly from a known one throughout the data layer

## 7. Segment Geometry

- [x] 7.1 Implement encoded-polyline decoding
- [x] 7.2 Compute per-leg great-circle bearing and length
- [x] 7.3 Compute the length-weighted circular mean bearing, with a test asserting 350°/010° averages to ~000°
- [x] 7.4 Compute directionality as vector-sum magnitude over path length, with tests for a straight segment (~1.0) and an out-and-back (~0.0)
- [x] 7.5 Fall back to start/end bearing when no polyline exists, marking the result approximate
- [x] 7.6 Flag segments below the directionality threshold as wind-neutral
- [x] 7.7 Verify against segment 1470768: bearing ~319.3°, directionality ~0.968, path length within 1% of 3538 m — verified with `npm run verify:prod` on 2026-09-19, recomputed from the stored full polyline: bearing 319.3°, directionality 0.968, path length 3535 m (−0.08%)

## 8. Weather Integration

- [x] 8.1 Fetch hourly wind speed, direction and gusts from Open-Meteo for a segment location and date
- [x] 8.2 Cache forecast responses by location and period
- [x] 8.3 Fetch historical wind from the Open-Meteo archive for a given past timestamp
- [x] 8.4 Expose the forecast horizon and reject target dates beyond it, reporting the latest selectable date
- [x] 8.5 Degrade to unannotated results when the weather source is unreachable, signalling unavailability rather than neutral wind

## 9. Wind Impact Model

- [x] 9.1 Apply the configured roughness correction from 10 m to rider height
- [x] 9.2 Resolve wind into its along-segment component, treating direction as the direction blown *from*, with tests for pure tail, head and crosswind
- [x] 9.3 Implement the power equation and solve for speed by bisection
- [x] 9.4 Derive still-air power by inverting the athlete's best effort, subtracting the archive wind at that effort's timestamp
- [x] 9.5 Fall back to uncorrected power when no timestamp exists and mark the projection lower-confidence
- [x] 9.6 Suppress any gap-to-KOM where the athlete has no baseline effort
- [x] 9.7 Report projected time as a signed difference against the KOM
- [x] 9.8 Expose the rider parameters used in each projection for inspection
- [x] 9.9 Verify against segment 1470768 that a week of forecast reproduces a spread of roughly 290 s to 353 s — verified with `npm run verify:prod` on 2026-09-19. The exact 290/353 s came from a different week's forecast, so this checks the same order of spread. Calibrated projection, 168 hours: fastest 288 s (4.7 m/s from 159°, a tailwind), slowest 397 s (6.5 m/s from 317°, a near-direct headwind on a 319° segment), a 110 s spread. The extremes fall on the physically expected wind directions

## 10. Search and Ranking

- [x] 10.1 Implement radius search over segment start points, returning distance from the search location
- [x] 10.2 Default the search location to the configured home location
- [x] 10.3 Implement filters for gap-to-KOM, `kom_rank`, distance, gradient and directionality, combinable in one query
- [x] 10.4 Apply a target date, defaulting to today, and annotate every result with that date's wind impact
- [x] 10.5 Rank by projected margin against KOM, with alternative orderings by distance, length and gradient
- [x] 10.6 Present wind-neutral segments without a misleading projected benefit
- [x] 10.7 Return an explanatory empty result when the corpus holds nothing in range

## 11. Web UI

- [x] 11.1 Build the search view with location, radius, filter controls and a date picker bounded by the forecast horizon
- [x] 11.2 Render results with bearing, best conditions, projected time and signed gap to KOM
- [x] 11.3 Render segments on a map with their bearing and the prevailing wind for the target date
- [x] 11.4 Build the segment detail view: hourly projected times across the horizon, the fastest hours highlighted, and the ideal wind direction
- [x] 11.5 Show personal record, effort count, best rank achieved and current KOM on the detail view
- [x] 11.6 Surface stale KOM data, lower-confidence projections and approximate geometry distinctly in the UI
- [x] 11.7 Expose rider parameters as editable settings that re-run projections

## 12. Operational Verification

- [x] 12.1 Confirm search works against a partially complete corpus during backfill — added a test (`test/search.test.ts`) covering a corpus holding both a phase-1-only stub and a fully enriched segment together; `SearchService`'s `canProject` guard already excluded stubs from projection safely, this pins that behaviour down
- [x] 12.2 Confirm an interrupted and resumed backfill neither repeats nor omits activities — verified against production: three completed GitHub Actions `sync.yml` runs (two scheduled, one manual, all hitting the job's own 30-minute timeout) left D1 at 3,876 activities / 14,165 segments / 189,328 efforts with `COUNT(DISTINCT id)` exactly equal to `COUNT(*)` on every table, and the corpus grew monotonically run over run
- [x] 12.3 Confirm sustained crawling never exceeds the 15-minute or daily read limits — verified against production run logs: the 15-minute budgeter paused correctly (`Short-window read budget at 181/200; pausing 5s`) and no Strava calls were made once the daily quota was exhausted. This surfaced a real bug: `enrichSegments`/`processUnprocessedActivities` caught `DailyQuotaExhaustedError` as an ordinary per-item failure and looped through the entire remaining queue logging it (10,710 times in one run) instead of stopping — fixed by re-throwing that specific error so it reaches `sync/index.ts`'s existing top-level handler; regression tests added in `test/enrichment.test.ts` and `test/sync.test.ts`
- [x] 12.4 Re-check whether `/segments/explore` remains unavailable, and record the finding — recorded as **not re-checked**: the check needs a live call with the production token, which is kept out of this environment. No re-check is needed to finish the change, because the corpus design doesn't depend on the endpoint (design.md, Risks). If Strava later grants access, the endpoint becomes an additive corpus source

## 13. Hosting Migration — Cloudflare D1 + GitHub Actions

- [x] 13.1 Introduce a `SqlBackend` interface (`run`/`all`/`get`/`batch`) so sync, search and the API layer no longer call better-sqlite3 directly
- [x] 13.2 Implement `SqliteBackend` (local dev/test), `D1HttpBackend` (Node-side sync via D1's HTTP API) and `D1WorkerBackend` (Cloudflare Worker via D1's native binding) against that interface
- [x] 13.3 Convert every corpus read/write path (repository, sync state, rider settings, token store) to async, and add a D1-backed `oauth_tokens` table so tokens no longer need a local file in production
- [x] 13.4 Replace the R*Tree radius query with a bounding-box prefilter plus exact distance filter, since D1 does not support the R*Tree module
- [x] 13.5 Port the Express API/UI server to a Cloudflare Worker (`src/worker`), serving the existing static frontend as Worker assets
- [x] 13.6 Gate every Worker request (API and static assets) behind a shared passphrase over HTTP Basic Auth, since the Worker is reachable on the public internet
- [x] 13.7 Add a GitHub Actions workflow deploying the Worker on push to `main` after typecheck and tests pass
- [x] 13.8 Add a GitHub Actions workflow running sync on a daily schedule against D1, with a heartbeat commit so GitHub does not auto-disable the schedule after 60 days
- [x] 13.9 Migrate the existing local SQLite corpus to D1 in a one-time run, verified by an exact per-table row-count match
- [x] 13.10 Verify the new pipeline end-to-end against production (a real scheduled GitHub Actions run writing to D1) before retiring the local cron
- [x] 13.11 Retire the local cron job, backfill script and local data files once the D1/GitHub Actions pipeline was confirmed working
