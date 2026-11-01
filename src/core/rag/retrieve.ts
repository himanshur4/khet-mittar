/**
 * Retrieval: embed the question, find the nearest chunks in pgvector, keep the relevant ones.
 * Concept: RAG is an open-book exam: look up the right pages first, then answer only from them.
 */
import type { ChunkMatch } from "@/db/vector";
import type { Embedder } from "./embed";

export type RetrievedPassage = ChunkMatch;

export interface AdvisoryRetriever {
  search(query: string, options: { crops?: string[]; limit?: number }): Promise<RetrievedPassage[]>;
  /** Searchable chunk count for the active embedding model (0 = not ingested yet). */
  indexedChunks(): Promise<number>;
}

/**
 * Floor on cosine similarity. Low on purpose: it only drops clearly unrelated text; the LLM
 * judges relevance among what's left (and sees the score).
 */
const MIN_SIMILARITY = 0.3;

export function createAdvisoryRetriever(deps: {
  embedder: Embedder;
  searchChunks(params: {
    embedding: number[];
    embeddingModel: string;
    crops?: string[];
    limit: number;
  }): Promise<ChunkMatch[]>;
  countChunks(embeddingModel: string): Promise<number>;
}): AdvisoryRetriever {
  return {
    async search(query, { crops, limit = 5 }) {
      const embedding = await deps.embedder.embedQuery(query);
      // Over-fetch, then trim: overlapping neighbour chunks often both match.
      const matches = await deps.searchChunks({
        embedding,
        embeddingModel: deps.embedder.modelId,
        crops,
        limit: limit * 2,
      });
      const seen = new Set<string>();
      return matches
        .filter((m) => m.similarity >= MIN_SIMILARITY)
        .filter((m) => {
          const key = `${m.documentId}:${m.pageFrom}:${m.content.slice(0, 80)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, limit);
    },
    indexedChunks: () => deps.countChunks(deps.embedder.modelId),
  };
}
