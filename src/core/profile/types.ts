/**
 * Farmer profile as the core layer sees it (decoupled from the Prisma model).
 */
import { z } from "zod";
import { CROP_IDS, type CropId } from "@config/crops";
import { LANGUAGE_IDS, type LanguageId } from "@config/languages";

const optionalMeasure = (min: number, max: number, unit: string) =>
  z.number().min(min).max(max).optional().describe(unit);

/**
 * Values printed on a government Soil Health Card (soilhealth.dac.gov.in). Entered by the
 * farmer; all optional because cards differ in which parameters were tested.
 */
export const soilHealthCardSchema = z.object({
  testedOn: z.iso.date().optional(),
  ph: optionalMeasure(0, 14, "pH"),
  ec: optionalMeasure(0, 50, "Electrical conductivity, dS/m"),
  organicCarbon: optionalMeasure(0, 10, "Organic carbon, %"),
  nitrogen: optionalMeasure(0, 2000, "Available nitrogen, kg/ha"),
  phosphorus: optionalMeasure(0, 1000, "Available phosphorus, kg/ha"),
  potassium: optionalMeasure(0, 3000, "Available potassium, kg/ha"),
  sulphur: optionalMeasure(0, 500, "Sulphur, ppm"),
  zinc: optionalMeasure(0, 100, "Zinc, ppm"),
  iron: optionalMeasure(0, 500, "Iron, ppm"),
  boron: optionalMeasure(0, 50, "Boron, ppm"),
});
export type SoilHealthCard = z.infer<typeof soilHealthCardSchema>;

export const farmerCropSchema = z.object({
  crop: z.enum(CROP_IDS),
  sowingDate: z.iso.date(),
  areaAcres: z.number().positive().max(10_000).optional(),
});

export const profileInputSchema = z.object({
  name: z.string().trim().max(80).optional(),
  language: z.enum(LANGUAGE_IDS),
  locationName: z.string().trim().min(2).max(120),
  latitude: z.number().min(6).max(38),
  longitude: z.number().min(68).max(98),
  state: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  crops: z.array(farmerCropSchema).min(1).max(6),
  soilCard: soilHealthCardSchema.optional(),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export interface FarmerContext {
  id: string;
  name: string | null;
  language: LanguageId;
  locationName: string;
  latitude: number;
  longitude: number;
  state: string | null;
  district: string | null;
  crops: Array<{ crop: CropId; sowingDate: string; areaAcres: number | null }>;
  soilCard: SoilHealthCard | null;
  /** ISO time the profile was last saved (provenance for Soil Health Card values). */
  updatedAt: string;
}
