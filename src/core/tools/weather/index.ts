import { defineTool } from "../types";
import type { WeatherProvider } from "./client";
import type { Forecast } from "./schema";
import { weatherArgsSchema } from "./schema";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Condenses 72 hourly values into what matters for field work: when, and how much, rain. */
export function summarizeNext48h(forecast: Forecast, now: Date = new Date()) {
  const nowIst = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 13);
  const upcoming = forecast.hourlyRain.filter((h) => h.time.slice(0, 13) >= nowIst).slice(0, 48);
  const wet = upcoming.filter((h) => (h.mm ?? 0) >= 0.5);
  const total = upcoming.reduce((sum, h) => sum + (h.mm ?? 0), 0);
  const peak = upcoming.reduce<(typeof upcoming)[number] | null>(
    (best, h) => ((h.mm ?? 0) > (best?.mm ?? 0) ? h : best),
    null,
  );
  return {
    hoursCovered: upcoming.length,
    totalRainMm: round1(total),
    rainyHours: wet.length,
    firstRainAt: wet[0]?.time ?? null,
    peakHour: peak && (peak.mm ?? 0) > 0 ? { time: peak.time, mm: peak.mm } : null,
    maxRainChancePct: upcoming.reduce((m, h) => Math.max(m, h.chancePct ?? 0), 0),
  };
}

export function createWeatherTool(weather: WeatherProvider) {
  return defineTool({
    name: "getWeatherForecast",
    description:
      "Daily weather forecast (rain mm and chance, min/max temperature, wind, humidity, evapotranspiration) plus an hour-level rain summary for the next 48 hours. Use for any question about rain, irrigation, spraying, sowing or harvest timing.",
    args: weatherArgsSchema,
    timeoutMs: 15_000,
    async execute({ latitude, longitude, days }) {
      const result = await weather.forecast(latitude, longitude, days);
      const f = result.data;
      const next48h = summarizeNext48h(f);
      return {
        data: {
          location: { latitude: f.latitude, longitude: f.longitude, elevationM: f.elevationM },
          timezone: f.timezone,
          units: { temperature: "°C", rain: "mm", wind: "km/h", et0: "mm/day" },
          current: f.current,
          next48h,
          daily: f.daily,
        },
        sources: [
          {
            kind: "tool",
            title: result.source,
            detail: `${days}-day forecast for ${f.latitude.toFixed(2)}, ${f.longitude.toFixed(2)}`,
            url: "https://open-meteo.com/en/docs",
            fetchedAt: result.fetchedAt.toISOString(),
            freshness: result.freshness,
          },
        ],
        summary: `${f.daily.length} days; next 48 h rain ${next48h.totalRainMm} mm; day-1 ${f.daily[0]?.tMinC ?? "?"}–${f.daily[0]?.tMaxC ?? "?"} °C`,
      };
    },
  });
}
