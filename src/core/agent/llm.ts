/**
 * LlmClient backed by the Vercel AI SDK. Tools are passed as JSON Schema *without* `execute`
 * and without SDK-side validation, so the model can only propose calls; our orchestrator
 * validates (Zod) and executes them. That keeps the agent loop and its error handling ours.
 */
import { jsonSchema, streamText, type JSONSchema7, type ToolSet } from "ai";
import type { ChatModelHandle } from "./providers";
import type { LlmClient } from "./types";

export function createAiSdkClient(handle: ChatModelHandle): LlmClient {
  return {
    modelId: handle.modelId,
    async step({ system, messages, tools, toolChoice, onTextDelta, signal }) {
      const toolSet: ToolSet = Object.fromEntries(
        tools.map((t) => [
          t.name,
          { description: t.description, inputSchema: jsonSchema(t.inputJsonSchema as JSONSchema7) },
        ]),
      );
      const result = streamText({
        model: handle.model,
        system,
        messages,
        // With no tools at all, send neither field: some providers reject a bare toolChoice.
        ...(tools.length > 0 ? { tools: toolSet, toolChoice } : {}),
        providerOptions: handle.providerOptions,
        // One quick retry inside the SDK; model fallback is handled by the orchestrator.
        maxRetries: 1,
        abortSignal: signal,
      });

      let text = "";
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          text += part.text;
          onTextDelta(part.text);
        } else if (part.type === "error") {
          throw part.error;
        }
      }
      const [toolCalls, responseMessages, finishReason] = await Promise.all([
        result.toolCalls,
        result.responseMessages,
        result.finishReason,
      ]);
      return {
        text,
        toolCalls: toolCalls.map((c) => ({
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: c.input,
          invalid: "invalid" in c && c.invalid === true,
        })),
        responseMessages,
        finishReason,
      };
    },
  };
}
