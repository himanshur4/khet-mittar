import { z } from "zod";
import { latitudeSchema, longitudeSchema } from "../types";

export const soilArgsSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});
export type SoilArgs = z.infer<typeof soilArgsSchema>;

/** ISRIC SoilGrids v2.0 `properties/query` response (fields we use). */
export const soilGridsResponseSchema = z.object({
  properties: z.object({
    layers: z.array(
      z.object({
        name: z.string(),
        unit_measure: z.object({
          d_factor: z.number().positive(),
          target_units: z.string(),
        }),
        depths: z.array(
          z.object({
            label: z.string(),
            values: z.object({ mean: z.number().nullable() }),
          }),
        ),
      }),
    ),
  }),
});
export type SoilGridsResponse = z.infer<typeof soilGridsResponseSchema>;

export const SOIL_PROPERTIES = ["phh2o", "soc", "nitrogen", "clay", "sand", "silt", "cec"] as const;
export const SOIL_DEPTHS = ["0-5cm", "5-15cm", "15-30cm"] as const;

/** Values in conventional units, keyed by depth label then property name. */
export type SoilProfile = Record<string, Record<string, { value: number; unit: string }>>;
