import { requiredPowerWatts, solveSpeedForPower, type RiderPhysicalParams } from './powerModel.js';
import { correctForRiderHeight, resolveTailwindComponent } from './windComponent.js';
import type { HourlyWind } from './types.js';

export interface RiderParams extends RiderPhysicalParams {
  roughnessFactor: number;
}

export type ProjectionConfidence = 'calibrated' | 'lower-confidence';

export interface CalibratedPower {
  watts: number;
  confidence: ProjectionConfidence;
}

export interface Projection {
  predictedTimeS: number;
  /** Positive = headwind at rider height, negative = tailwind. */
  headwindMs: number;
  confidence: ProjectionConfidence;
  riderParamsUsed: RiderParams;
}

/**
 * Inverts the athlete's best effort for their sustainable ("still-air")
 * power, subtracting the wind that prevailed at the effort's timestamp
 * when known. Without a timestamp, power is derived as if the effort were
 * windless and the result is marked lower-confidence (see design.md).
 */
export function calibratePower(
  bestEffortElapsedS: number,
  distanceM: number,
  gradePercent: number,
  bearingDeg: number,
  rider: RiderParams,
  historicalWindAtEffort: Pick<HourlyWind, 'windSpeedMs' | 'windDirectionDeg'> | undefined,
): CalibratedPower {
  const vPr = distanceM / bestEffortElapsedS;

  let vHead = 0;
  let confidence: ProjectionConfidence = 'lower-confidence';
  if (historicalWindAtEffort) {
    const corrected = correctForRiderHeight(historicalWindAtEffort.windSpeedMs, rider.roughnessFactor);
    const tailwind = resolveTailwindComponent(corrected, historicalWindAtEffort.windDirectionDeg, bearingDeg);
    vHead = -tailwind;
    confidence = 'calibrated';
  }

  const watts = requiredPowerWatts(vPr, vHead, gradePercent, rider);
  return { watts, confidence };
}

/** Predicts elapsed time for given forecast wind, using previously calibrated power. */
export function projectTime(
  power: CalibratedPower,
  forecastWind: Pick<HourlyWind, 'windSpeedMs' | 'windDirectionDeg'>,
  distanceM: number,
  gradePercent: number,
  bearingDeg: number,
  rider: RiderParams,
): Projection {
  const corrected = correctForRiderHeight(forecastWind.windSpeedMs, rider.roughnessFactor);
  const tailwind = resolveTailwindComponent(corrected, forecastWind.windDirectionDeg, bearingDeg);
  const headwindMs = -tailwind;

  const v = solveSpeedForPower(power.watts, headwindMs, gradePercent, rider);

  return {
    predictedTimeS: distanceM / v,
    headwindMs,
    confidence: power.confidence,
    riderParamsUsed: rider,
  };
}

/** Signed difference in seconds against the KOM: positive = slower, negative = faster. */
export function gapToKomSeconds(predictedTimeS: number, komSeconds: number): number {
  return predictedTimeS - komSeconds;
}
