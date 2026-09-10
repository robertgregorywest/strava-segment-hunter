export interface HourlyWind {
  /** ISO 8601 UTC timestamp for this hour. */
  time: string;
  windSpeedMs: number;
  windDirectionDeg: number;
  windGustsMs: number | null;
}
