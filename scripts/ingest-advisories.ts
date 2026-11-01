/**
 * Ingest official advisories into pgvector.
 *   npm run ingest                    # all sources (unchanged ones are skipped)
 *   npm run ingest -- --only niphm-ipm-onion,pau-pop-rabi
 *   npm run ingest -- --force         # re-embed even if unchanged
 *   npm run ingest -- --dry-run       # fetch + parse + chunk only (no key or DB needed)
 */
import { ADVISORY_SOURCES } from "../config/advisory-sources";
import { describeError } from "../src/core/lib/errors";
import { request } from "../src/core/lib/http";
import { createEmbedder } from "../src/core/rag/embed";
import { ingestSource, type IngestDeps } from "../src/core/rag/ingest";
import { getDb } from "../src/db/client";
import { getDocumentMeta, replaceDocument } from "../src/db/vector";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1])?.split(",")
  : undefined;

const sources = ADVISORY_SOURCES.filter((s) => !only || only.includes(s.id));
if (sources.length === 0) {
  console.error(`No sources match --only ${only?.join(",")}`);
  process.exit(1);
}

let deps: IngestDeps;
try {
  deps = {
    embedder: dryRun ? null : createEmbedder(),
    store: dryRun ? null : { getDocumentMeta, replaceDocument },
    async fetchBytes(url) {
      const res = await request({
        provider: "advisory source",
        url,
        init: { headers: { "user-agent": "KhetMitra-ingest/1.0 (+advisory RAG)" } },
        timeoutMs: 90_000,
        retries: 2,
      });
      return new Uint8Array(await res.arrayBuffer());
    },
    log: (m) => console.log(m),
  };
} catch (error) {
  console.error(`Cannot start ingestion: ${describeError(error)}`);
  console.error("Tip: `npm run ingest -- --dry-run` checks fetching and chunking without keys.");
  process.exit(1);
}

console.log(`Ingesting ${sources.length} source(s)${dryRun ? " (dry run)" : ""}…`);
let failed = 0;
for (const source of sources) {
  const result = await ingestSource(source, deps, { force, dryRun });
  switch (result.status) {
    case "ingested":
      console.log(
        `✓ ${result.id}: ${result.chunks} chunks from ${result.pages} pages (${result.ms} ms)`,
      );
      break;
    case "unchanged":
      console.log(`= ${result.id}: unchanged, skipped (${result.ms} ms)`);
      break;
    case "dry-run":
      console.log(
        `· ${result.id}: ${result.chunks} chunks, ${result.chars} chars, ${result.pages} pages (${result.ms} ms)\n    sample: ${result.sample}`,
      );
      break;
    case "failed":
      failed++;
      console.log(`✗ ${result.id}: ${result.error}`);
  }
}
if (!dryRun) await getDb().$disconnect();
console.log(failed ? `${failed} source(s) failed; re-run to retry them.` : "Done.");
process.exit(failed ? 1 : 0);
