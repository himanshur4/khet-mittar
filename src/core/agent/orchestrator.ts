/**
 * The agent loop (our own, not a framework's).
 *
 * Concept: an agent loop is an event loop with a step budget. Each step the LLM either answers
 * or asks for tools; we validate the requested arguments, run the tools (in parallel), append
 * the results to the conversation and ask again. The budget bounds cost and latency, and the
 * last step forces an answer so the farmer is never left without a reply.
 */
import { randomUUID } from "node:crypto";
import type { JSONValue, ModelMessage, ToolResultPart } from "ai";
import type { LanguageId } from "@config/languages";
import {
  applyGrounding,
  type EvidenceItem,
  type GuardrailReport,
} from "@/core/guardrails/grounding";
import {
  AppError,
  describeError,
  MissingConfigError,
  ProviderTimeoutError,
} from "@/core/lib/errors";
import { istDateKey, truncate } from "@/core/lib/format";
import { logger } from "@/core/lib/logger";
import type { FarmerContext } from "@/core/profile/types";
import type { ToolRegistry } from "@/core/tools/registry";
import type { Citation, RegisteredTool, SourceRef } from "@/core/tools/types";
import { AGENT_MESSAGES } from "./messages";
import { buildSystemPrompt, profileFacts, PROMPT_VERSION } from "./prompts/system";
import type {
  AgentEvent,
  LlmClient,
  LlmStepResult,
  LlmToolCall,
  TraceSink,
  TraceStep,
} from "./types";

export interface AgentLimits {
  /** LLM calls per turn. 6 covers plan → 2–3 tool rounds → answer with room for one retry. */
  maxSteps: number;
  /** Failed attempts allowed per tool before it is disabled for the turn. */
  maxToolRetries: number;
  maxToolCallsPerStep: number;
  /** Wall-clock budget; once exceeded, the next step must answer with what it has. */
  turnBudgetMs: number;
  llmTimeoutMs: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxSteps: 6,
  maxToolRetries: 2,
  maxToolCallsPerStep: 6,
  turnBudgetMs: 45_000,
  llmTimeoutMs: 25_000,
};

export interface RunTurnParams {
  question: string;
  history: ModelMessage[];
  farmer: FarmerContext | null;
  language: LanguageId;
  tools: ToolRegistry;
  models: { primary: LlmClient; fallback: LlmClient | null };
  emit: (event: AgentEvent) => void;
  trace?: TraceSink;
  conversationId: string | null;
  signal?: AbortSignal;
  limits?: Partial<AgentLimits>;
  now?: Date;
  turnId?: string;
  /** Data fetched before the turn (cited like tool results). */
  context?: Array<{ label: string; source: SourceRef; data: unknown }>;
}

export interface TurnResult {
  turnId: string;
  answer: string;
  citations: Citation[];
  guardrail: GuardrailReport | null;
  steps: TraceStep[];
  ok: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError(name, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Tools mark per-item sources with `sourceIndex`; swap in the citation id the model will cite. */
function attachCitationIds(value: unknown, ids: string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => attachCitationIds(v, ids));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "sourceIndex" && typeof v === "number") out.sourceId = ids[v] ?? null;
      else out[k] = attachCitationIds(v, ids);
    }
    return out;
  }
  return value;
}

/** Evidence for the guardrail: per-item where items carry their own source, else the whole payload. */
function collectEvidence(data: unknown, ids: string[], kinds: Citation["kind"][]): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const record = v as Record<string, unknown>;
      if (typeof record.sourceId === "string") {
        const i = ids.indexOf(record.sourceId);
        items.push({
          citationId: record.sourceId,
          kind: kinds[i] ?? "tool",
          text: JSON.stringify(v),
        });
      } else Object.values(record).forEach(walk);
    }
  };
  walk(data);
  if (items.length === 0) {
    items.push({
      citationId: ids[0] ?? null,
      kind: kinds[0] ?? "tool",
      text: JSON.stringify(data),
    });
  }
  return items;
}

export async function runAgentTurn(p: RunTurnParams): Promise<TurnResult> {
  const limits = { ...DEFAULT_LIMITS, ...p.limits };
  const turnId = p.turnId ?? randomUUID();
  const started = Date.now();
  const log = logger.child({ turnId });
  const steps: TraceStep[] = [];
  const pushStep = (s: Omit<TraceStep, "index">) => {
    const step: TraceStep = { ...s, index: steps.length };
    steps.push(step);
    p.trace?.record(step);
    p.emit({ type: "step", step });
  };

  const system = buildSystemPrompt({ farmer: p.farmer, language: p.language, now: p.now });
  const citations: Citation[] = [];
  const evidence: EvidenceItem[] = profileFacts(p.farmer, istDateKey(p.now)).map((text) => ({
    citationId: null,
    kind: "profile",
    text,
  }));
  // Pre-fetched data (e.g. the forecast that triggered an alert) gets citation ids up front.
  const contextLines = (p.context ?? []).map((c) => {
    const id = `S${citations.length + 1}`;
    citations.push({ ...c.source, id });
    evidence.push({ citationId: id, kind: c.source.kind, text: JSON.stringify(c.data) });
    return `[${id}] ${c.label}: ${JSON.stringify(c.data)}`;
  });
  const question =
    contextLines.length > 0
      ? `${p.question}\n\nData already fetched for you (cite it with its id):\n${contextLines.join("\n")}`
      : p.question;
  const messages: ModelMessage[] = [...p.history, { role: "user", content: question }];
  const failures = new Map<string, number>();
  const disabled = new Map<string, string>();
  let model = p.models.primary;
  let switchedToFallback = false;

  p.emit({
    type: "turn_start",
    turnId,
    conversationId: p.conversationId,
    model: model.modelId,
    promptVersion: PROMPT_VERSION,
  });

  // Hard ceiling for any single call: budget + grace for the forced final answer, so the whole
  // turn stays inside the serverless function limit (60 s).
  const remainingMs = () => Math.max(3_000, limits.turnBudgetMs + 10_000 - (Date.now() - started));

  const recordFailure = (name: string) => {
    const count = (failures.get(name) ?? 0) + 1;
    failures.set(name, count);
    return count;
  };

  const executeCall = async (call: LlmToolCall, skip: boolean): Promise<ToolResultPart> => {
    const t0 = Date.now();
    const attempt = (failures.get(call.toolName) ?? 0) + 1;
    const fail = (status: TraceStep["status"], error: string, message: string): ToolResultPart => {
      pushStep({
        kind: "tool",
        name: call.toolName,
        status,
        args: call.input,
        error,
        latencyMs: Date.now() - t0,
        attempt,
      });
      return {
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: "error-text", value: message },
      };
    };

    if (skip) {
      return fail(
        "error",
        "too many calls",
        "Skipped: too many tool calls in one step. Ask again for what is still needed.",
      );
    }
    const tool: RegisteredTool | undefined = p.tools.get(call.toolName);
    if (!tool) {
      const names = p.tools
        .list()
        .map((t) => t.name)
        .join(", ");
      return fail(
        "error",
        "unknown tool",
        `There is no tool named "${call.toolName}". Available tools: ${names}.`,
      );
    }
    const reason = disabled.get(tool.name);
    if (reason) {
      return fail(
        "error",
        reason,
        `${tool.name} is unavailable for this question (${reason}). Do not call it again; answer with the data you have and say what is missing.`,
      );
    }

    const validation = call.invalid
      ? ({ ok: false, issues: ["arguments were not valid JSON"] } as const)
      : tool.validate(call.input);
    if (!validation.ok) {
      const count = recordFailure(tool.name);
      const left = limits.maxToolRetries - count + 1;
      if (left <= 0) disabled.set(tool.name, "invalid arguments repeatedly");
      return fail(
        "invalid_args",
        validation.issues.join("; "),
        `Invalid arguments for ${tool.name}: ${validation.issues.join("; ")}. ${
          left > 0
            ? `Correct the arguments and call ${tool.name} again (${left} attempt${left > 1 ? "s" : ""} left).`
            : "No attempts left: answer without this tool and tell the farmer what is missing."
        }`,
      );
    }

    try {
      const output = await withTimeout(
        validation.run({ farmer: p.farmer, signal: p.signal }),
        Math.min(tool.timeoutMs, remainingMs()),
        tool.name,
      );
      const ids = output.sources.map((source) => {
        const id = `S${citations.length + 1}`;
        citations.push({ ...source, id });
        return id;
      });
      // Round-trip through JSON: drops undefined values the provider wire format rejects.
      const data = JSON.parse(
        JSON.stringify(attachCitationIds(output.data, ids) ?? null),
      ) as JSONValue;
      evidence.push(
        ...collectEvidence(
          data,
          ids,
          output.sources.map((s) => s.kind),
        ),
      );
      pushStep({
        kind: "tool",
        name: tool.name,
        status: "ok",
        args: call.input,
        summary: output.summary,
        latencyMs: Date.now() - t0,
        attempt,
        citationIds: ids,
      });
      const stale = output.sources.some((s) => s.freshness === "stale-cache");
      return {
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: tool.name,
        output: {
          type: "json",
          value: {
            sources: output.sources.map((s, i) => ({
              id: ids[i] ?? null,
              title: s.title,
              detail: s.detail ?? null,
              fetchedAt: s.fetchedAt,
              freshness: s.freshness ?? null,
            })),
            data,
            ...(stale
              ? {
                  note: "Provider unreachable: this is the last real data fetched (see fetchedAt). Tell the farmer it may be out of date.",
                }
              : {}),
          },
        },
      };
    } catch (error) {
      const count = recordFailure(tool.name);
      const config = error instanceof MissingConfigError;
      const left = limits.maxToolRetries - count + 1;
      if (config || left <= 0)
        disabled.set(tool.name, config ? "not configured on the server" : "repeated failures");
      const userMessage =
        error instanceof AppError ? error.userMessage : "the tool failed unexpectedly.";
      return fail(
        "error",
        describeError(error),
        config
          ? `${tool.name} is unavailable: ${userMessage} Do not call it again; tell the farmer this information is unavailable right now.`
          : `${tool.name} failed: ${userMessage} ${
              left > 0
                ? "You may retry once with corrected arguments, or continue without it."
                : "Do not call it again; continue without it and tell the farmer this data is unavailable."
            }`,
      );
    }
  };

  let answer: string | null = null;
  try {
    for (let stepNo = 0; stepNo < limits.maxSteps && answer === null; stepNo++) {
      if (p.signal?.aborted)
        throw new AppError("client disconnected", { code: "ABORTED", status: 499 });
      const outOfTime = Date.now() - started > limits.turnBudgetMs;
      const active = p.tools.list().filter((t) => !disabled.has(t.name));
      // Nothing left to call also means "answer now".
      const finalStep = stepNo === limits.maxSteps - 1 || outOfTime || active.length === 0;
      // On the answer step keep every declaration (providers reject tool-call history whose
      // tools are undeclared) but forbid calls with toolChoice "none".
      const tools = finalStep ? p.tools.list() : active;
      const t0 = Date.now();
      let streamed = false;
      let result: LlmStepResult;
      try {
        const timeout = AbortSignal.timeout(Math.min(limits.llmTimeoutMs, remainingMs()));
        result = await model.step({
          system,
          messages,
          tools,
          toolChoice: finalStep ? "none" : "auto",
          onTextDelta: (text) => {
            streamed = true;
            p.emit({ type: "text_delta", text });
          },
          signal: p.signal ? AbortSignal.any([p.signal, timeout]) : timeout,
        });
      } catch (error) {
        pushStep({
          kind: "llm",
          name: model.modelId,
          status: "error",
          error: describeError(error),
          latencyMs: Date.now() - t0,
        });
        if (streamed) p.emit({ type: "text_reset" });
        if (!switchedToFallback && p.models.fallback && !p.signal?.aborted) {
          switchedToFallback = true;
          model = p.models.fallback;
          pushStep({
            kind: "llm",
            name: model.modelId,
            status: "fallback",
            summary: `retrying with fallback model ${model.modelId}`,
            latencyMs: 0,
          });
          stepNo--; // the failed call doesn't use up the step budget
          continue;
        }
        throw error;
      }

      const calls = result.toolCalls;
      pushStep({
        kind: "llm",
        name: model.modelId,
        status: "ok",
        latencyMs: Date.now() - t0,
        summary:
          calls.length > 0
            ? `requested ${calls.map((c) => c.toolName).join(", ")}${finalStep ? " (ignored: final step)" : ""}`
            : `answered (${result.finishReason})`,
        ...(calls.length > 0 && result.text.trim()
          ? { args: { note: truncate(result.text.trim(), 240) } }
          : {}),
      });
      messages.push(...result.responseMessages);

      if (calls.length === 0 || finalStep) {
        answer = result.text.trim() || null;
        break;
      }
      if (streamed) p.emit({ type: "text_reset" });
      const results = await Promise.all(
        calls.map((call, i) => executeCall(call, i >= limits.maxToolCallsPerStep)),
      );
      messages.push({ role: "tool", content: results });
    }
  } catch (error) {
    const aborted = p.signal?.aborted ?? false;
    log.error("agent turn failed", { err: error, aborted });
    pushStep({
      kind: "error",
      name: "turn",
      status: "error",
      error: describeError(error),
      latencyMs: Date.now() - started,
    });
    const message = AGENT_MESSAGES.llmUnavailable[p.language];
    if (!aborted) {
      p.emit({
        type: "error",
        code: error instanceof AppError ? error.code : "AGENT_FAILED",
        message:
          error instanceof MissingConfigError ? `${message} (${error.userMessage})` : message,
      });
    }
    await p.trace?.flush();
    return { turnId, answer: message, citations: [], guardrail: null, steps, ok: false };
  }

  const t0 = Date.now();
  const grounded = applyGrounding(
    answer ?? AGENT_MESSAGES.incomplete[p.language],
    evidence,
    citations.map((c) => c.id),
    p.language,
  );
  const r = grounded.report;
  pushStep({
    kind: "guardrail",
    name: "grounding-check",
    status: "ok",
    latencyMs: Date.now() - t0,
    summary: `${r.supported}/${r.numericClaims} numeric sentences verified, ${r.autoCited} auto-cited, ${r.removed.length} removed${r.unknownCitationIds.length ? `, ${r.unknownCitationIds.length} unknown citation ids dropped` : ""}${r.languageMismatch ? ", language mismatch" : ""}`,
    ...(r.removed.length > 0 ? { args: { removed: r.removed } } : {}),
  });

  const cited = citations.filter((c) => grounded.citedIds.includes(c.id));
  const finalCitations = cited.length > 0 ? cited : citations;
  p.emit({
    type: "final",
    turnId,
    answer: grounded.text,
    citations: finalCitations,
    guardrail: r,
    language: p.language,
  });
  await p.trace?.flush();
  log.info("agent turn done", {
    steps: steps.length,
    ms: Date.now() - started,
    citations: finalCitations.length,
  });
  return {
    turnId,
    answer: grounded.text,
    citations: finalCitations,
    guardrail: r,
    steps,
    ok: true,
  };
}
