import { describe, expect, it } from 'vitest';
import { requiredPowerWatts, solveSpeedForPower, type RiderPhysicalParams } from '../src/wind/powerModel.js';
import { correctForRiderHeight, resolveTailwindComponent } from '../src/wind/windComponent.js';
import { calibratePower, gapToKomSeconds, projectTime, type RiderParams } from '../src/wind/projection.js';

const rider: RiderParams = { massKg: 78, cdA: 0.32, crr: 0.005, roughnessFactor: 0.55 };
const riderPhysical: RiderPhysicalParams = { massKg: 78, cdA: 0.32, crr: 0.005 };

describe('correctForRiderHeight', () => {
  it('scales reported 10m wind down toward rider height', () => {
    const corrected = correctForRiderHeight(10, 0.55);
    expect(corrected).toBe(5.5);
    expect(corrected).toBeLessThan(10);
  });
});

describe('resolveTailwindComponent', () => {
  it('is positive and maximal for a direct tailwind', () => {
    // Segment bearing 90° (east); wind FROM 270° (west) blows the rider east.
    const component = resolveTailwindComponent(10, 270, 90);
    expect(component).toBeCloseTo(10, 6);
  });

  it('is negative for a direct headwind', () => {
    // Wind FROM the segment's own bearing blows straight at the rider.
    const component = resolveTailwindComponent(10, 90, 90);
    expect(component).toBeCloseTo(-10, 6);
  });

  it('is approximately zero for a pure crosswind', () => {
    const component = resolveTailwindComponent(10, 180, 90);
    expect(Math.abs(component)).toBeLessThan(1e-6);
  });
});

describe('requiredPowerWatts / solveSpeedForPower', () => {
  it('round-trips: solving for the speed that requires a known power recovers that speed', () => {
    const power = requiredPowerWatts(11, 0, 0.9, riderPhysical);
    const v = solveSpeedForPower(power, 0, 0.9, riderPhysical);
    expect(v).toBeCloseTo(11, 3);
  });

  it('gives a tailwind a much larger effect on a flat fast segment than the same tailwind on a steep climb', () => {
    const stillAirFlatSpeed = 11.6; // ~41.6 km/h flat
    const flatPower = requiredPowerWatts(stillAirFlatSpeed, 0, 0.9, riderPhysical);
    const flatWithTailwind = solveSpeedForPower(flatPower, -4, 0.9, riderPhysical);
    const flatSpeedupRatio = flatWithTailwind / stillAirFlatSpeed;

    const stillAirClimbSpeed = 3.3; // slow steep climb
    const climbPower = requiredPowerWatts(stillAirClimbSpeed, 0, 10, riderPhysical);
    const climbWithTailwind = solveSpeedForPower(climbPower, -4, 10, riderPhysical);
    const climbSpeedupRatio = climbWithTailwind / stillAirClimbSpeed;

    expect(flatSpeedupRatio).toBeGreaterThan(climbSpeedupRatio);
  });
});

describe('calibratePower / projectTime', () => {
  const distanceM = 3538;
  const gradePercent = 0.9;
  const bearingDeg = 319.3;

  it('marks the projection calibrated when historical wind at the PR is known', () => {
    const power = calibratePower(306, distanceM, gradePercent, bearingDeg, rider, {
      windSpeedMs: 3,
      windDirectionDeg: bearingDeg + 180,
    });
    expect(power.confidence).toBe('calibrated');
    expect(power.watts).toBeGreaterThan(0);
  });

  it('falls back to uncorrected power and marks lower-confidence when no timestamp/historical wind exists', () => {
    const power = calibratePower(306, distanceM, gradePercent, bearingDeg, rider, undefined);
    expect(power.confidence).toBe('lower-confidence');
  });

  it('projects a faster time under tailwind than headwind, and discloses the rider params used', () => {
    const power = calibratePower(306, distanceM, gradePercent, bearingDeg, rider, undefined);

    const tailwind = projectTime(power, { windSpeedMs: 6, windDirectionDeg: bearingDeg + 180 }, distanceM, gradePercent, bearingDeg, rider);
    const headwind = projectTime(power, { windSpeedMs: 6, windDirectionDeg: bearingDeg }, distanceM, gradePercent, bearingDeg, rider);

    expect(tailwind.predictedTimeS).toBeLessThan(headwind.predictedTimeS);
    expect(tailwind.riderParamsUsed).toEqual(rider);
  });

  it('reports the projected time as a signed difference against the KOM', () => {
    expect(gapToKomSeconds(320, 306)).toBe(14); // slower than KOM
    expect(gapToKomSeconds(295, 306)).toBe(-11); // faster than KOM
  });
});
