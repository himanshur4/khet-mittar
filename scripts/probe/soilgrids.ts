/** Probe: ISRIC SoilGrids v2.0 point query (no key; beta service, fair use 5 calls/min). */
import { assert, http, probe, runIfMain, type ProbeResult } from "./_probe";

export async function probeSoilGrids(): Promise<ProbeResult[]> {
  return [
    await probe("ISRIC SoilGrids properties/query", async () => {
      const url = new URL("https://rest.isric.org/soilgrids/v2.0/properties/query");
      const params = new URLSearchParams({ lon: "73.79", lat: "19.99", value: "mean" });
      for (const p of ["phh2o", "soc", "nitrogen", "clay", "sand", "silt", "cec"])
        params.append("property", p);
      for (const d of ["0-5cm", "5-15cm"]) params.append("depth", d);
      url.search = params.toString();
      const r = await http(url, {}, 40_000);
      assert(r.status === 200, `HTTP ${r.status} (${r.text.slice(0, 80).replace(/\s+/g, " ")})`);
      const layers =
        (r.json as { properties?: { layers?: Array<Record<string, unknown>> } }).properties
          ?.layers ?? [];
      const summary = layers.map((l) => {
        const unit = l.unit_measure as { d_factor?: number; target_units?: string } | undefined;
        const depth = (l.depths as Array<{ label: string; values: { mean: number | null } }>)[0];
        return `${String(l.name)}=${String(depth?.values.mean)}/${String(unit?.d_factor)} ${String(unit?.target_units)}`;
      });
      return `${r.ms} ms; ${summary.join("; ")}`;
    }),
  ];
}

runIfMain(import.meta.url, probeSoilGrids);
