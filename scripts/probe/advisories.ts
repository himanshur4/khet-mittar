/** Probe: every advisory source URL is reachable and yields extractable text. */
import { extractText, getDocumentProxy } from "unpdf";
import { ADVISORY_SOURCES } from "../../config/advisory-sources";
import { assert, probe, runIfMain, type ProbeResult } from "./_probe";

export async function probeAdvisories(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const source of ADVISORY_SOURCES) {
    results.push(
      await probe(`Advisory: ${source.id}`, async () => {
        const started = Date.now();
        const res = await fetch(source.url, {
          headers: { "user-agent": "KhetMitra-ingest/1.0 (+advisory RAG)" },
          signal: AbortSignal.timeout(90_000),
        });
        assert(res.ok, `HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const sizeKb = Math.round(bytes.length / 1024);
        assert(bytes.length > 0, "empty body");
        if (source.format !== "pdf")
          return `${bytes.length} bytes HTML in ${Date.now() - started} ms`;
        const pdf = await getDocumentProxy(bytes);
        const { totalPages, text } = await extractText(pdf, { mergePages: true });
        assert(text.trim().length > 500, "PDF has no extractable text (scanned?)");
        return `${totalPages} pages, ${text.length} chars, ${sizeKb} KB, ${Date.now() - started} ms`;
      }),
    );
  }
  return results;
}

runIfMain(import.meta.url, probeAdvisories);
