/**
 * Test double for the LLM: replays a script of steps. Each step either requests tool calls or
 * answers with text, and may inspect the conversation so far (e.g. to echo a tool's number).
 */
import type { ModelMessage } from "ai";
import type { LlmClient, LlmStepResult } from "../types";

export type ScriptedStep =
  | { calls: Array<{ name: string; input: unknown }> }
  | { answer: string | ((messages: ModelMessage[]) => string) }
  | { throws: Error };

export interface FakeLlm extends LlmClient {
  calls: Array<{ toolChoice: "auto" | "none"; toolNames: string[]; messages: ModelMessage[] }>;
}

export function fakeLlm(script: ScriptedStep[], modelId = "fake-model"): FakeLlm {
  let i = 0;
  const calls: FakeLlm["calls"] = [];
  return {
    modelId,
    calls,
    async step({ messages, tools, toolChoice, onTextDelta }): Promise<LlmStepResult> {
      calls.push({ toolChoice, toolNames: tools.map((t) => t.name), messages: [...messages] });
      const step = script[Math.min(i, script.length - 1)]!;
      i++;
      if ("throws" in step) throw step.throws;
      if ("calls" in step) {
        const parts = step.calls.map((c, n) => ({
          type: "tool-call" as const,
          toolCallId: `call-${i}-${n}`,
          toolName: c.name,
          input: c.input,
        }));
        return {
          text: "",
          toolCalls: parts.map((p) => ({ ...p, invalid: false })),
          responseMessages: [{ role: "assistant", content: parts }],
          finishReason: "tool-calls",
        };
      }
      const text = typeof step.answer === "function" ? step.answer(messages) : step.answer;
      onTextDelta(text);
      return {
        text,
        toolCalls: [],
        responseMessages: [{ role: "assistant", content: text }],
        finishReason: "stop",
      };
    },
  };
}

/** Pulls the JSON payload of the latest successful result for `toolName` out of the messages. */
export function lastToolData(messages: ModelMessage[], toolName: string): unknown {
  for (const m of [...messages].reverse()) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (
        part.type === "tool-result" &&
        part.toolName === toolName &&
        part.output.type === "json"
      ) {
        return (part.output.value as { data: unknown }).data;
      }
    }
  }
  return undefined;
}
