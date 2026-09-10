import { describe, expect, it } from 'vitest';
import { analyzeSegmentGeometry, isWindNeutral, legsFromPoints, meanBearingAndDirectionality } from '../src/geometry/analysis.js';
import { bearingDegrees, distanceMeters } from '../src/geometry/haversine.js';
import { decodePolyline } from '../src/geometry/polyline.js';

describe('decodePolyline', () => {
  it('decodes the canonical Google polyline example', () => {
    // Published reference vector for the encoded-polyline algorithm.
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toHaveLength(3);
    expect(points[0]?.[0]).toBeCloseTo(38.5, 4);
    expect(points[0]?.[1]).toBeCloseTo(-120.2, 4);
    expect(points[1]?.[0]).toBeCloseTo(40.7, 4);
    expect(points[1]?.[1]).toBeCloseTo(-120.95, 4);
    expect(points[2]?.[0]).toBeCloseTo(43.252, 4);
    expect(points[2]?.[1]).toBeCloseTo(-126.453, 4);
  });
});

describe('legsFromPoints', () => {
  it('computes a bearing and positive length per consecutive pair', () => {
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    const legs = legsFromPoints(points);
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(leg.lengthM).toBeGreaterThan(0);
      expect(leg.bearingDeg).toBeGreaterThanOrEqual(0);
      expect(leg.bearingDeg).toBeLessThan(360);
    }
  });
});

describe('meanBearingAndDirectionality', () => {
  it('averages bearings spanning north to ~000°, not the arithmetic mean of 180°', () => {
    const { bearingDeg } = meanBearingAndDirectionality([
      { bearingDeg: 350, lengthM: 100 },
      { bearingDeg: 10, lengthM: 100 },
    ]);
    expect(bearingDeg).toBeLessThan(2);
    // A naive arithmetic mean would give 180 — assert we're nowhere near it.
    expect(Math.abs(bearingDeg - 180)).toBeGreaterThan(170);
  });

  it('weights longer legs more heavily in the mean bearing', () => {
    const { bearingDeg } = meanBearingAndDirectionality([
      { bearingDeg: 0, lengthM: 900 },
      { bearingDeg: 90, lengthM: 100 },
    ]);
    // Dominated by the 0° leg, but nudged slightly toward 90°.
    expect(bearingDeg).toBeGreaterThan(0);
    expect(bearingDeg).toBeLessThan(15);
  });

  it('approaches 1.0 for a straight segment', () => {
    const { directionality } = meanBearingAndDirectionality([
      { bearingDeg: 90, lengthM: 100 },
      { bearingDeg: 90, lengthM: 100 },
      { bearingDeg: 91, lengthM: 100 },
    ]);
    expect(directionality).toBeGreaterThan(0.99);
  });

  it('approaches 0.0 for an out-and-back segment', () => {
    const { directionality } = meanBearingAndDirectionality([
      { bearingDeg: 90, lengthM: 100 },
      { bearingDeg: 270, lengthM: 100 },
    ]);
    expect(directionality).toBeLessThan(0.01);
  });
});

describe('isWindNeutral', () => {
  it('flags directionality below the configured threshold', () => {
    expect(isWindNeutral(0.2, 0.5)).toBe(true);
    expect(isWindNeutral(0.8, 0.5)).toBe(false);
  });
});

describe('analyzeSegmentGeometry', () => {
  it('falls back to the start/end bearing and marks it approximate when no polyline exists', () => {
    const result = analyzeSegmentGeometry(null, [51.5, -0.1], [51.6, -0.05]);
    expect(result?.approximate).toBe(true);
    expect(result?.bearingDeg).toBeCloseTo(bearingDegrees(51.5, -0.1, 51.6, -0.05), 6);
  });

  it('uses the full polyline when available and marks it precise', () => {
    const result = analyzeSegmentGeometry('_p~iF~ps|U_ulLnnqC_mqNvxq`@', null, null);
    expect(result?.approximate).toBe(false);
  });

  it('returns undefined when there is no geometry at all', () => {
    expect(analyzeSegmentGeometry(null, null, null)).toBeUndefined();
  });
});

describe('haversine distanceMeters', () => {
  it('is symmetric and zero for coincident points', () => {
    expect(distanceMeters(51.5, -0.1, 51.5, -0.1)).toBeCloseTo(0, 6);
    const a = distanceMeters(51.5, -0.1, 51.6, -0.05);
    const b = distanceMeters(51.6, -0.05, 51.5, -0.1);
    expect(a).toBeCloseTo(b, 6);
  });
});
