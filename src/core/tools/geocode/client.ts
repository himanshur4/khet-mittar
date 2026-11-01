import { fetchJson, type CacheStore, type Sourced } from "@/core/lib/http";
import { openMeteoGeocodingSchema, type Place } from "./schema";

export interface GeocodingProvider {
  search(place: string, state?: string): Promise<Sourced<Place[]>>;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

export function createOpenMeteoGeocoder(cache: CacheStore): GeocodingProvider {
  return {
    async search(place, state) {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.search = new URLSearchParams({
        name: place,
        count: "10",
        language: "en",
        countryCode: "IN",
        format: "json",
      }).toString();
      const result = await fetchJson({
        provider: "Open-Meteo Geocoding",
        source: "Open-Meteo Geocoding API (GeoNames)",
        url,
        schema: openMeteoGeocodingSchema,
        timeoutMs: 6_000,
        retries: 2,
        // Place names don't move; a month-long cache keeps repeat questions instant.
        cache: { key: `geo:${normalize(place)}`, ttlSeconds: 30 * 86_400, store: cache },
      });
      const wantedState = state ? normalize(state) : null;
      const places = result.data.results
        .filter((r) => (r.country_code ?? "IN") === "IN")
        .map((r): Place => ({
          name: r.name,
          district: r.admin2 ?? null,
          state: r.admin1 ?? null,
          latitude: r.latitude,
          longitude: r.longitude,
          population: r.population ?? null,
        }))
        // Same-state matches first, then bigger places: "Aurangabad" exists in two states.
        .sort((a, b) => {
          const sa = wantedState && a.state && normalize(a.state) === wantedState ? 1 : 0;
          const sb = wantedState && b.state && normalize(b.state) === wantedState ? 1 : 0;
          return sb - sa || (b.population ?? 0) - (a.population ?? 0);
        });
      return { ...result, data: places };
    },
  };
}
