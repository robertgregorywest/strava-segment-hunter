# strava-sync Specification

## Purpose

Maintains a durable local corpus of the athlete's ridden Strava segments by authenticating against the Strava v3 API, backfilling the complete activity history, and keeping that corpus current — all while staying within Strava's read quotas.

## Requirements

### Requirement: OAuth Authorization

The system SHALL obtain a Strava access token via the OAuth authorization-code flow requesting the scopes `read`, `read_all` and `activity:read_all`.

#### Scenario: Authorization succeeds

- **WHEN** the athlete completes the Strava consent screen
- **THEN** the system SHALL exchange the returned code for an access token and a refresh token
- **AND** SHALL persist both outside version control

#### Scenario: Insufficient scope granted

- **WHEN** the returned grant omits `activity:read_all`
- **THEN** the system SHALL report which capabilities are unavailable and SHALL NOT begin a backfill

### Requirement: Token Refresh

The system SHALL refresh the access token before expiry without athlete interaction.

#### Scenario: Token near expiry

- **WHEN** a request is attempted and the access token expires within 300 seconds
- **THEN** the system SHALL exchange the refresh token for a new access token before issuing the request
- **AND** SHALL persist the newly returned refresh token, which may differ from the previous one

#### Scenario: Refresh token rejected

- **WHEN** Strava rejects the refresh token
- **THEN** the system SHALL halt sync and surface that re-authorization is required

### Requirement: Read Quota Budgeting

The system SHALL remain within Strava's advertised read limits and SHALL NOT rely on receiving `429` to discover it has exhausted them.

#### Scenario: Limits read from response headers

- **WHEN** any Strava response is received
- **THEN** the system SHALL record `X-ReadRateLimit-Limit` and `X-ReadRateLimit-Usage`
- **AND** SHALL treat those values as authoritative over any configured default

#### Scenario: Short-window budget approached

- **WHEN** 15-minute read usage reaches 90% of its limit
- **THEN** the system SHALL pause further requests until the window rolls over

#### Scenario: Daily budget exhausted

- **WHEN** daily read usage reaches its limit
- **THEN** the system SHALL suspend the backfill, persist progress, and resume on the next day without repeating completed work

#### Scenario: Rate limited despite budgeting

- **WHEN** Strava returns HTTP 429
- **THEN** the system SHALL retry with exponential backoff and SHALL NOT treat the affected item as permanently failed

### Requirement: Full Activity Backfill

The system SHALL enumerate the athlete's entire activity history and record every segment effort contained in it.

#### Scenario: Backfill enumerates all activities

- **WHEN** a backfill is started for an athlete with 3,872 activities
- **THEN** the system SHALL page through the complete activity list
- **AND** SHALL fetch each activity's segment efforts

#### Scenario: Backfill is resumable

- **WHEN** a backfill is interrupted by quota exhaustion, error or shutdown
- **THEN** the system SHALL record which activities have been processed
- **AND** on restart SHALL process only the remainder

#### Scenario: Effort data captured

- **WHEN** an activity's segment efforts are retrieved
- **THEN** the system SHALL persist for each effort the segment identifier, elapsed time, start date, and the `pr_rank` and `kom_rank` values where present

#### Scenario: Repeated segments deduplicated

- **WHEN** the same segment appears in efforts across multiple activities
- **THEN** the system SHALL store one segment record and retain each effort against it

### Requirement: Incremental Sync

The system SHALL bring the corpus up to date without re-running a full backfill.

#### Scenario: New activities since last sync

- **WHEN** an incremental sync runs
- **THEN** the system SHALL retrieve only activities recorded after the most recent known activity
- **AND** SHALL add their segment efforts to the corpus

### Requirement: Starred Segment Ingestion

The system SHALL ingest the athlete's starred segments as an additional corpus source, because segments never ridden cannot otherwise enter the corpus.

#### Scenario: Starred segments retrieved

- **WHEN** a sync runs
- **THEN** the system SHALL retrieve the athlete's starred segments
- **AND** SHALL add any not already present

#### Scenario: Starred segment without an effort

- **WHEN** a starred segment has no recorded effort by the athlete
- **THEN** the system SHALL retain it in the corpus and mark it as having no personal baseline

### Requirement: Segment Detail Enrichment

The system SHALL fetch full segment detail only for segments that require it, since segment efforts do not carry geometry or KOM time.

#### Scenario: Enrichment requested for a segment

- **WHEN** a segment lacking detail is selected for enrichment
- **THEN** the system SHALL retrieve and persist its polyline, KOM time from `xoms`, personal record from `athlete_segment_stats`, distance, average grade and elevation figures

#### Scenario: Enrichment is prioritized

- **WHEN** more segments need enrichment than the remaining quota allows
- **THEN** the system SHALL enrich segments nearer the athlete's configured home location first

### Requirement: Corpus Field Freshness

The system SHALL refresh stored fields according to how volatile each is, rather than refetching whole segments indiscriminately.

#### Scenario: Immutable geometry

- **WHEN** a segment's polyline, distance or gradient has been stored
- **THEN** the system SHALL NOT refetch those fields

#### Scenario: KOM time staleness

- **WHEN** a segment's stored KOM time is older than its configured freshness window
- **THEN** the system SHALL mark it for re-enrichment
- **AND** SHALL present the value as stale until refreshed

### Requirement: Credential Protection

The system SHALL keep Strava credentials out of version control.

#### Scenario: Secrets excluded

- **WHEN** credentials or tokens are written to disk
- **THEN** they SHALL be stored in paths excluded by version control
