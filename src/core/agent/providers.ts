/**
 * Creates AI SDK provider instances from env. The AI SDK is only our transport (HTTP + message
 * format per vendor); the agent loop itself lives in orchestrator.ts.
 */
import { createGoogle, type GoogleProvider } from "@ai-sdk/google";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import type { embed, EmbeddingModel, LanguageModel } from "ai";
import { apiKeyVarFor, getEnv, requireEnv, type LlmProviderName } from "@/core/lib/env";
import { DEFAULT_MODELS, EMBEDDING_DIMENSIONS } from "./models";

/** The SDK's own provider-options type (JSON values keyed by provider name). */
export type ProviderOptions = NonNullable<Parameters<typeof embed>[0]["providerOptions"]>;

export interface ChatModelHandle {
  provider: LlmProviderName;
  modelId: string;
  model: LanguageModel;
  providerOptions: ProviderOptions;
}

export interface EmbeddingModelHandle {
  provider: LlmProviderName;
  modelId: string;
  model: EmbeddingModel;
  providerOptions: ProviderOptions;
}

function google(): GoogleProvider {
  return createGoogle({
    apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY", "LLM (Google Gemini)"),
  });
}

function openai(): OpenAIProvider {
  return createOpenAI({ apiKey: requireEnv("OPENAI_API_KEY", "LLM (OpenAI)") });
}

function chatHandle(provider: LlmProviderName, modelId: string): ChatModelHandle {
  if (provider === "google") {
    return {
      provider,
      modelId,
      model: google()(modelId),
      // Low thinking keeps tool-calling turns fast enough for a voice conversation.
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    };
  }
  return { provider, modelId, model: openai()(modelId), providerOptions: {} };
}

/**
 * Primary model plus an optional fallback (same provider's smaller model by default, or another
 * provider via LLM_FALLBACK_PROVIDER). Throws `MissingConfigError` if the primary key is missing.
 */
export function resolveChatModels(): {
  primary: ChatModelHandle;
  fallback: ChatModelHandle | null;
} {
  const env = getEnv();
  const primaryProvider = env.LLM_PROVIDER;
  const primary = chatHandle(
    primaryProvider,
    env.LLM_MODEL ?? DEFAULT_MODELS[primaryProvider].chat,
  );
  const fallbackProvider = env.LLM_FALLBACK_PROVIDER ?? primaryProvider;
  let fallback: ChatModelHandle | null = null;
  if (env[apiKeyVarFor(fallbackProvider)]) {
    const fallbackId = env.LLM_FALLBACK_MODEL ?? DEFAULT_MODELS[fallbackProvider].fallback;
    if (fallbackProvider !== primaryProvider || fallbackId !== primary.modelId) {
      fallback = chatHandle(fallbackProvider, fallbackId);
    }
  }
  return { primary, fallback };
}

export function resolveEmbeddingModel(): EmbeddingModelHandle {
  const env = getEnv();
  const provider = env.EMBEDDING_PROVIDER ?? env.LLM_PROVIDER;
  const modelId = env.EMBEDDING_MODEL ?? DEFAULT_MODELS[provider].embedding;
  if (provider === "google") {
    return {
      provider,
      modelId,
      model: google().embedding(modelId),
      providerOptions: { google: { outputDimensionality: EMBEDDING_DIMENSIONS } },
    };
  }
  return {
    provider,
    modelId,
    model: openai().embedding(modelId),
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
  };
}
