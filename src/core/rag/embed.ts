/**
 * Embeddings: text → 768-number vector where similar meanings land close together.
 * Concept: like a hash that preserves meaning, so "first irrigation of wheat" and
 * "गेहूं की पहली सिंचाई" map to nearby points.
 */
import { embed, embedMany } from "ai";
import { resolveEmbeddingModel, type EmbeddingModelHandle } from "@/core/agent/providers";

export interface Embedder {
  modelId: string;
  embedDocuments(docs: Array<{ title: string; text: string }>): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}

/**
 * gemini-embedding-2 takes its task as a text prefix instead of a `taskType` parameter
 * (Google embeddings guide); asymmetric prefixes improve query→document retrieval.
 */
function formatForModel(handle: EmbeddingModelHandle) {
  const prefixed = handle.provider === "google" && handle.modelId.startsWith("gemini-embedding-2");
  return {
    doc: (title: string, text: string) =>
      prefixed ? `title: ${title} | text: ${text}` : `${title}\n${text}`,
    query: (q: string) => (prefixed ? `task: search result | query: ${q}` : q),
  };
}

export function createEmbedder(
  handle: EmbeddingModelHandle = resolveEmbeddingModel(),
  options: { documentRetries?: number } = {},
): Embedder {
  const format = formatForModel(handle);
  return {
    modelId: handle.modelId,
    async embedDocuments(docs) {
      const { embeddings } = await embedMany({
        model: handle.model,
        values: docs.map((d) => format.doc(d.title, d.text)),
        providerOptions: handle.providerOptions,
        maxParallelCalls: 2,
        maxRetries: options.documentRetries ?? 4,
      });
      return embeddings;
    },
    async embedQuery(query) {
      const { embedding } = await embed({
        model: handle.model,
        value: format.query(query),
        providerOptions: handle.providerOptions,
        maxRetries: 2,
        abortSignal: AbortSignal.timeout(10_000),
      });
      return embedding;
    },
  };
}

/** The provider's daily embedding quota is used up; waiting minutes won't help. */
export class DailyQuotaError extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Paces bulk embedding under a per-minute quota. Gemini's free tier allows 100 embed requests
 * per minute and counts each text in a batch (observed 1 Nov 2026), so a fast ingest fails
 * after ~100 chunks. This keeps a sliding 60 s window under `perMinute` and, if the provider
 * still says "retry in Ns", waits that long and retries the same batch.
 */
export function createPacedEmbedder(
  inner: Embedder,
  options: { perMinute: number; log?: (message: string) => void; maxQuotaWaits?: number },
): Embedder {
  const sent: number[] = [];
  const slice = Math.max(1, Math.floor(options.perMinute / 3));

  const reserve = async (count: number) => {
    for (;;) {
      const now = Date.now();
      while (sent.length > 0 && now - sent[0]! >= 60_000) sent.shift();
      if (sent.length + count <= options.perMinute) {
        for (let i = 0; i < count; i++) sent.push(now);
        return;
      }
      await sleep(60_000 - (now - sent[0]!) + 250);
    }
  };

  return {
    modelId: inner.modelId,
    embedQuery: (query) => inner.embedQuery(query),
    async embedDocuments(docs) {
      const out: number[][] = [];
      for (let i = 0; i < docs.length; i += slice) {
        const part = docs.slice(i, i + slice);
        for (let attempt = 0; ; attempt++) {
          await reserve(part.length);
          try {
            out.push(...(await inner.embedDocuments(part)));
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!/quota|429|RESOURCE_EXHAUSTED|rate.?limit/i.test(message)) throw error;
            // Google's 429 text can name several quotas; only stop when the per-day one is the
            // sole limit hit. A per-minute limit always gets the wait-and-retry path.
            const perDay = /per.?day|PerDay/i.test(message);
            const perMinute = /per.?minute|PerMinute/i.test(message);
            if (perDay && !perMinute) {
              const detail = /Quota exceeded for metric[^\n]*/i.exec(message)?.[0] ?? message;
              throw new DailyQuotaError(
                `Daily embedding quota reached (${detail.slice(0, 200)}). Run "npm run ingest" again tomorrow; finished documents are skipped.`,
              );
            }
            if (attempt >= (options.maxQuotaWaits ?? 6)) throw error;
            const seconds = Number(/retry in ([\d.]+)s/i.exec(message)?.[1] ?? 60);
            options.log?.(
              `  rate limit reached; waiting ${Math.ceil(seconds)} s as the provider asks…`,
            );
            await sleep((seconds + 1) * 1000);
          }
        }
      }
      return out;
    },
  };
}
