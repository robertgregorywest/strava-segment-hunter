## Purpose

Derives the directional characteristics of a segment from its encoded geometry, producing the mean heading and a straightness measure that together determine whether and how strongly wind can affect a ride on that segment.

## ADDED Requirements

### Requirement: Polyline Decoding

The system SHALL decode a Strava segment's encoded polyline into an ordered sequence of latitude/longitude points.

#### Scenario: Polyline decoded accurately

- **WHEN** a segment's encoded polyline is decoded and the great-circle length of the resulting path is summed
- **THEN** that length SHALL agree with the segment's reported distance to within 1%

#### Scenario: Geometry unavailable

- **WHEN** a segment has no stored polyline
- **THEN** the system SHALL derive an approximate heading from its start and end coordinates
- **AND** SHALL mark the segment's directional data as approximate

### Requirement: Mean Bearing

The system SHALL compute a segment's mean bearing as a length-weighted circular mean of its per-leg bearings, so that headings either side of north combine correctly.

#### Scenario: Bearings spanning north

- **WHEN** a segment consists of legs bearing 350° and 010° of equal length
- **THEN** the computed mean bearing SHALL be approximately 000°
- **AND** SHALL NOT be the arithmetic mean of 180°

#### Scenario: Longer legs dominate

- **WHEN** a segment's legs differ in length
- **THEN** each leg's contribution to the mean bearing SHALL be proportional to its length

### Requirement: Directionality Metric

The system SHALL compute a directionality value between 0 and 1, being the magnitude of the length-weighted bearing vector sum divided by total path length, expressing how consistently a segment points one way.

#### Scenario: Straight segment

- **WHEN** directionality is computed for a near-straight segment
- **THEN** the value SHALL approach 1.0

#### Scenario: Out-and-back segment

- **WHEN** directionality is computed for a segment that returns along its outbound heading
- **THEN** the value SHALL approach 0.0

#### Scenario: Wind relevance signalled

- **WHEN** a segment's directionality falls below a configured threshold
- **THEN** the system SHALL mark the segment as wind-neutral
- **AND** wind-based ranking SHALL treat its projected benefit as negligible regardless of wind strength
