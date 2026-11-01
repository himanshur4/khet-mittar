/**
 * Deterministic weather-risk detection over a real forecast. Rules (not the LLM) decide
 * *whether* to alert, so alerts are explainable and never hallucinated; the LLM only writes the
 * crop-specific advice text. Thresholds are official definitions (docs/PROBE_RESULTS.md).
 */
import type { Forecast } from "@/core/tools/weather/schema";

export type RiskKind =
  "heavy_rain" | "rain_before_inputs" | "heat_stress" | "cold_stress" | "strong_wind";
export type Severity = "info" | "warning" | "severe";

export interface RiskEvent {
  kind: RiskKind;
  severity: Severity;
  /** Forecast day (YYYY-MM-DD, IST) on which the event is expected. */
  date: string;
  metric: { name: string; value: number; unit: string; threshold: number; thresholdSource: string };
}

/** IMD 24-hour rainfall classes (mm). */
export const IMD_RAIN = {
  moderate: 15.6,
  heavy: 64.5,
  veryHeavy: 115.6,
  extremelyHeavy: 204.5,
} as const;
/** IMD heat wave (plains): Tmax ≥ 40 °C baseline; ≥ 45 °C regardless of normal. */
export const IMD_HEAT = { baseline: 40, absolute: 45 } as const;
/** IMD cold wave (plains, actual value): Tmin ≤ 4 °C; severe ≤ 2 °C. */
export const IMD_COLD = { coldWave: 4, severe: 2 } as const;
/** Beaufort force 6 ("strong breeze") starts at 39 km/h: spray drift and lodging risk. */
export const STRONG_WIND_KMH = 39;

/** Alerts look 72 hours ahead: enough notice to act, short enough for a reliable forecast. */
export const ALERT_HORIZON_DAYS = 3;

export function detectWeatherRisks(forecast: Forecast, todayIst: string): RiskEvent[] {
  const days = forecast.daily.filter((d) => d.date >= todayIst).slice(0, ALERT_HORIZON_DAYS);
  const risks: RiskEvent[] = [];
  for (const day of days) {
    const rain = day.rainMm;
    if (rain !== null && rain >= IMD_RAIN.heavy) {
      risks.push({
        kind: "heavy_rain",
        severity: "severe",
        date: day.date,
        metric: {
          name: "rainfall",
          value: rain,
          unit: "mm",
          threshold: rain >= IMD_RAIN.veryHeavy ? IMD_RAIN.veryHeavy : IMD_RAIN.heavy,
          thresholdSource:
            rain >= IMD_RAIN.veryHeavy
              ? "IMD: very heavy rain (≥115.6 mm/24 h)"
              : "IMD: heavy rain (≥64.5 mm/24 h)",
        },
      });
    } else if (rain !== null && rain >= IMD_RAIN.moderate) {
      risks.push({
        kind: "rain_before_inputs",
        severity: "warning",
        date: day.date,
        metric: {
          name: "rainfall",
          value: rain,
          unit: "mm",
          threshold: IMD_RAIN.moderate,
          thresholdSource: "IMD: moderate rain (≥15.6 mm/24 h)",
        },
      });
    }
    if (day.tMaxC !== null && day.tMaxC >= IMD_HEAT.baseline) {
      risks.push({
        kind: "heat_stress",
        severity: day.tMaxC >= IMD_HEAT.absolute ? "severe" : "warning",
        date: day.date,
        metric: {
          name: "maximum temperature",
          value: day.tMaxC,
          unit: "°C",
          threshold: day.tMaxC >= IMD_HEAT.absolute ? IMD_HEAT.absolute : IMD_HEAT.baseline,
          thresholdSource:
            day.tMaxC >= IMD_HEAT.absolute
              ? "IMD: heat wave (≥45 °C)"
              : "IMD: heat-wave baseline for plains (≥40 °C)",
        },
      });
    }
    if (day.tMinC !== null && day.tMinC <= IMD_COLD.coldWave) {
      risks.push({
        kind: "cold_stress",
        severity: day.tMinC <= IMD_COLD.severe ? "severe" : "warning",
        date: day.date,
        metric: {
          name: "minimum temperature",
          value: day.tMinC,
          unit: "°C",
          threshold: day.tMinC <= IMD_COLD.severe ? IMD_COLD.severe : IMD_COLD.coldWave,
          thresholdSource:
            day.tMinC <= IMD_COLD.severe
              ? "IMD: severe cold wave (≤2 °C)"
              : "IMD: cold wave (≤4 °C)",
        },
      });
    }
    if (day.gustMaxKmh !== null && day.gustMaxKmh >= STRONG_WIND_KMH) {
      risks.push({
        kind: "strong_wind",
        severity: "warning",
        date: day.date,
        metric: {
          name: "wind gusts",
          value: day.gustMaxKmh,
          unit: "km/h",
          threshold: STRONG_WIND_KMH,
          thresholdSource: "Beaufort force 6 (≥39 km/h, WMO)",
        },
      });
    }
  }
  return risks;
}

/** One alert per farmer + crop + rule + day, however often the check runs. */
export function dedupeKey(farmerId: string, crop: string, risk: RiskEvent): string {
  return `${farmerId}:${crop}:${risk.kind}:${risk.date}`;
}
