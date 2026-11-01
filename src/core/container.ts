/**
 * Composition root: the only place that picks concrete providers. Everything else depends on
 * interfaces (WeatherProvider, MandiPriceProvider, ...), so tests can pass fakes instead.
 */
import { getCacheStore } from "@/db/cache-store";
import { dbMandiRepository } from "@/db/mandi-repo";
import { getEnv } from "./lib/env";
import { createOpenMeteoGeocoder, type GeocodingProvider } from "./tools/geocode/client";
import { createGeocodeTool } from "./tools/geocode";
import {
  createDataGovMandiProvider,
  DEFAULT_CURRENT_RESOURCE_ID,
  type MandiPriceProvider,
} from "./tools/mandi/client";
import { createMandiTool } from "./tools/mandi";
import { createToolRegistry, type ToolRegistry } from "./tools/registry";
import { createSoilGridsProvider, type SoilProvider } from "./tools/soil/client";
import { createSoilTool } from "./tools/soil";
import { createOpenMeteoWeather, type WeatherProvider } from "./tools/weather/client";
import { createWeatherTool } from "./tools/weather";

export interface Container {
  geocoder: GeocodingProvider;
  weather: WeatherProvider;
  mandi: MandiPriceProvider;
  soil: SoilProvider;
  tools: ToolRegistry;
}

const globalForContainer = globalThis as unknown as { khetmitraContainer?: Container };

export function getContainer(): Container {
  if (globalForContainer.khetmitraContainer) return globalForContainer.khetmitraContainer;
  const env = getEnv();
  const cache = getCacheStore();
  const geocoder = createOpenMeteoGeocoder(cache);
  const weather = createOpenMeteoWeather(cache);
  const mandi = createDataGovMandiProvider({
    apiKey: env.DATA_GOV_IN_API_KEY,
    currentResourceId: env.MANDI_RESOURCE_ID ?? DEFAULT_CURRENT_RESOURCE_ID,
    cache,
  });
  const soil = createSoilGridsProvider(cache);
  const repo = env.DATABASE_URL ? dbMandiRepository : null;

  const tools = createToolRegistry([
    createGeocodeTool(geocoder),
    createWeatherTool(weather),
    createMandiTool({ provider: mandi, repo }),
    createSoilTool(soil),
  ]);

  globalForContainer.khetmitraContainer = { geocoder, weather, mandi, soil, tools };
  return globalForContainer.khetmitraContainer;
}
