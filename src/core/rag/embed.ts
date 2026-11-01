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

export function createEmbedder(handle: EmbeddingModelHandle = resolveEmbeddingModel()): Embedder {
  const format = formatForModel(handle);
  return {
    modelId: handle.modelId,
    async embedDocuments(docs) {
      const { embeddings } = await embedMany({
        model: handle.model,
        values: docs.map((d) => format.doc(d.title, d.text)),
        providerOptions: handle.providerOptions,
        // Gentle on free-tier rate limits; the SDK retries 429s with backoff.
        maxParallelCalls: 2,
        maxRetries: 4,
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
