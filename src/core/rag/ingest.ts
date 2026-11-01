/**
 * Ingestion pipeline: fetch → parse → chunk (with overlap) → embed → store.
 * Re-running is cheap: a document whose bytes and embedding model are unchanged is skipped.
 */
import { createHash } from "node:crypto";
import type { AdvisorySource } from "@config/advisory-sources";
import { describeError } from "@/core/lib/errors";
import { chunkPages, type PageText, type TextChunk } from "./chunk";
import type { Embedder } from "./embed";
import { parseHtml, parsePdf, selectPages } from "./parse";

export interface StoredDocumentMeta {
  contentHash: string;
  embeddingModel: string;
}

export interface IngestStore {
  getDocumentMeta(id: string): Promise<StoredDocumentMeta | null>;
  replaceDocument(
    doc: {
      id: string;
      title: string;
      publisher: string;
      url: string;
      region: string;
      language: string;
      crops: string[];
      contentHash: string;
      embeddingModel: string;
      pageCount: number | null;
      fetchedAt: Date;
    },
    chunks: Array<{
      chunkIndex: number;
      section: string | null;
      pageFrom: number | null;
      pageTo: number | null;
      crops: string[];
      content: string;
      tokenEstimate: number;
      embedding: number[];
    }>,
  ): Promise<void>;
}

export interface IngestDeps {
  embedder: Embedder | null;
  store: IngestStore | null;
  fetchBytes(url: string): Promise<Uint8Array>;
  log(message: string): void;
}

export type IngestResult =
  | { id: string; status: "ingested"; chunks: number; pages: number; ms: number }
  | { id: string; status: "unchanged"; ms: number }
  | {
      id: string;
      status: "dry-run";
      chunks: number;
      pages: number;
      chars: number;
      sample: string;
      ms: number;
    }
  | { id: string; status: "failed"; error: string; ms: number };

export interface TaggedChunk extends TextChunk {
  crops: string[];
}

/** Applies the source's section page ranges (if any) and crop tags. */
export function chunkSource(source: AdvisorySource, pages: PageText[]): TaggedChunk[] {
  if (source.sections && source.sections.length > 0) {
    return source.sections.flatMap((section) =>
      chunkPages(selectPages(pages, section.pages[0], section.pages[1]), section.label).map(
        (c) => ({
          ...c,
          crops: section.crops,
        }),
      ),
    );
  }
  const crops = source.crops === "all" ? ["all"] : source.crops;
  return chunkPages(pages, null).map((c) => ({ ...c, crops }));
}

const EMBED_BATCH = 64;

export async function ingestSource(
  source: AdvisorySource,
  deps: IngestDeps,
  options: { force?: boolean; dryRun?: boolean } = {},
): Promise<IngestResult> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  try {
    const bytes = await deps.fetchBytes(source.url);
    const contentHash = createHash("sha256").update(bytes).digest("hex");

    if (!options.dryRun && !options.force && deps.store && deps.embedder) {
      const existing = await deps.store.getDocumentMeta(source.id);
      if (
        existing?.contentHash === contentHash &&
        existing.embeddingModel === deps.embedder.modelId
      ) {
        return { id: source.id, status: "unchanged", ms: ms() };
      }
    }

    const pages =
      source.format === "pdf" ? await parsePdf(bytes) : parseHtml(new TextDecoder().decode(bytes));
    const chunks = chunkSource(source, pages);
    const chars = chunks.reduce((n, c) => n + c.content.length, 0);
    if (chars < 500) throw new Error("no extractable text (scanned PDF or empty page?)");

    if (options.dryRun) {
      const sample = chunks[Math.floor(chunks.length / 2)];
      return {
        id: source.id,
        status: "dry-run",
        chunks: chunks.length,
        pages: pages.length,
        chars,
        sample: sample
          ? `[${sample.section ?? "-"} p.${sample.pageFrom}] ${sample.content.slice(0, 220)}`
          : "",
        ms: ms(),
      };
    }
    if (!deps.embedder || !deps.store) throw new Error("embedder and database are required");

    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      deps.log(`  ${source.id}: embedding ${i + batch.length}/${chunks.length}`);
      // The document title + section travel with the text: "contextual chunk headers"
      // help retrieval tell "irrigation" in a wheat guide from irrigation in an onion guide.
      embeddings.push(
        ...(await deps.embedder.embedDocuments(
          batch.map((c) => ({
            title: [source.title, c.section].filter(Boolean).join(" — "),
            text: c.content,
          })),
        )),
      );
    }

    await deps.store.replaceDocument(
      {
        id: source.id,
        title: source.title,
        publisher: source.publisher,
        url: source.url,
        region: source.region,
        language: source.language,
        crops: source.crops === "all" ? ["all"] : source.crops,
        contentHash,
        embeddingModel: deps.embedder.modelId,
        pageCount: pages.length,
        fetchedAt: new Date(),
      },
      chunks.map((c, i) => ({
        chunkIndex: i,
        section: c.section,
        pageFrom: c.pageFrom,
        pageTo: c.pageTo,
        crops: c.crops,
        content: c.content,
        tokenEstimate: c.tokenEstimate,
        embedding: embeddings[i]!,
      })),
    );
    return {
      id: source.id,
      status: "ingested",
      chunks: chunks.length,
      pages: pages.length,
      ms: ms(),
    };
  } catch (error) {
    return { id: source.id, status: "failed", error: describeError(error), ms: ms() };
  }
}
