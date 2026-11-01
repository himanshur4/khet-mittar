import { defineTool } from "../types";
import type { GeocodingProvider } from "./client";
import { geocodeArgsSchema } from "./schema";

export function createGeocodeTool(geocoder: GeocodingProvider) {
  return defineTool({
    name: "geocode",
    description:
      "Find latitude/longitude, district and state for a place in India. Use when the farmer mentions a place other than their saved farm location. Spell the place in English letters.",
    args: geocodeArgsSchema,
    timeoutMs: 10_000,
    async execute({ place, state }) {
      const result = await geocoder.search(place, state);
      const matches = result.data.slice(0, 3);
      return {
        data:
          matches.length > 0
            ? { matches }
            : {
                matches: [],
                note: `No place called "${place}" found. Ask the farmer for the nearest town or district, spelled in English.`,
              },
        sources: [
          {
            kind: "tool",
            title: result.source,
            detail: `Search: ${place}${state ? `, ${state}` : ""}`,
            url: "https://open-meteo.com/en/docs/geocoding-api",
            fetchedAt: result.fetchedAt.toISOString(),
            freshness: result.freshness,
          },
        ],
        summary:
          matches.length > 0
            ? `${matches[0]!.name}, ${matches[0]!.district ?? "?"}, ${matches[0]!.state ?? "?"} (${matches.length} match${matches.length > 1 ? "es" : ""})`
            : `no match for "${place}"`,
      };
    },
  });
}
