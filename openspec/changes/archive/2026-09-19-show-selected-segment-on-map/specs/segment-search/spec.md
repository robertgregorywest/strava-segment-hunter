## MODIFIED Requirements

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

## ADDED Requirements

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
