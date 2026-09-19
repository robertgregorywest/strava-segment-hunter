## Context

- The search results list (`web/app.js` `renderResults`) sends a click to `openDetail(segmentId)`. That fetches `/api/segments/:id` and fills the detail panel. Nothing touches the Leaflet map.
- The map shows one bearing arrow per result (plus a wind arrow) at the segment's start, all in `markersLayer`. `renderResults` clears that layer on every search.
- Sync already stores each segment's encoded polyline in `segments.polyline`. Some segments have no polyline yet (not enriched). For those, `segment-geometry` falls back to start/end and sets `geometry_approximate`.
- `src/geometry/polyline.ts` already has `decodePolyline` (precision 5, `[lat, lng]` tuples). Leaflet takes that shape directly.
- Search results carry `startLat/startLng` but no end point or polyline. The detail response (`SegmentSummary`) carries only the start point.

## Goals / Non-Goals

**Goals:**
- Center the map on selection right away, before the detail request returns.
- Draw the route once the detail arrives, then fit the map to it.
- Keep a single "selected segment" layer, managed apart from the result markers.

**Non-Goals:**
- Selecting a segment by clicking its map marker (possible follow-up).
- Drawing routes for every result at once.
- Changing the search API or its payload size.
- Elevation profiles, start/finish flags or other route decoration beyond the line.

## Decisions

**Route travels on the detail endpoint, not the search results.**
Add `route: { points: [number, number][]; approximate: boolean }` to `SegmentSummary` in `SegmentDetailService`. Selection already triggers a detail fetch, so this adds no request. Putting routes on every search result would bloat each search response with polylines the athlete mostly never looks at.
*Alternative:* add the raw encoded polyline to search results and decode it in the browser. That avoids waiting on detail, but it bloats search and puts a second polyline decoder in `web/`. Rejected.

**Decode on the server.**
The Worker already imports the tested `decodePolyline`. Sending decoded points keeps `web/app.js` free of geometry code, and the payload stays small (a segment is typically tens to a few hundred points).
*Alternative:* send the encoded string and decode it in the browser. The payload is smaller, but decoding logic gets duplicated. Rejected.

**Fallback mirrors `segment-geometry`.**
With a polyline: decode it, `approximate: false`. Without one but with both endpoints: `[[start], [end]]`, `approximate: true`. Otherwise: `points: []`, `approximate: true`. The route's `approximate` flag is set on its own terms. It doesn't reuse `geometry_approximate`, because a segment could have a stored polyline whose analysis hasn't run yet.

**Two-phase map update in the browser.**
1. On click, call `map.setView([startLat, startLng])` from the search item, keeping the current zoom, and clear any previous route. The map reacts at once even on a slow forecast fetch.
2. When detail arrives, if the athlete hasn't since selected something else (check `state.openSegmentId === segmentId`), draw `L.polyline(points)` into a dedicated `selectedRouteLayer` and call `map.fitBounds(line.getBounds(), { padding })`. If there are no points, keep the start-point centering.
The staleness guard stops a slow, earlier detail response from drawing over a later selection.

**Styling.**
Solid, high-contrast line for a full route. Dashed (`dashArray`) for an approximate one. The selected result card gets a `result-card--selected` class, toggled in one place (`openDetail` / close / `renderResults`).

**Clearing.**
`selectedRouteLayer.clearLayers()` runs on detail close and at the start of `renderResults`, alongside the existing `markersLayer.clearLayers()`. A new search doesn't close the detail panel today, and this change leaves that alone. The route goes away because the result set it belonged to has been replaced. Settings-save re-runs search and then calls `openDetail` again, so the route is cleared and redrawn, which is correct.

## Risks / Trade-offs

- [Detail fetch is slow, because it pulls the forecast] → Centering happens on click. Only the line waits for the detail, and the guard drops stale responses.
- [Detail request fails, e.g. weather error returns non-2xx] → The map stays centered on the start point. The existing error message shows in the panel.
- [Very long segments produce large point arrays] → Acceptable for a single segment. If it ever matters, simplify on the server. Not needed now.
- [The fixed detail panel covers the right of the map on desktop, and the route landed under it] → Measure how much of the map the panel covers. Add that to the `fitBounds` right padding and pan the start-point centering by half of it. When the panel covers nearly the whole map (phone width), skip the offset, since there's no visible map to offset into.

## Migration Plan

This change only adds to the API. Deploy the Worker as usual. Older UI builds ignore the new field. Rollback is a plain redeploy.
