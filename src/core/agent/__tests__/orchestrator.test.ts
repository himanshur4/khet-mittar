import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MissingConfigError, ProviderError } from "@/core/lib/errors";
import { createToolRegistry } from "@/core/tools/registry";
import { defineTool, latitudeSchema } from "@/core/tools/types";
import { runAgentTurn, type RunTurnParams } from "../orchestrator";
import type { AgentEvent } from "../types";
import { fakeLlm, lastToolData } from "./fake-llm";

const fetchedAt = "2026-11-01T06:00:00.000Z";

function rainTool(impl?: () => Promise<number>) {
  let calls = 0;
  const tool = defineTool({
    name: "rain",
    description: "rain forecast",
    args: z.object({ latitude: latitudeSchema }),
    timeoutMs: 1_000,
    async execute() {
      calls++;
      const mm = impl ? await impl() : 12.4;
      return {
        data: { tomorrowMm: mm },
        sources: [{ kind: "tool", title: "Test forecast", fetchedAt }],
        summary: `rain ${mm} mm`,
      };
    },
  });
  return { tool, calls: () => calls };
}

function run(overrides: Partial<RunTurnParams> & Pick<RunTurnParams, "models" | "tools">) {
  const events: AgentEvent[] = [];
  const promise = runAgentTurn({
    question: "Will it rain tomorrow?",
    history: [],
    farmer: null,
    language: "en",
    conversationId: null,
    emit: (e) => events.push(e),
    now: new Date("2026-11-01T06:00:00Z"),
    ...overrides,
  });
  return { events, promise };
}

describe("runAgentTurn", () => {
  it("feeds invalid tool arguments back so the model can correct itself", async () => {
    const { tool } = rainTool();
    const llm = fakeLlm([
      { calls: [{ name: "rain", input: { latitude: 120 } }] },
      { calls: [{ name: "rain", input: { latitude: 19.9 } }] },
      {
        answer: (messages) => {
          const data = lastToolData(messages, "rain") as { tomorrowMm: number };
          return `Rain of ${data.tomorrowMm} mm is expected tomorrow [S1].`;
        },
      },
    ]);
    const { promise } = run({
      models: { primary: llm, fallback: null },
      tools: createToolRegistry([tool]),
    });
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.answer).toBe("Rain of 12.4 mm is expected tomorrow [S1].");
    expect(result.citations.map((c) => c.id)).toEqual(["S1"]);
    const toolSteps = result.steps.filter((s) => s.kind === "tool");
    expect(toolSteps.map((s) => s.status)).toEqual(["invalid_args", "ok"]);
    // The second LLM call saw the validation error in the tool message.
    const toolMessage = llm.calls[1]!.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMessage)).toContain("India spans latitude");
  });

  it("disables a tool after repeated failures and still answers", async () => {
    const { tool, calls } = rainTool(async () => {
      throw new ProviderError("Test forecast", "HTTP 503", { retryable: true });
    });
    const llm = fakeLlm([
      { calls: [{ name: "rain", input: { latitude: 19.9 } }] },
      { calls: [{ name: "rain", input: { latitude: 19.9 } }] },
      { calls: [{ name: "rain", input: { latitude: 19.9 } }] },
      { answer: "The forecast service is unavailable right now; please check again later." },
    ]);
    const { promise } = run({
      models: { primary: llm, fallback: null },
      tools: createToolRegistry([tool]),
      limits: { maxToolRetries: 2 },
    });
    const result = await promise;

    expect(result.ok).toBe(true);
    // 1 try + 2 retries; then the tool is disabled and the model must answer without it.
    expect(calls()).toBe(3);
    expect(llm.calls[3]!.toolChoice).toBe("none");
    expect(result.answer).toContain("unavailable");
    const lastToolMessage = JSON.stringify(llm.calls[3]!.messages.at(-1));
    expect(lastToolMessage).toContain("Do not call it again");
  });

  it("disables a tool immediately when its key is missing", async () => {
    const { tool, calls } = rainTool(async () => {
      throw new MissingConfigError("Weather", ["WEATHER_KEY"]);
    });
    const llm = fakeLlm([
      { calls: [{ name: "rain", input: { latitude: 19.9 } }] },
      { answer: "Weather data is not available right now." },
    ]);
    const result = await run({
      models: { primary: llm, fallback: null },
      tools: createToolRegistry([tool]),
    }).promise;
    expect(calls()).toBe(1);
    expect(llm.calls[1]!.toolChoice).toBe("none");
    expect(result.ok).toBe(true);
  });

  it("enforces the step budget and forces an answer on the last step", async () => {
    const { tool } = rainTool();
    const llm = fakeLlm([
      { calls: [{ name: "rain", input: { latitude: 19.9 } }] },
      { calls: [{ name: "rain", input: { latitude: 19.9 } }] },
      { calls: [{ name: "rain", input: { latitude: 19.9 } }] },
      { answer: "Answer with what I have." },
    ]);
    const result = await run({
      models: { primary: llm, fallback: null },
      tools: createToolRegistry([tool]),
      limits: { maxSteps: 3 },
    }).promise;

    expect(llm.calls).toHaveLength(3);
    expect(llm.calls.map((c) => c.toolChoice)).toEqual(["auto", "auto", "none"]);
    expect(result.ok).toBe(true);
  });

  it("runs independent tool calls in parallel", async () => {
    const started: number[] = [];
    const slow = defineTool({
      name: "slow",
      description: "slow",
      args: z.object({ n: z.number() }),
      timeoutMs: 2_000,
      async execute({ n }) {
        started.push(Date.now());
        await new Promise((r) => setTimeout(r, 150));
        return { data: { n }, sources: [], summary: String(n) };
      },
    });
    const llm = fakeLlm([
      { calls: [1, 2, 3].map((n) => ({ name: "slow", input: { n } })) },
      { answer: "done" },
    ]);
    const t0 = Date.now();
    await run({ models: { primary: llm, fallback: null }, tools: createToolRegistry([slow]) })
      .promise;
    expect(Date.now() - t0).toBeLessThan(400);
    expect(Math.max(...started) - Math.min(...started)).toBeLessThan(100);
  });

  it("switches to the fallback model when the primary fails", async () => {
    const { tool } = rainTool();
    const primary = fakeLlm([{ throws: new Error("503 from provider") }], "primary");
    const fallback = fakeLlm([{ answer: "Fallback answer." }], "fallback");
    const { events, promise } = run({
      models: { primary, fallback },
      tools: createToolRegistry([tool]),
    });
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.answer).toBe("Fallback answer.");
    expect(result.steps.map((s) => `${s.name}:${s.status}`)).toContain("fallback:fallback");
    expect(events.some((e) => e.type === "final")).toBe(true);
  });

  it("returns a graceful error when every model fails", async () => {
    const { tool } = rainTool();
    const primary = fakeLlm([{ throws: new Error("down") }], "primary");
    const fallback = fakeLlm([{ throws: new Error("also down") }], "fallback");
    const { events, promise } = run({
      models: { primary, fallback },
      tools: createToolRegistry([tool]),
    });
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(events.find((e) => e.type === "error")).toBeDefined();
    expect(result.answer).toContain("Kisan Call Centre");
  });

  it("tells the model about unknown tools instead of crashing", async () => {
    const { tool } = rainTool();
    const llm = fakeLlm([{ calls: [{ name: "getMoonPhase", input: {} }] }, { answer: "ok" }]);
    const result = await run({
      models: { primary: llm, fallback: null },
      tools: createToolRegistry([tool]),
    }).promise;
    expect(result.steps.find((s) => s.kind === "tool")!.error).toBe("unknown tool");
    expect(JSON.stringify(llm.calls[1]!.messages)).toContain(
      'There is no tool named \\"getMoonPhase\\"',
    );
  });

  it("removes fabricated numbers before the farmer sees them", async () => {
    const { tool } = rainTool();
    const llm = fakeLlm([
      { calls: [{ name: "rain", input: { latitude: 19.9 } }] },
      { answer: "Rain of 12.4 mm is expected [S1].\nPrices will rise by 30% next week." },
    ]);
    const result = await run({
      models: { primary: llm, fallback: null },
      tools: createToolRegistry([tool]),
    }).promise;
    expect(result.answer).toContain("12.4 mm");
    expect(result.answer).not.toContain("30%");
    expect(result.guardrail?.removed).toHaveLength(1);
  });

  it("passes pre-fetched context as citable evidence", async () => {
    const llm = fakeLlm([{ answer: "Heavy rain of 72 mm is forecast for 3 Nov [S1]." }]);
    const result = await run({
      models: { primary: llm, fallback: null },
      tools: createToolRegistry([]),
      context: [
        {
          label: "Forecast",
          source: { kind: "tool", title: "Test forecast", fetchedAt },
          data: { date: "2026-11-03", rainMm: 72 },
        },
      ],
    }).promise;
    expect(result.answer).toBe("Heavy rain of 72 mm is forecast for 3 Nov [S1].");
    expect(result.guardrail?.removed).toHaveLength(0);
    expect(JSON.stringify(llm.calls[0]!.messages)).toContain("[S1] Forecast");
  });
});
