import { fetchJson, type CacheStore, type Sourced } from "@/core/lib/http";
import {
  SOIL_DEPTHS,
  SOIL_PROPERTIES,
  soilGridsResponseSchema,
  type SoilGridsResponse,
  type SoilProfile,
} from "./schema";

export interface SoilProvider {
  profile(latitude: number, longitude: number): Promise<Sourced<SoilProfile>>;
}

/**
 * SoilGrids stores integers; dividing by the response's own `d_factor` gives conventional
 * units (e.g. phh2o 72 / 10 = pH 7.2). Using the response's factor, not a hardcoded one,
 * keeps us correct if ISRIC changes the encoding.
 */
export function toSoilProfile(raw: SoilGridsResponse): SoilProfile {
  const profile: SoilProfile = {};
  for (const layer of raw.properties.layers) {
    for (const depth of layer.depths) {
      if (depth.values.mean === null) continue;
      profile[depth.label] ??= {};
      profile[depth.label]![layer.name] = {
        value: Math.round((depth.values.mean / layer.unit_measure.d_factor) * 100) / 100,
        unit: layer.unit_measure.target_units,
      };
    }
  }
  return profile;
}

/** USDA soil texture triangle (percentages of sand, silt, clay). */
export function usdaTextureClass(sand: number, silt: number, clay: number): string {
  if (silt + 1.5 * clay < 15) return "sand";
  if (silt + 2 * clay < 30) return "loamy sand";
  if ((clay >= 7 && clay < 20 && sand > 52) || (clay < 7 && silt < 50)) return "sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "loam";
  if (silt >= 80 && clay < 12) return "silt";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) {
    return "silt loam";
  }
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "clay loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "silty clay loam";
  if (clay >= 35 && sand > 45) return "sandy clay";
  if (clay >= 40 && silt >= 40) return "silty clay";
  return "clay";
}

export function createSoilGridsProvider(cache: CacheStore): SoilProvider {
  return {
    async profile(latitude, longitude) {
      // SoilGrids is a 250 m grid; ~1 km rounding shares cache entries across neighbours.
      const lat = latitude.toFixed(2);
      const lon = longitude.toFixed(2);
      const params = new URLSearchParams({ lon, lat, value: "mean" });
      for (const p of SOIL_PROPERTIES) params.append("property", p);
      for (const d of SOIL_DEPTHS) params.append("depth", d);
      const result = await fetchJson({
        provider: "ISRIC SoilGrids",
        source: "ISRIC SoilGrids v2.0 (250 m modelled soil properties)",
        url: `https://rest.isric.org/soilgrids/v2.0/properties/query?${params.toString()}`,
        schema: soilGridsResponseSchema,
        timeoutMs: 12_000,
        // Beta service with a 5 calls/minute fair-use limit: one retry only.
        retries: 1,
        // Soil properties don't change week to week; cache for 30 days.
        cache: { key: `soil:${lat}:${lon}`, ttlSeconds: 30 * 86_400, store: cache },
      });
      return { ...result, data: toSoilProfile(result.data) };
    },
  };
}
