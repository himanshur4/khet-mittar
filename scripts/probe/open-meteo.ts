/** Probe: Open-Meteo geocoding + forecast (no key needed). */
import { assert, http, probe, runIfMain, type ProbeResult } from "./_probe";

export async function probeOpenMeteo(): Promise<ProbeResult[]> {
  return Promise.all([
    probe("Open-Meteo geocoding (Latin script)", async () => {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.search = new URLSearchParams({
        name: "Nashik",
        count: "3",
        language: "en",
        countryCode: "IN",
      }).toString();
      const r = await http(url);
      assert(r.status === 200, `HTTP ${r.status}`);
      const results = (r.json as { results?: Array<Record<string, unknown>> }).results ?? [];
      assert(results.length > 0, "no results");
      const top = results[0]!;
      return `${r.ms} ms; top: ${String(top.name)}, ${String(top.admin2)}, ${String(top.admin1)} (${String(top.latitude)}, ${String(top.longitude)}); fields: ${Object.keys(top).join(", ")}`;
    }),
    probe("Open-Meteo geocoding (Devanagari)", async () => {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.search = new URLSearchParams({
        name: "नासिक",
        count: "3",
        language: "hi",
        countryCode: "IN",
      }).toString();
      const r = await http(url);
      assert(r.status === 200, `HTTP ${r.status}`);
      const n = ((r.json as { results?: unknown[] }).results ?? []).length;
      return `${n} results: ${n === 0 ? "search requires Latin-script names, so the agent must transliterate" : "Devanagari search works"}`;
    }),
    probe("Open-Meteo forecast (daily + hourly)", async () => {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: "19.997",
        longitude: "73.791",
        timezone: "Asia/Kolkata",
        forecast_days: "7",
        daily:
          "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,et0_fao_evapotranspiration",
        hourly: "precipitation,precipitation_probability",
      }).toString();
      const r = await http(url);
      assert(r.status === 200, `HTTP ${r.status}`);
      const daily = (r.json as { daily?: Record<string, unknown[]> }).daily;
      assert(daily?.time?.length, "no daily block");
      return `${r.ms} ms; ${daily.time.length} days from ${String(daily.time[0])}; day-1 rain ${String(daily.precipitation_sum?.[0])} mm, Tmax ${String(daily.temperature_2m_max?.[0])} °C`;
    }),
  ]);
}

runIfMain(import.meta.url, probeOpenMeteo);
