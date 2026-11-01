import { z } from "zod";

export const geocodeArgsSchema = z.object({
  place: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .describe(
      "Village, town or district name in Latin (English) script, e.g. 'Nashik' not 'नासिक'. Transliterate Hindi names.",
    ),
  state: z
    .string()
    .trim()
    .max(60)
    .optional()
    .describe("Indian state name in English, to disambiguate places with the same name"),
});
export type GeocodeArgs = z.infer<typeof geocodeArgsSchema>;

/** Open-Meteo geocoding response (observed 1 Nov 2026, see docs/PROBE_RESULTS.md). */
export const openMeteoGeocodingSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country_code: z.string().optional(),
        admin1: z.string().optional(),
        admin2: z.string().optional(),
        admin3: z.string().optional(),
        population: z.number().optional(),
        feature_code: z.string().optional(),
      }),
    )
    .default([]),
});

export interface Place {
  name: string;
  district: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  population: number | null;
}
