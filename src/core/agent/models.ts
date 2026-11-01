/**
 * Default model IDs per provider, verified against the providers' model catalogues and the
 * installed AI SDK on 1 Nov 2026. Override with LLM_MODEL / LLM_FALLBACK_MODEL / EMBEDDING_MODEL.
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
    chat: "gemini-3.8-flash",
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
