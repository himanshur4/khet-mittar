import type { ModelMessage } from "ai";
import type { LanguageId } from "@config/languages";
import type { GuardrailReport } from "@/core/guardrails/grounding";
import type { Citation, RegisteredTool } from "@/core/tools/types";

export interface TraceStep {
  index: number;
  kind: "llm" | "tool" | "guardrail" | "error";
  /** Model id for llm steps, tool name for tool steps. */
  name: string;
  status: "ok" | "error" | "invalid_args" | "fallback";
  args?: unknown;
  summary?: string;
  latencyMs: number;
  attempt?: number;
  error?: string;
  citationIds?: string[];
}

/** Server-sent events emitted while a turn runs (consumed by the chat UI and trace panel). */
export type AgentEvent =
  | {
      type: "turn_start";
      turnId: string;
      conversationId: string | null;
      model: string;
      promptVersion: string;
    }
  | { type: "step"; step: TraceStep }
  | { type: "text_delta"; text: string }
  /** Discard streamed draft text (the model went on to call tools, or we switched model). */
  | { type: "text_reset" }
  | {
      type: "final";
      turnId: string;
      answer: string;
      citations: Citation[];
      guardrail: GuardrailReport;
      language: LanguageId;
    }
  | { type: "error"; code: string; message: string };

export interface LlmToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  /** The provider returned arguments that were not even parseable JSON. */
  invalid: boolean;
}

export interface LlmStepResult {
  text: string;
  toolCalls: LlmToolCall[];
  /** Assistant message(s) exactly as returned (keeps provider metadata like thought signatures). */
  responseMessages: ModelMessage[];
  finishReason: string;
}

/** One model call. The orchestrator owns the loop; this is just transport. */
export interface LlmClient {
  modelId: string;
  step(params: {
    system: string;
    messages: ModelMessage[];
    tools: RegisteredTool[];
    toolChoice: "auto" | "none";
    onTextDelta: (text: string) => void;
    signal: AbortSignal;
  }): Promise<LlmStepResult>;
}

export interface TraceSink {
  record(step: TraceStep): void;
  /** Resolves once every recorded step is durably written (or failed and was logged). */
  flush(): Promise<void>;
}
