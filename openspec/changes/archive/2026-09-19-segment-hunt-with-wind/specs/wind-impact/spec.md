## Purpose

Converts a wind forecast and a segment's geometry into a predicted elapsed time for the athlete, so that the effect of conditions on a given date can be stated in seconds against the KOM rather than as an unquantified indicator.

## ADDED Requirements

### Requirement: Wind Forecast Retrieval

The system SHALL retrieve hourly wind speed, wind direction and gust data for a segment's location from an open weather source requiring no API key.

#### Scenario: Forecast retrieved for a segment

- **WHEN** wind data is requested for a segment on a date within the forecast horizon
- **THEN** the system SHALL return hourly wind speed and direction covering that date at the segment's location

#### Scenario: Forecast cached

- **WHEN** wind data for the same location and period is requested again within its caching window
- **THEN** the system SHALL serve the cached values without a further external request

#### Scenario: Weather source unavailable

- **WHEN** the weather source cannot be reached
- **THEN** the system SHALL return segment results without wind annotation
- **AND** SHALL indicate that conditions data is unavailable rather than implying neutral wind

### Requirement: Forecast Horizon

The system SHALL only project wind impact for dates covered by an actual forecast, and SHALL NOT extrapolate beyond it.

#### Scenario: Date within horizon

- **WHEN** a target date falls within the available forecast range
- **THEN** the system SHALL produce wind-annotated results for that date

#### Scenario: Date beyond horizon

- **WHEN** a target date falls beyond the available forecast range
- **THEN** the system SHALL refuse the date and state the latest date it can project

### Requirement: Rider-Height Wind Correction

The system SHALL correct reported wind, which is measured at 10 metres, to the wind a rider experiences, and SHALL expose the correction factor as configuration.

#### Scenario: Correction applied

- **WHEN** a wind speed is used in a time projection
- **THEN** the system SHALL apply the configured roughness correction
- **AND** the corrected speed SHALL be lower than the reported 10-metre speed

### Requirement: Tailwind Component

The system SHALL resolve wind into the component acting along a segment's mean bearing, treating reported wind direction as the direction the wind blows *from*.

#### Scenario: Direct tailwind

- **WHEN** the wind blows from a direction opposite the segment's mean bearing
- **THEN** the along-segment component SHALL be positive and at its maximum magnitude

#### Scenario: Direct headwind

- **WHEN** the wind blows from the segment's mean bearing
- **THEN** the along-segment component SHALL be negative

#### Scenario: Pure crosswind

- **WHEN** the wind blows perpendicular to the segment's mean bearing
- **THEN** the along-segment component SHALL be approximately zero

### Requirement: Still-Air Power Calibration

The system SHALL estimate the athlete's sustainable power for a segment by inverting their recorded time against a physical model, correcting for the wind that prevailed when that effort was set.

#### Scenario: Effort time known with historical wind

- **WHEN** the athlete's best effort on a segment has a known start time and historical wind is available for it
- **THEN** the system SHALL subtract that wind's along-segment component before deriving still-air power

#### Scenario: Effort time known without precise timestamp

- **WHEN** only the date of the effort is known
- **THEN** the system SHALL derive power without a wind correction
- **AND** SHALL mark the resulting projection as lower confidence

#### Scenario: No personal baseline

- **WHEN** a segment has no recorded effort by the athlete
- **THEN** the system SHALL NOT report a gap to KOM for it

### Requirement: Predicted Time Projection

The system SHALL predict elapsed time under given wind using a model in which aerodynamic drag varies with the cube of speed and gravitational resistance varies with gradient, so that wind benefit diminishes on steep, slow segments without special-casing.

#### Scenario: Tailwind on a flat fast segment

- **WHEN** a tailwind is applied to a flat segment ridden at high speed
- **THEN** the predicted time SHALL decrease substantially relative to still air

#### Scenario: Same tailwind on a steep climb

- **WHEN** the same tailwind is applied to a steep segment ridden at low speed
- **THEN** the predicted time SHALL decrease by a markedly smaller proportion than on the flat segment

#### Scenario: Projection expressed against KOM

- **WHEN** a predicted time is produced for a segment with a known KOM time
- **THEN** the system SHALL report the signed difference between predicted time and KOM time in seconds

### Requirement: Model Assumptions Disclosed

The system SHALL make the physical assumptions behind any projection inspectable, since predictions depend on estimated rider parameters.

#### Scenario: Projection inspected

- **WHEN** an athlete inspects a projected time
- **THEN** the system SHALL disclose the rider mass, drag area, rolling resistance and roughness correction used
- **AND** SHALL allow those values to be configured
