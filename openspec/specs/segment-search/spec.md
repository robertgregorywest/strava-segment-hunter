# segment-search Specification

## Purpose

Lets the athlete find segments worth attacking by searching their corpus near a location, narrowing by how attainable the KOM is, and seeing the wind's effect on every result for a chosen target date.

## Requirements

### Requirement: Proximity Search

The system SHALL return segments from the corpus whose start point lies within a specified radius of a specified location.

#### Scenario: Search around a location

- **WHEN** the athlete searches with a location and radius
- **THEN** the system SHALL return only corpus segments whose start point lies within that radius
- **AND** SHALL report each segment's distance from the search location

#### Scenario: Default location

- **WHEN** the athlete searches without specifying a location
- **THEN** the system SHALL use their configured home location

#### Scenario: No segments in range

- **WHEN** no corpus segments fall within the radius
- **THEN** the system SHALL return an empty result and state that the corpus holds no ridden segments in that area

### Requirement: Segment Filters

The system SHALL allow results to be narrowed by segment and performance criteria, combinable in a single search.

#### Scenario: Filter by gap to KOM

- **WHEN** the athlete filters for segments within a given number of seconds of the KOM
- **THEN** only segments whose personal record falls within that margin SHALL be returned

#### Scenario: Filter by existing leaderboard rank

- **WHEN** the athlete filters for segments where they hold a top-ten position
- **THEN** only segments with a recorded `kom_rank` within that range SHALL be returned

#### Scenario: Filter by segment shape

- **WHEN** the athlete filters by distance, average gradient or directionality
- **THEN** only segments satisfying every supplied bound SHALL be returned

#### Scenario: Filters combined

- **WHEN** multiple filters are supplied
- **THEN** the system SHALL return only segments satisfying all of them

### Requirement: Target Date Selection

The system SHALL let the athlete choose the date the search results are evaluated for.

#### Scenario: Target date chosen

- **WHEN** the athlete selects a target date within the forecast horizon
- **THEN** every returned segment SHALL be annotated with wind impact for that date

#### Scenario: No date chosen

- **WHEN** no target date is supplied
- **THEN** the system SHALL evaluate results for the current day

#### Scenario: Date beyond forecast horizon

- **WHEN** the athlete selects a date beyond the forecast horizon
- **THEN** the system SHALL reject the selection and state the latest selectable date

### Requirement: Wind-Annotated Results

The system SHALL annotate each search result with the wind's effect on that segment for the target date.

#### Scenario: Result annotation

- **WHEN** a segment is returned for a target date
- **THEN** the result SHALL show the segment's mean bearing, the best wind conditions available that day, the projected elapsed time and the signed difference against the KOM

#### Scenario: Wind-neutral segment

- **WHEN** a returned segment's directionality is below the wind-neutral threshold
- **THEN** the result SHALL indicate that wind has little bearing on it rather than showing a misleading projected benefit

#### Scenario: Stale or missing KOM

- **WHEN** a segment's KOM time is stale or absent
- **THEN** the result SHALL indicate this rather than presenting a gap computed from unavailable data

### Requirement: Result Ranking

The system SHALL order results by how attainable the KOM is on the target date.

#### Scenario: Ranked by projected margin

- **WHEN** results are returned for a target date
- **THEN** segments SHALL be ordered by projected time against KOM, with the most attainable first

#### Scenario: Alternative ordering

- **WHEN** the athlete chooses to order by distance from the search location, segment length or gradient
- **THEN** the system SHALL reorder accordingly while retaining the wind annotations

### Requirement: Segment Detail View

The system SHALL provide, for a single segment, the hour-by-hour wind outlook across the forecast horizon so the athlete can choose when to attempt it, together with the segment's route geometry.

#### Scenario: Hourly outlook

- **WHEN** the athlete opens a segment's detail
- **THEN** the system SHALL show projected elapsed time per hour across the forecast horizon
- **AND** SHALL identify the hours with the fastest projected times

#### Scenario: Ideal wind direction stated

- **WHEN** a segment's detail is shown
- **THEN** the system SHALL state the wind direction that would most assist it

#### Scenario: Personal history shown

- **WHEN** a segment's detail is shown
- **THEN** the system SHALL show the athlete's personal record, effort count, best leaderboard rank achieved, and the current KOM time

#### Scenario: Route geometry provided

- **WHEN** a segment's detail is requested and the segment has a stored polyline
- **THEN** the response SHALL include the segment's route as an ordered sequence of latitude/longitude points decoded from that polyline, running from start to finish

#### Scenario: Route geometry approximated

- **WHEN** a segment's detail is requested and the segment has no stored polyline but has start and end coordinates
- **THEN** the response SHALL include a two-point route from the start to the end coordinates
- **AND** SHALL mark the route as approximate

#### Scenario: Route geometry unavailable

- **WHEN** a segment's detail is requested and the segment has neither a stored polyline nor both start and end coordinates
- **THEN** the response SHALL include an empty route rather than failing

### Requirement: Selected Segment On Map

The system SHALL show the segment the athlete selects from the search results on the map by centering the map on it and drawing its route.

#### Scenario: Result selected

- **WHEN** the athlete selects a segment in the search results
- **THEN** the map SHALL center on that segment
- **AND** SHALL draw the segment's route as a line distinct from the other result markers
- **AND** the map SHALL zoom so the whole route is visible

#### Scenario: Approximate route drawn

- **WHEN** the selected segment's route is approximate
- **THEN** the drawn line SHALL be visibly distinguishable from a full route (e.g. dashed)

#### Scenario: No route available

- **WHEN** the selected segment has no route but has a start point
- **THEN** the map SHALL center on the start point without drawing a line

#### Scenario: Another result selected

- **WHEN** the athlete selects a different segment while one is already shown
- **THEN** the previously drawn route SHALL be removed and only the newly selected segment's route SHALL be drawn

#### Scenario: Selection cleared

- **WHEN** the athlete closes the segment detail or runs a new search
- **THEN** the drawn route SHALL be removed from the map

#### Scenario: Selected result indicated

- **WHEN** a segment is selected
- **THEN** its entry in the search results SHALL be visibly marked as selected, and no other entry SHALL be
