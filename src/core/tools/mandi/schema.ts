import { z } from "zod";

export const mandiArgsSchema = z.object({
  commodity: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .describe(
      "Crop id (wheat, rice, onion, tomato, potato, mustard) or an Agmarknet commodity name in English",
    ),
  state: z.string().trim().min(2).max(60).describe("Indian state in English, e.g. 'Maharashtra'"),
  district: z
    .string()
    .trim()
    .max(60)
    .optional()
    .describe("District in English; markets in this district are listed first"),
});
export type MandiArgs = z.infer<typeof mandiArgsSchema>;

const price = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: "custom", message: `not a price: ${String(v)}` });
    return z.NEVER;
  }
  return n;
});

/**
 * One Agmarknet row. The "current" resource uses lowercase keys, the historical one uses
 * Title_Case, so keys are lower-cased before validation (see `normalizeKeys`).
 */
export const mandiRecordSchema = z.object({
  state: z.string(),
  district: z.string(),
  market: z.string(),
  commodity: z.string(),
  variety: z.string().default(""),
  grade: z.string().default(""),
  arrival_date: z.string(),
  min_price: price,
  max_price: price,
  modal_price: price,
});
export type MandiRecord = z.infer<typeof mandiRecordSchema>;

export const dataGovResponseSchema = z.object({
  total: z.coerce.number().optional(),
  count: z.coerce.number().optional(),
  records: z.array(z.record(z.string(), z.unknown())).default([]),
});

export interface MandiPriceRow {
  state: string;
  district: string;
  market: string;
  commodity: string;
  variety: string;
  grade: string;
  /** YYYY-MM-DD */
  arrivalDate: string;
  minPrice: number;
  maxPrice: number;
  modalPrice: number;
}

export interface TrendPoint {
  date: string;
  medianModalPrice: number;
  markets: number;
}

/** Persistence port: KhetMitra keeps every real row it fetched, which is what trends use. */
export interface MandiPriceRepository {
  save(rows: MandiPriceRow[], source: string, fetchedAt: Date): Promise<void>;
  dailyMedians(params: {
    commodities: string[];
    state: string;
    /** Any of these names (a district plus its official former/new names). */
    districts?: string[];
    sinceDate: string;
  }): Promise<TrendPoint[]>;
}
