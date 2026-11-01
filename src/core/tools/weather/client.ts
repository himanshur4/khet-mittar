import { fetchJson, type CacheStore, type Sourced } from "@/core/lib/http";
import { openMeteoForecastSchema, type Forecast, type OpenMeteoForecast } from "./schema";

export interface WeatherProvider {
  forecast(latitude: number, longitude: number, days: number): Promise<Sourced<Forecast>>;
}

/** WMO weather interpretation codes as documented by Open-Meteo. */
const WMO_CODES: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "slight rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "slight snowfall",
  73: "moderate snowfall",
  75: "heavy snowfall",
  77: "snow grains",
  80: "slight rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "slight snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with slight hail",
  99: "thunderstorm with heavy hail",
};

export function describeWeatherCode(code: number | null): string {
  if (code === null) return "unknown";
  return WMO_CODES[code] ?? `WMO code ${code}`;
}

export function toForecast(raw: OpenMeteoForecast): Forecast {
  const d = raw.daily;
  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    elevationM: raw.elevation ?? null,
    timezone: raw.timezone,
    current: raw.current
      ? {
          time: raw.current.time,
          temperatureC: raw.current.temperature_2m,
          humidityPct: raw.current.relative_humidity_2m,
          rainMm: raw.current.precipitation,
          windKmh: raw.current.wind_speed_10m,
        }
      : null,
    daily: d.time.map((date, i) => ({
      date,
      weather: describeWeatherCode(d.weather_code[i] ?? null),
      tMaxC: d.temperature_2m_max[i] ?? null,
      tMinC: d.temperature_2m_min[i] ?? null,
      rainMm: d.precipitation_sum[i] ?? null,
      rainChancePct: d.precipitation_probability_max[i] ?? null,
      windMaxKmh: d.wind_speed_10m_max[i] ?? null,
      gustMaxKmh: d.wind_gusts_10m_max[i] ?? null,
      et0Mm: d.et0_fao_evapotranspiration[i] ?? null,
      humidityMaxPct: d.relative_humidity_2m_max[i] ?? null,
    })),
    hourlyRain: raw.hourly.time.map((time, i) => ({
      time,
      mm: raw.hourly.precipitation[i] ?? null,
      chancePct: raw.hourly.precipitation_probability[i] ?? null,
    })),
  };
}

export function createOpenMeteoWeather(cache: CacheStore): WeatherProvider {
  return {
    async forecast(latitude, longitude, days) {
      // ~1 km grid: neighbouring farms share one cached forecast without changing the advice.
      const lat = latitude.toFixed(2);
      const lon = longitude.toFixed(2);
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        timezone: "Asia/Kolkata",
        forecast_days: String(days),
        current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
        daily: [
          "weather_code",
          "temperature_2m_max",
          "temperature_2m_min",
          "precipitation_sum",
          "precipitation_probability_max",
          "wind_speed_10m_max",
          "wind_gusts_10m_max",
          "et0_fao_evapotranspiration",
          "relative_humidity_2m_max",
        ].join(","),
        hourly: "precipitation,precipitation_probability",
      }).toString();
      const result = await fetchJson({
        provider: "Open-Meteo",
        source: "Open-Meteo Forecast API",
        url,
        schema: openMeteoForecastSchema,
        timeoutMs: 8_000,
        retries: 2,
        // Forecast models update roughly hourly; 30 minutes keeps answers current.
        cache: { key: `wx:${lat}:${lon}:${days}`, ttlSeconds: 30 * 60, store: cache },
      });
      return { ...result, data: toForecast(result.data) };
    },
  };
}
