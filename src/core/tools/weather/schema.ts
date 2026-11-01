import { z } from "zod";
import { latitudeSchema, longitudeSchema } from "../types";

export const weatherArgsSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  days: z
    .number()
    .int()
    .min(1)
    .max(14)
    .default(7)
    .describe("Forecast horizon in days (1–14). Use 3 for 'next few days', 7 for a week."),
});
export type WeatherArgs = z.infer<typeof weatherArgsSchema>;

const series = z.array(z.number().nullable());

/** Open-Meteo /v1/forecast response for the fields we request (observed 1 Nov 2026). */
export const openMeteoForecastSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().optional(),
  timezone: z.string(),
  current: z
    .object({
      time: z.string(),
      temperature_2m: z.number().nullable(),
      relative_humidity_2m: z.number().nullable(),
      precipitation: z.number().nullable(),
      wind_speed_10m: z.number().nullable(),
    })
    .optional(),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: series,
    temperature_2m_max: series,
    temperature_2m_min: series,
    precipitation_sum: series,
    precipitation_probability_max: series,
    wind_speed_10m_max: series,
    wind_gusts_10m_max: series,
    et0_fao_evapotranspiration: series,
    relative_humidity_2m_max: series,
  }),
  hourly: z.object({
    time: z.array(z.string()),
    precipitation: series,
    precipitation_probability: series,
  }),
});
export type OpenMeteoForecast = z.infer<typeof openMeteoForecastSchema>;

export interface DailyForecast {
  date: string;
  weather: string;
  tMaxC: number | null;
  tMinC: number | null;
  rainMm: number | null;
  rainChancePct: number | null;
  windMaxKmh: number | null;
  gustMaxKmh: number | null;
  et0Mm: number | null;
  humidityMaxPct: number | null;
}

export interface HourlyRain {
  time: string;
  mm: number | null;
  chancePct: number | null;
}

export interface Forecast {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timezone: string;
  current: {
    time: string;
    temperatureC: number | null;
    humidityPct: number | null;
    rainMm: number | null;
    windKmh: number | null;
  } | null;
  daily: DailyForecast[];
  hourlyRain: HourlyRain[];
}
