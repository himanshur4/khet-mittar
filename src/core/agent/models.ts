/**
 * Default model IDs per provider, verified against the providers' model catalogues and the
 * installed AI SDK on 1 Nov 2026. Override with LLM_MODEL / LLM_FALLBACK_MODEL / EMBEDDING_MODEL.
 *
 * Gemini primary is 3.6 Flash, not the newer 3.8 Flash: on 1 Nov 2026 3.8 returned "high demand"
 * errors and timed out (>30 s per tool call), while 3.6 answered tool calls in 1–2 s.
 */
import type { LlmProviderName } from "@/core/lib/env";

export interface ProviderModels {
  /** Main reasoning + tool-calling model. */
  chat: string;
  /** Smaller, faster model used when the main model errors or times out. */
  fallback: string;
  embedding: string;
}

export const DEFAULT_MODELS: Record<LlmProviderName, ProviderModels> = {
  google: {
    chat: "gemini-3.6-flash",
    fallback: "gemini-3.5-flash-lite",
    embedding: "gemini-embedding-2",
  },
  openai: {
    chat: "gpt-6.1-terra",
    fallback: "gpt-6-luna",
    embedding: "text-embedding-3-small",
  },
};

/**
 * Both default embedding models are Matryoshka-trained, so they can be truncated to 768 dims
 * with little quality loss. 768 keeps the pgvector HNSW index small (the index limit is 2000).
 * Changing this requires a migration and re-ingesting every document.
 */
export const EMBEDDING_DIMENSIONS = 768;
