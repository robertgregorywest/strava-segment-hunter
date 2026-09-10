export const AIR_DENSITY_KG_M3 = 1.225;
export const GRAVITY_M_S2 = 9.80665;

export interface RiderPhysicalParams {
  massKg: number;
  /** Drag area, Cd * A, in m^2. */
  cdA: number;
  crr: number;
}

/**
 * Power required to hold ground speed `v` (m/s) up a gradient, given a
 * headwind component `vHead` (m/s, positive = headwind). Rolling and
 * gravitational resistance scale with speed; aerodynamic drag scales with
 * the cube of apparent air speed — so a tailwind transforms a fast flat
 * segment far more than a slow, steep one, with no special-casing.
 */
export function requiredPowerWatts(
  v: number,
  vHead: number,
  gradePercent: number,
  rider: RiderPhysicalParams,
): number {
  const theta = Math.atan(gradePercent / 100);
  const rollingAndGravity =
    rider.crr * rider.massKg * GRAVITY_M_S2 * Math.cos(theta) + rider.massKg * GRAVITY_M_S2 * Math.sin(theta);
  // Signed quadratic drag: apparent air speed can go negative (a tailwind
  // stronger than ground speed), in which case aerodynamic drag assists
  // rather than resists.
  const apparentAirSpeed = v + vHead;
  const aeroForce = 0.5 * AIR_DENSITY_KG_M3 * rider.cdA * apparentAirSpeed * Math.abs(apparentAirSpeed);

  return rollingAndGravity * v + aeroForce * v;
}

/**
 * Solves for the ground speed at which requiredPowerWatts equals
 * targetWatts, by bisection. requiredPowerWatts is monotonic in v for a
 * fixed vHead, so this converges reliably without a closed-form cubic.
 */
export function solveSpeedForPower(
  targetWatts: number,
  vHead: number,
  gradePercent: number,
  rider: RiderPhysicalParams,
): number {
  let lo = 0;
  let hi = 30; // ~108 km/h, comfortably above any rideable segment speed

  while (requiredPowerWatts(hi, vHead, gradePercent, rider) < targetWatts && hi < 100) {
    hi *= 1.5;
  }

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (requiredPowerWatts(mid, vHead, gradePercent, rider) < targetWatts) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}
