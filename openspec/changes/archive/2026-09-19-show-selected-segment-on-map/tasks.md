## 1. Route geometry in segment detail

- [x] 1.1 Add `route: { points: [number, number][]; approximate: boolean }` to `SegmentSummary` in `src/search/segmentDetailService.ts`, and populate it in every return path. Decode `segment.polyline` with `decodePolyline`. With no polyline, fall back to `[[start_lat, start_lng], [end_lat, end_lng]]` marked approximate. With neither, use `points: []`, approximate.
- [x] 1.2 In `test/segmentDetail.test.ts`, test all three cases: polyline decoded (first and last points match start and end, `approximate: false`), start/end fallback (two points, `approximate: true`), and no geometry (empty route, no throw)
- [x] 1.3 Confirm `/api/segments/:id` in `src/worker/index.ts` passes the new field through unchanged. Run `npm test` and typecheck.

## 2. Map behaviour on selection

- [x] 2.1 In `web/app.js`, add a `selectedRouteLayer` layer group next to `markersLayer`, and a helper that clears it
- [x] 2.2 In the result-card click handler / `openDetail`, clear any previous route. Then `map.setView` on the item's start point, keeping the current zoom, when the start point is known.
- [x] 2.3 After the detail loads, and only if `state.openSegmentId` still matches, draw `L.polyline(detail.segment.route.points)`: solid for a full route, dashed for an approximate one. Then `map.fitBounds` with padding. Draw nothing if there are no points.
- [x] 2.4 Clear the route on detail close and at the start of `renderResults`
- [x] 2.5 Toggle a `result-card--selected` class so only the open segment's card is marked. Set it on select, and clear it on close and on re-render (re-applying it if the open segment is still in the results).
- [x] 2.6 Add styles in `web/styles.css` for `result-card--selected` and, if needed, the route line colour, so it reads in the existing theme

## 3. Verification

- [x] 3.1 Browser-verify with `playwright-cli` against a `wrangler dev --port 8799` server (per CLAUDE.md). Select a result, and confirm the map recenters, the route draws, and the card is marked. Select another and confirm it replaces the first. Close the detail and confirm the route is cleared. Check that the console shows no errors apart from the `favicon.ico` 404. If the local D1 has no corpus, report that the data-dependent paths weren't exercised.
- [x] 3.2 Close the browser and stop the 8799 server
