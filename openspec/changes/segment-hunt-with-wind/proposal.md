## Why

On a flat, fast Strava segment the wind is the single largest variable in elapsed time — larger than fitness, tyres or position. A spike against segment 1470768 (*Forest Hill – Horton Turn*, 3538 m @ 0.9%, KOM 5:06) measured a **63-second spread across a single week's forecast** on a 306-second segment: 290 s with a quartering SSW tailwind, 353 s into a WNW headwind. That is over 20% swing on a segment the athlete currently holds the KOM for.

Strava exposes the KOM time (`xoms.kom`), the athlete's PR (`athlete_segment_stats`) and full segment geometry (`map.polyline`), but offers nothing about conditions. Open-Meteo provides free hourly wind with no API key. Nothing joins the two. This change builds a personal tool that does: search your ridden segments near a location, ranked by how close you are to the KOM, with each result annotated by the wind impact on a chosen target date.

## What Changes

- **New**: OAuth against the Strava v3 API (`read`, `read_all`, `activity:read_all`) with refresh-token rotation.
- **New**: Full backfill of the athlete's activity history (3,872 rides) to build a local segment corpus, plus incremental sync for new activities.
- **New**: A rate-limit budgeter that keeps the crawler inside Strava's 200/15-min and 2,000/day read limits and resumes across days.
- **New**: Segment geometry analysis — polyline decode, length-weighted circular mean bearing, and a **directionality** metric (1.0 = straight, 0 = out-and-back) identifying which segments wind actually affects.
- **New**: A physical wind model that inverts the athlete's PR for still-air power, then re-solves predicted time under forecast wind — so aerodynamic benefit scales correctly with speed and gradient rather than being applied as a flat bonus.
- **New**: Search over the corpus filtered by proximity, gap-to-KOM, `kom_rank`, distance, gradient and directionality, with a target-date picker driving the wind annotation on every result.
- **Constraint discovered**: `GET /segments/explore` returns **HTTP 401 for standard API applications** even with `read_all` granted, and is therefore unavailable. Segment discovery comes from ridden history plus `/segments/starred` instead. Discovering never-ridden segments is out of scope.

## Capabilities

### New Capabilities

- `strava-sync`: OAuth token lifecycle, full activity backfill, incremental sync, segment corpus persistence, and rate-limit budgeting against Strava's read quotas.
- `segment-geometry`: Polyline decoding, per-leg bearing, length-weighted circular mean bearing, and the directionality metric.
- `wind-impact`: Open-Meteo forecast and archive retrieval, roughness correction from 10 m to rider height, still-air power calibration from a PR, and predicted-time projection under given wind.
- `segment-search`: Query and ranking over the corpus by proximity and segment criteria, with target-date wind annotation on each result.

### Modified Capabilities

None — this is a greenfield project with no existing specs.

## Impact

- **External APIs**: Strava v3 (authenticated, rate-limited, quota-bearing); Open-Meteo forecast and archive (free, keyless, fair-use).
- **Data**: A local persistent store is required — the corpus outlives any single session and the backfill spans multiple days. Needs spatial querying over segment start points.
- **Secrets**: Strava client ID/secret and refresh token must stay out of version control.
- **Scope boundaries**: Single-athlete personal tool. KOM *defence* alerting is explicitly out of scope. Target dates are capped at the wind-forecast horizon; no climatology fallback in this change.
- **Strava API terms**: Cached athlete data is the authenticated athlete's own. No third-party athlete data is stored beyond the public KOM time already surfaced by `xoms`.
