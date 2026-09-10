/** Applies the configured roughness correction from 10m reported wind to the wind a rider experiences. */
export function correctForRiderHeight(reportedWindSpeedMs: number, roughnessFactor: number): number {
  return reportedWindSpeedMs * roughnessFactor;
}

/**
 * Resolves wind into the component along a segment's mean bearing.
 * Reported wind direction is the direction the wind blows *from*.
 * Positive = tailwind (blowing the rider along the segment), negative = headwind.
 */
export function resolveTailwindComponent(
  windSpeedMs: number,
  windFromDeg: number,
  bearingDeg: number,
): number {
  const diffRad = ((windFromDeg - bearingDeg) * Math.PI) / 180;
  return -windSpeedMs * Math.cos(diffRad);
}
