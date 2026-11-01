/**
 * Probe: LLM providers. Confirms the default model IDs exist for this key, that tool calling
 * returns a structured call (one round, executed by nobody), and the embedding dimension.
 */
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, generateText, jsonSchema, type LanguageModel, type EmbeddingModel } from "ai";
import { DEFAULT_MODELS, EMBEDDING_DIMENSIONS } from "../../src/core/agent/models";
import { assert, http, probe, requireKey, runIfMain, type ProbeResult } from "./_probe";

const weatherTool = {
  description: "Get the weather forecast for a place in India.",
  inputSchema: jsonSchema({
    type: "object",
    properties: { place: { type: "string", description: "Place name in Latin script" } },
    required: ["place"],
  }),
};

async function toolCallRound(model: LanguageModel): Promise<string> {
  const started = Date.now();
  const result = await generateText({
    model,
    tools: { get_weather: weatherTool },
    prompt: "Will it rain in Nashik in the next two days?",
    maxRetries: 0,
  });
  const call = result.toolCalls[0];
  assert(call, `model answered without a tool call: ${result.text.slice(0, 120)}`);
  return `${Date.now() - started} ms; tool call ${call.toolName}(${JSON.stringify(call.input)}), finishReason=${result.finishReason}`;
}

async function embeddingDims(
  model: EmbeddingModel,
  providerOptions: Record<string, Record<string, number>>,
) {
  const { embedding } = await embed({
    model,
    value: "गेहूं में पहली सिंचाई कब करें?",
    providerOptions,
    maxRetries: 0,
  });
  assert(
    embedding.length === EMBEDDING_DIMENSIONS,
    `expected ${EMBEDDING_DIMENSIONS} dims, got ${embedding.length}`,
  );
  return `${embedding.length} dims`;
}

export async function probeLlm(): Promise<ProbeResult[]> {
  const g = DEFAULT_MODELS.google;
  const o = DEFAULT_MODELS.openai;
  return [
    await probe("Gemini model catalogue", async () => {
      const key = requireKey("GOOGLE_GENERATIVE_AI_API_KEY");
      const r = await http(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`,
      );
      assert(r.status === 200, `HTTP ${r.status}`);
      const names = ((r.json as { models?: Array<{ name: string }> }).models ?? []).map((m) =>
        m.name.replace("models/", ""),
      );
      const wanted = [g.chat, g.fallback, g.embedding];
      const missing = wanted.filter((w) => !names.includes(w));
      assert(missing.length === 0, `not available for this key: ${missing.join(", ")}`);
      return `${wanted.join(", ")} available (${names.length} models listed)`;
    }),
    await probe(`Gemini tool calling (${g.chat})`, async () => {
      const google = createGoogle({ apiKey: requireKey("GOOGLE_GENERATIVE_AI_API_KEY") });
      return toolCallRound(google(g.chat));
    }),
    await probe(`Gemini tool calling, fallback model (${g.fallback})`, async () => {
      const google = createGoogle({ apiKey: requireKey("GOOGLE_GENERATIVE_AI_API_KEY") });
      return toolCallRound(google(g.fallback));
    }),
    await probe(`Gemini embeddings (${g.embedding})`, async () => {
      const google = createGoogle({ apiKey: requireKey("GOOGLE_GENERATIVE_AI_API_KEY") });
      return embeddingDims(google.embedding(g.embedding), {
        google: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });
    }),
    await probe(`OpenAI tool calling (${o.chat})`, async () => {
      const openai = createOpenAI({ apiKey: requireKey("OPENAI_API_KEY") });
      return toolCallRound(openai(o.chat));
    }),
    await probe(`OpenAI embeddings (${o.embedding})`, async () => {
      const openai = createOpenAI({ apiKey: requireKey("OPENAI_API_KEY") });
      return embeddingDims(openai.embedding(o.embedding), {
        openai: { dimensions: EMBEDDING_DIMENSIONS },
      });
    }),
  ];
}

runIfMain(import.meta.url, probeLlm);
