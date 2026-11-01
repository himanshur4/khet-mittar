/**
 * Probe: data.gov.in OGD API for Agmarknet mandi prices.
 * Checks the "current daily price" resource and the historical "variety-wise" resource,
 * which filter syntax works, and whether our crop names match Agmarknet commodity names.
 */
import { CROPS } from "../../config/crops";
import { assert, http, probe, requireKey, runIfMain, type ProbeResult } from "./_probe";

const CURRENT_RESOURCE =
  process.env.MANDI_RESOURCE_ID?.trim() || "9ef84268-d588-465a-a308-a864a43d0070";
const HISTORY_RESOURCE = "35985678-0d79-46b4-9ed6-6f13308a1d24";

type Records = {
  records?: Array<Record<string, unknown>>;
  total?: number;
  message?: string;
  error?: string;
};

async function query(resource: string, key: string, filters: Record<string, string>, limit = 5) {
  const url = new URL(`https://api.data.gov.in/resource/${resource}`);
  url.searchParams.set("api-key", key);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  for (const [field, value] of Object.entries(filters))
    url.searchParams.set(`filters[${field}]`, value);
  const r = await http(url, {}, 30_000);
  const body = (r.json ?? {}) as Records;
  return { r, body, records: body.records ?? [] };
}

export async function probeDataGovIn(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  results.push(
    await probe("data.gov.in current mandi prices (filters[state])", async () => {
      const key = requireKey("DATA_GOV_IN_API_KEY");
      const { r, body, records } = await query(CURRENT_RESOURCE, key, {
        state: "Maharashtra",
        commodity: "Onion",
      });
      assert(
        r.status === 200,
        `HTTP ${r.status}: ${body.error ?? body.message ?? r.text.slice(0, 120)}`,
      );
      const first = records[0];
      return `${r.ms} ms; total=${String(body.total)} returned=${records.length}; fields: ${first ? Object.keys(first).join(", ") : "(none)"}; sample: ${JSON.stringify(first ?? {})}`;
    }),
  );
  results.push(
    await probe("data.gov.in current mandi prices (filters[state.keyword])", async () => {
      const key = requireKey("DATA_GOV_IN_API_KEY");
      const { r, body, records } = await query(CURRENT_RESOURCE, key, {
        "state.keyword": "Maharashtra",
        commodity: "Onion",
      });
      assert(r.status === 200, `HTTP ${r.status}`);
      return `total=${String(body.total)} returned=${records.length}`;
    }),
  );
  results.push(
    await probe("data.gov.in historical variety-wise prices", async () => {
      const key = requireKey("DATA_GOV_IN_API_KEY");
      const attempts: Array<Record<string, string>> = [
        { State: "Maharashtra", Commodity: "Onion" },
        { state: "Maharashtra", commodity: "Onion" },
      ];
      const lines: string[] = [];
      for (const filters of attempts) {
        const { r, body, records } = await query(HISTORY_RESOURCE, key, filters, 5);
        const first = records[0];
        lines.push(
          `filters ${Object.keys(filters).join("/")}: HTTP ${r.status} total=${String(body.total)} returned=${records.length} fields=${first ? Object.keys(first).join(",") : "-"} sample=${JSON.stringify(first ?? {})}`,
        );
      }
      return lines.join("\n");
    }),
  );
  results.push(
    await probe("Agmarknet commodity names for supported crops", async () => {
      const key = requireKey("DATA_GOV_IN_API_KEY");
      const lines: string[] = [];
      for (const crop of Object.values(CROPS)) {
        const found: string[] = [];
        for (const name of crop.agmarknetNames) {
          const { body } = await query(CURRENT_RESOURCE, key, { commodity: name }, 1);
          found.push(`${name}=${String(body.total ?? 0)}`);
        }
        lines.push(`${crop.id}: ${found.join(", ")}`);
      }
      return lines.join("\n");
    }),
  );
  return results;
}

runIfMain(import.meta.url, probeDataGovIn);
