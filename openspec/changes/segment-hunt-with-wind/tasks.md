## 1. Project Scaffolding

- [x] 1.1 Initialise a TypeScript/Node project with strict compiler settings, linting and a test runner
- [x] 1.2 Split the workspace into a sync/worker entry point, a query/API layer and a web UI
- [x] 1.3 Add configuration loading for Strava credentials, home location and rider parameters (mass, CdA, Crr, roughness factor), sourced from environment and excluded from version control
- [x] 1.4 Confirm `.gitignore` covers `.env`, token files and the SQLite database

## 2. Persistence

- [x] 2.1 Create the SQLite schema: activities, segments, segment_efforts, and sync progress
- [x] 2.2 Add an R*Tree index over segment start coordinates for radius queries
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
- [ ] 5.7 Verify the completed backfill against the known corpus size of 3,872 rides — requires running the real backfill against the live Strava API; not executable in this environment (see final summary)

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
- [ ] 7.7 Verify against segment 1470768: bearing ~319.3°, directionality ~0.968, path length within 1% of 3538 m — requires live Strava data; see `scripts/verify-segment.ts` and final summary

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
- [ ] 9.9 Verify against segment 1470768 that a week of forecast reproduces a spread of roughly 290 s to 353 s — requires live Strava + Open-Meteo data; see `scripts/verify-segment.ts` and final summary

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

- [ ] 12.1 Confirm search works against a partially complete corpus during backfill — requires running `npm run sync:backfill` against the live Strava API and querying mid-run; not executable in this environment (see final summary)
- [ ] 12.2 Confirm an interrupted and resumed backfill neither repeats nor omits activities — requires interrupting a live `npm run sync:backfill` and resuming it; not executable in this environment (see final summary)
- [ ] 12.3 Confirm sustained crawling never exceeds the 15-minute or daily read limits — requires observing real `X-ReadRateLimit-*` headers over a sustained live backfill; not executable in this environment (see final summary)
- [ ] 12.4 Re-check whether `/segments/explore` remains unavailable, and record the finding — requires a live authenticated call to the Strava API; not executable in this environment (see final summary)
