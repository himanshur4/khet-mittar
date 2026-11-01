import { describe, expect, it } from "vitest";
import type { DailyForecast, Forecast } from "@/core/tools/weather/schema";
import { dedupeKey, detectWeatherRisks } from "../rules";

function day(date: string, overrides: Partial<DailyForecast> = {}): DailyForecast {
  return {
    date,
    weather: "test",
    tMaxC: 30,
    tMinC: 20,
    rainMm: 0,
    rainChancePct: 10,
    windMaxKmh: 10,
    gustMaxKmh: 20,
    et0Mm: 4,
    humidityMaxPct: 70,
    ...overrides,
  };
}

function forecast(daily: DailyForecast[]): Forecast {
  return {
    latitude: 20,
    longitude: 74,
    elevationM: null,
    timezone: "Asia/Kolkata",
    current: null,
    daily,
    hourlyRain: [],
  };
}

describe("detectWeatherRisks", () => {
  it("applies IMD rainfall classes", () => {
    const risks = detectWeatherRisks(
      forecast([
        day("2026-11-01", { rainMm: 15.5 }),
        day("2026-11-02", { rainMm: 15.6 }),
        day("2026-11-03", { rainMm: 120 }),
      ]),
      "2026-11-01",
    );
    expect(risks.map((r) => `${r.kind}:${r.date}`)).toEqual([
      "rain_before_inputs:2026-11-02",
      "heavy_rain:2026-11-03",
    ]);
    expect(risks[1]!.metric.thresholdSource).toContain("very heavy");
  });

  it("flags heat, cold and strong wind at their thresholds", () => {
    const risks = detectWeatherRisks(
      forecast([
        day("2026-11-01", { tMaxC: 45.2 }),
        day("2026-11-02", { tMinC: 3.5 }),
        day("2026-11-03", { gustMaxKmh: 39 }),
      ]),
      "2026-11-01",
    );
    expect(risks.map((r) => `${r.kind}:${r.severity}`)).toEqual([
      "heat_stress:severe",
      "cold_stress:warning",
      "strong_wind:warning",
    ]);
  });

  it("only looks 72 hours ahead and ignores past days and missing values", () => {
    const risks = detectWeatherRisks(
      forecast([
        day("2026-10-31", { rainMm: 200 }),
        day("2026-11-01", { rainMm: null, tMaxC: null }),
        day("2026-11-02"),
        day("2026-11-03"),
        day("2026-11-04", { rainMm: 200 }),
      ]),
      "2026-11-01",
    );
    expect(risks).toEqual([]);
  });

  it("builds one dedupe key per farmer, crop, rule and day", () => {
    const [risk] = detectWeatherRisks(forecast([day("2026-11-02", { rainMm: 70 })]), "2026-11-01");
    expect(dedupeKey("f1", "onion", risk!)).toBe("f1:onion:heavy_rain:2026-11-02");
  });
});
