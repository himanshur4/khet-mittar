/**
 * Agmarknet prices via the data.gov.in OGD API.
 * Resource ids verified 1 Nov 2026 (docs/PROBE_RESULTS.md).
 */
import { MissingConfigError } from "@/core/lib/errors";
import { fetchJson, type CacheStore, type Sourced } from "@/core/lib/http";
import { logger } from "@/core/lib/logger";
import {
  dataGovResponseSchema,
  mandiRecordSchema,
  type MandiPriceRow,
  type MandiRecord,
} from "./schema";

/** "Current Daily Price of Various Commodities from Various Markets (Mandi)". */
export const DEFAULT_CURRENT_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";
/** "Variety-wise Daily Market Prices Data of Commodity" (historical). */
export const HISTORY_RESOURCE_ID = "35985678-0d79-46b4-9ed6-6f13308a1d24";

export interface MandiPriceProvider {
  /** Latest reported prices for one commodity across a state. */
  current(commodity: string, state: string): Promise<Sourced<MandiPriceRow[]>>;
  /** Recent history for a district (best effort; may be empty). */
  history(commodity: string, state: string, district: string): Promise<Sourced<MandiPriceRow[]>>;
}

function normalizeKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k.toLowerCase(), v]));
}

/** Agmarknet uses dd/mm/yyyy; accept ISO too in case the resource changes format. */
export function toIsoDate(value: string): string | null {
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value.trim());
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function parseRecords(records: Array<Record<string, unknown>>): MandiPriceRow[] {
  const rows: MandiPriceRow[] = [];
  let rejected = 0;
  for (const raw of records) {
    const parsed = mandiRecordSchema.safeParse(normalizeKeys(raw));
    const date = parsed.success ? toIsoDate(parsed.data.arrival_date) : null;
    if (!parsed.success || !date) {
      rejected++;
      continue;
    }
    const r: MandiRecord = parsed.data;
    rows.push({
      state: r.state.trim(),
      district: r.district.trim(),
      market: r.market.trim(),
      commodity: r.commodity.trim(),
      variety: r.variety.trim(),
      grade: r.grade.trim(),
      arrivalDate: date,
      minPrice: r.min_price,
      maxPrice: r.max_price,
      modalPrice: r.modal_price,
    });
  }
  // Skipping malformed rows (rather than failing the call) keeps one bad row from hiding all prices.
  if (rejected > 0)
    logger.warn("dropped malformed Agmarknet rows", { rejected, kept: rows.length });
  return rows;
}

export function createDataGovMandiProvider(options: {
  apiKey: string | undefined;
  currentResourceId: string;
  cache: CacheStore;
}): MandiPriceProvider {
  const requireKey = () => {
    if (!options.apiKey) throw new MissingConfigError("Mandi prices", ["DATA_GOV_IN_API_KEY"]);
    return options.apiKey;
  };

  const query = async (
    resourceId: string,
    filters: Record<string, string>,
    cacheKey: string,
    ttlSeconds: number,
  ) => {
    const url = new URL(`https://api.data.gov.in/resource/${resourceId}`);
    url.searchParams.set("api-key", requireKey());
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1000");
    for (const [field, value] of Object.entries(filters)) {
      url.searchParams.set(`filters[${field}]`, value);
    }
    const result = await fetchJson({
      provider: "data.gov.in (Agmarknet)",
      source: "Agmarknet via data.gov.in",
      url,
      schema: dataGovResponseSchema,
      timeoutMs: 12_000,
      retries: 2,
      cache: { key: cacheKey, ttlSeconds, store: options.cache },
    });
    return { ...result, data: parseRecords(result.data.records) };
  };

  return {
    current(commodity, state) {
      // Markets report through the day; 2 hours balances freshness against the API rate limit.
      return query(
        options.currentResourceId,
        { state, commodity },
        `mandi:current:${state}:${commodity}`.toLowerCase(),
        2 * 3600,
      );
    },
    history(commodity, state, district) {
      return query(
        HISTORY_RESOURCE_ID,
        { State: state, District: district, Commodity: commodity },
        `mandi:history:${state}:${district}:${commodity}`.toLowerCase(),
        12 * 3600,
      );
    },
  };
}
