import { bearingDegrees, distanceMeters } from './haversine.js';
import { decodePolyline, type LatLng } from './polyline.js';

export interface Leg {
  bearingDeg: number;
  lengthM: number;
}

export interface GeometryResult {
  bearingDeg: number;
  /** 1.0 = straight, 0.0 = out-and-back. */
  directionality: number;
  pathLengthM: number;
  /** True when derived from start/end points only, not a full polyline. */
  approximate: boolean;
}

/** Per-leg great-circle bearing and length between consecutive points. */
export function legsFromPoints(points: LatLng[]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [lat1, lng1] = points[i] as LatLng;
    const [lat2, lng2] = points[i + 1] as LatLng;
    legs.push({
      bearingDeg: bearingDegrees(lat1, lng1, lat2, lng2),
      lengthM: distanceMeters(lat1, lng1, lat2, lng2),
    });
  }
  return legs;
}

/**
 * Length-weighted circular mean bearing plus directionality — the vector
 * sum's magnitude over total path length. Arithmetic averaging is wrong
 * across the 0°/360° discontinuity, so legs are summed as unit vectors.
 */
export function meanBearingAndDirectionality(legs: Leg[]): { bearingDeg: number; directionality: number; pathLengthM: number } {
  let sumX = 0;
  let sumY = 0;
  let totalLength = 0;

  for (const leg of legs) {
    const rad = (leg.bearingDeg * Math.PI) / 180;
    sumX += leg.lengthM * Math.cos(rad);
    sumY += leg.lengthM * Math.sin(rad);
    totalLength += leg.lengthM;
  }

  if (totalLength === 0) {
    return { bearingDeg: 0, directionality: 0, pathLengthM: 0 };
  }

  const meanRad = Math.atan2(sumY, sumX);
  const bearingDeg = ((meanRad * 180) / Math.PI + 360) % 360;
  const magnitude = Math.hypot(sumX, sumY);

  return { bearingDeg, directionality: magnitude / totalLength, pathLengthM: totalLength };
}

/** A segment below the directionality threshold is one where wind cancels out (loops, out-and-backs). */
export function isWindNeutral(directionality: number, threshold: number): boolean {
  return directionality < threshold;
}

/**
 * Computes a segment's directional geometry from its encoded polyline,
 * falling back to a single start/end leg (marked approximate) when no
 * polyline is stored.
 */
export function analyzeSegmentGeometry(
  polyline: string | null,
  start: LatLng | null,
  end: LatLng | null,
): GeometryResult | undefined {
  if (polyline) {
    const points = decodePolyline(polyline);
    if (points.length >= 2) {
      const legs = legsFromPoints(points);
      const { bearingDeg, directionality, pathLengthM } = meanBearingAndDirectionality(legs);
      return { bearingDeg, directionality, pathLengthM, approximate: false };
    }
  }

  if (start && end && (start[0] !== end[0] || start[1] !== end[1])) {
    const legs = legsFromPoints([start, end]);
    const { bearingDeg, directionality, pathLengthM } = meanBearingAndDirectionality(legs);
    return { bearingDeg, directionality, pathLengthM, approximate: true };
  }

  return undefined;
}
