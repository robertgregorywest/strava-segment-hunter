## Context

See proposal.md — Why. This section records only what the exploratory spike established, since several decisions below exist because of it.

Measured against the live Strava v3 API with a token carrying `read`, `read_all` and `activity:read_all`:

| Probe | Result |
|---|---|
| `GET /segments/{id}` → `xoms.kom` | present (`"5:06"`), undocumented but live |
| `GET /segments/{id}` → `athlete_segment_stats` | present (`pr_elapsed_time`, `effort_count`) |
| `GET /segments/{id}` → `map.polyline` | present; decodes to within 0.1% of reported distance |
| `GET /activities/{id}?include_all_efforts=true` | 30 efforts from one 28 km ride; carries `pr_rank`, `kom_rank`; **no geometry** |
| `GET /segments/starred` | 200; 109 segments |
| **`GET /segments/explore`** | **401 with every bbox shape, quota still consumed** |
| Read quota | 200 / 15 min, 2,000 / day |
| Corpus size | 3,872 rides, 162,366 km |

A worked end-to-end run on segment 1470768 (3538 m @ 0.9%, KOM 306 s) produced a mean bearing of 319.3°, directionality 0.968, and a **63-second spread** in projected time across one week of forecast — from 290 s on a quartering SSW tailwind to 353 s into a WNW headwind.

## Goals / Non-Goals

**Goals:**

- Keep the corpus usable while incomplete — the backfill spans days, so search must work against partial data from the first hour.
- Make every projection inspectable and its assumptions adjustable, because the physical model rests on estimated rider parameters.
- Separate what is measured from what is modelled, so a stale KOM or an uncalibrated power figure is never presented as fact.

**Non-Goals:**

- Multi-athlete support. A single-athlete tool means the read quota belongs to one user and needs no fair-share logic.
- Real-time updates. Wind forecasts change hourly at best; nothing here needs to be live.
- Route planning or navigation. This ranks segments; it does not link them.

## Decisions

### Corpus is built from ridden history plus starred segments

`GET /segments/explore` is the only API route to segments the athlete has never ridden, and it returns 401 for standard applications. The corpus is therefore assembled from `GET /activities/{id}?include_all_efforts=true` across the full history, plus `GET /segments/starred`.

*Rationale:* the loss is narrower than it appears. Gap-to-KOM requires a personal baseline, and a segment never ridden has none — so the unreachable segments were largely unsearchable in the terms this tool cares about. Starring a segment in the Strava app is the athlete's manual escape hatch into the corpus.

*Alternatives considered:* scraping Strava's web segment explorer (violates the API terms — rejected); enumerating segment IDs (abusive and quota-infeasible — rejected).

### Two-phase sync, with spatial filtering between the phases

```
  phase 1  /athlete/activities?per_page=200        ~20 calls
           /activities/{id}?include_all_efforts    1 per activity   ← 3,872 calls
                    │
                    ▼  segment stubs: id, start_latlng, distance, grade, kom_rank
           ─────────────────────────────────────────────────────────────────
                    │  FILTER on proximity + personal best      free, local
                    ▼
  phase 2  /segments/{id}                          1 per shortlisted segment
                       polyline · xoms.kom · athlete_segment_stats
```

Effort payloads carry `start_latlng` but no geometry, which is precisely the split that makes this affordable: the corpus can be spatially narrowed for free before any enrichment call is spent.

*Rationale:* phase 1 is a fixed ~3,872-call cost, roughly two days at the 2,000/day read limit. Phase 2 is unbounded in principle but is ordered by distance from home, so the segments that matter are enriched on day one.

*Alternatives considered:* enriching every segment encountered (multiplies phase 2 by an unknown factor for segments ridden once on holiday — rejected); enriching lazily at search time (a search would block on dozens of API calls — rejected).

### SQLite locally, Cloudflare D1 in production, behind one `SqlBackend` interface

Sync (GitHub Actions) and the search API/UI (a Cloudflare Worker) both write and read the same corpus through `src/db/backend.ts`'s `SqlBackend` interface (`run`/`all`/`get`/`batch`), with three implementations: `SqliteBackend` (better-sqlite3, local dev/test), `D1HttpBackend` (D1's HTTP API, used by the Node-side sync script and GitHub Actions), and `D1WorkerBackend` (D1's native binding, used inside the Worker). All three run identical SQL, so dev/test never drifts from what production executes.

D1 does not support the R\*Tree virtual table module, so the radius query (`Repository.segmentsWithinRadius`) uses a plain `(start_lat, start_lng)` B-tree index as a bounding-box prefilter, then an exact haversine distance filter over the candidates — the same two-step shape R\*Tree would have produced, just without a true 2D spatial index accelerating the prefilter. At this corpus size (~14k segments) the difference is immaterial; it would only matter if the corpus grew by orders of magnitude.

*Rationale:* a single file with no server was right for a personal tool, but running it only on one machine meant sync depended on that machine being on, awake, and past macOS's Full Disk Access/cron quirks. D1 lets sync run on a schedule in GitHub Actions and the API run in a Worker, with neither depending on local infrastructure, while keeping the "no server to operate" property — D1 is not something we provision or patch. Local dev keeps plain SQLite so day-to-day iteration and tests don't touch production data or need network access.

*Alternatives considered:* PostGIS (over-provisioned; also a server to operate); DuckDB (analytics-oriented; the workload here is transactional crawl-and-update); keeping SQLite-on-one-machine and just fixing the cron scheduling (rejected — still a single point of failure and still requires the machine to be reachable for both sync and the web UI).

### The Worker is public and gated by a shared passphrase

Moving the API/UI off a machine on the local network onto a `workers.dev` URL means it is reachable from the public internet. Since this stores one athlete's own Strava data, every request — API and static assets alike — is checked against `PASSPHRASE_HASH` (PBKDF2-HMAC-SHA-256, `src/worker/passphrase.ts`) over HTTP Basic Auth before it's served. The passphrase itself is never persisted anywhere or typed where it could reach shell history or an assistant's context; only its hash is set as a Worker secret.

*Alternatives considered:* Cloudflare Access (adds an external IdP dependency for a single-user tool — deferred, not rejected); deploying with no auth (rejected outright — would expose ride history and home-area segments publicly).

### Bearing as a length-weighted circular mean

Per-leg bearings are summed as unit vectors scaled by leg length; the mean is the vector's argument. Arithmetic averaging is wrong across the 0°/360° discontinuity — legs of 350° and 010° must average to 000°, not 180°.

The same vector sum yields **directionality** — its magnitude over total path length — for free. This is load-bearing, not decorative: it distinguishes segments where wind is decisive (0.968 on the worked example) from out-and-backs where it cancels, and prevents the ranking from promoting loops on windy days.

### Wind enters through the aerodynamic term only

Predicted time is obtained by solving for the speed at which required power equals the athlete's estimated sustainable power:

```
P = ( Crr·m·g·cosθ + m·g·sinθ )·v  +  ½·ρ·CdA·(v + v_head)²·v
                                       └── wind enters only here ──┘
```

Solved numerically by bisection over speed; the function is monotonic in `v`, so this converges reliably and avoids a closed-form cubic.

*Rationale:* modelling wind physically rather than as a scored bonus makes the gradient behaviour fall out for free. Drag scales with the cube of speed, so a tailwind transforms a 41.6 km/h flat segment and barely touches a 12% climb — with no special-casing and no hand-tuned weighting.

*Alternatives considered:* a heuristic tailwind score (would rank climbs as attractive on windy days — rejected).

### Power calibrated against the wind that prevailed at the PR

Inverting a PR for power assumes still air. The spike's own worked example implied 429 W, which is plausible only if that PR was genuinely windless — and it likely was not. `activity:read_all` yields `pr_activity_id` and therefore the effort's start time, which the Open-Meteo archive can resolve to actual historical wind. Subtracting that wind's along-segment component before deriving power closes the loop.

Where the timestamp is unavailable, power is derived uncorrected and the projection is flagged lower-confidence rather than silently trusted.

### Open-Meteo, capped at the forecast horizon

Free, keyless, hourly wind speed, direction and gusts, with a matching archive API for calibration. Target dates beyond the forecast horizon are rejected outright.

*Rationale:* beyond the horizon only climatology exists, and "SW winds on 60% of April days" is a categorically weaker claim than a projected time. Mixing the two under one date picker would make the strong claim untrustworthy.

*Alternatives considered:* OpenWeatherMap (needs a key, tighter free tier); climatology fallback (deferred — a later change, not silently blended in).

### Roughness correction as configuration, not a constant

Reported wind is at 10 m; a rider sits at roughly 1.5 m among hedgerows and buildings. The spike used 0.55. This is the largest single error term in the model, so it is exposed as configuration alongside mass, CdA and Crr.

## Risks / Trade-offs

- **The 401 on `/segments/explore` may be app-specific rather than a blanket restriction** → The corpus design does not depend on knowing which. Confirm on Strava's developer forum; if the endpoint is later granted, it becomes an additive corpus source requiring no redesign.
- **Roughness correction dominates model error** → Configurable, and calibratable by back-fitting against efforts whose historical wind is known.
- **PR-derived power conflates fitness with conditions** → Archive-wind correction where a timestamp exists; explicit lower-confidence marking where it does not.
- **Phase 1 costs ~2 days before the corpus is complete** → Search operates on partial data from the first hour; enrichment is ordered by proximity to home so local segments arrive first.
- **KOM times drift** → Stored with a freshness window and surfaced as stale rather than silently trusted.
- **`xoms` is undocumented and could be withdrawn** → Gap-to-KOM degrades to absent rather than wrong; `kom_rank` from effort data remains as an independent signal.
- **Strava API terms constrain data retention** → Only the authenticated athlete's own data is stored; the sole third-party datum is the public KOM time already exposed by `xoms`.
- **D1's free tier caps writes at 100,000 rows/day** → Day-to-day incremental sync stays well under this, but a full re-backfill of the corpus (~190,000 `segment_efforts` rows alone) would need to be spread across more than one day, or run against a paid plan.
- **Two independent sync paths (local file-based tokens, D1-based tokens) briefly ran concurrently against the same Strava app during the hosting migration** → risked one side breaking the other if Strava rotated the refresh token mid-migration. No rotation occurred; the local cron was retired promptly once the D1 path was verified, rather than leaving both running indefinitely.

## Migration Plan

Greenfield — no migration. Delivery is sequenced so each phase is independently useful:

1. **Sync** — OAuth, quota budgeter, phase 1 backfill. Verifiable by corpus counts against the known 3,872 rides.
2. **Geometry** — enrichment plus bearing and directionality. Verifiable against the worked example: 319.3°, 0.968, path length within 1% of 3538 m.
3. **Wind** — Open-Meteo, calibration, projection. Verifiable by reproducing the 290 s / 353 s spread.
4. **Search UI** — map, filters, date picker.
5. **Hosting migration** (post-launch) — moved sync from a local macOS cron job to GitHub Actions and the corpus from local SQLite to Cloudflare D1, once the local-only version had already proven the model end-to-end. The one-time data migration copied all rows from the local SQLite file to D1 and was verified by an exact per-table row-count match; the local cron was only retired once a real scheduled GitHub Actions run had written to production D1 successfully.

Rollback is discarding the SQLite file (local dev) or the D1 database (production) and re-running sync from Strava; nothing is written back to Strava.

## Open Questions

- Default rider mass and CdA pending the athlete's real figures — affects projection accuracy but no interface or schema.
- Whether gusts should widen a projection into a range rather than a point estimate.
- Whether historical wind for calibration should be fetched during backfill or lazily on first projection.
