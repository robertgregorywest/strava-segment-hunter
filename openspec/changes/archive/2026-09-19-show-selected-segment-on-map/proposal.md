## Why

Selecting a segment in the search results opens its detail panel, but the map doesn't change. The athlete can't see where the segment is or what shape it has. That matters for a wind tool: the route shape is what decides whether a forecast wind helps. Today the only map cue is a start-point arrow, which is one of many markers and isn't linked to the selected card.

## What Changes

- Selecting a search result centers the map on that segment and draws its route as a highlighted line.
- The segment detail API response gains the segment's route: the decoded polyline as an ordered list of lat/lng points. When no polyline is stored, it falls back to a straight start→end line flagged as approximate.
- Only one segment is drawn at a time. Selecting another result replaces the drawn route. Closing the detail panel or running a new search removes it.
- The selected result card is visually marked as selected.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `segment-search`: The Segment Detail View requirement gains the segment's route geometry. A new requirement covers showing the selected segment on the map (centering, drawing and clearing the route).

## Impact

- `src/search/segmentDetailService.ts`: `SegmentSummary` gains the route points (decoded with `src/geometry/polyline.ts`, falling back to start/end).
- `src/worker/index.ts`: `/api/segments/:id` returns the extra field. The route stays the same, and the change only adds a field.
- `web/app.js` / `web/styles.css`: a Leaflet polyline layer for the selected segment, map centering on selection, selected-card styling.
- `test/segmentDetail.test.ts`: coverage for the route field and the approximate fallback.
- No schema, sync or dependency changes. Polylines are already stored in `segments.polyline`.
