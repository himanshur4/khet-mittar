/** Runs every probe and prints one summary. `npm run probe` (reads .env if present). */
import { printResults, type ProbeResult } from "./_probe";
import { probeAdvisories } from "./advisories";
import { probeDataGovIn } from "./data-gov-in";
import { probeLlm } from "./llm";
import { probeOpenMeteo } from "./open-meteo";
import { probeSarvam } from "./sarvam";
import { probeSoilGrids } from "./soilgrids";

const groups: Array<[string, () => Promise<ProbeResult[]>]> = [
  ["Open-Meteo", probeOpenMeteo],
  ["SoilGrids", probeSoilGrids],
  ["data.gov.in", probeDataGovIn],
  ["Sarvam AI", probeSarvam],
  ["LLM providers", probeLlm],
  ["Advisory documents", probeAdvisories],
];

const all: ProbeResult[] = [];
for (const [label, run] of groups) {
  console.log(`\n== ${label}`);
  const results = await run();
  printResults(results);
  all.push(...results);
}

const count = (s: ProbeResult["status"]) => all.filter((r) => r.status === s).length;
console.log(
  `\nSummary: ${count("ok")} ok, ${count("fail")} failed, ${count("skipped")} skipped (missing keys)`,
);
process.exitCode = count("fail") > 0 ? 1 : 0;
